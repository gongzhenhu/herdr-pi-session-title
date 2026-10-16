// installed by the gongzhenhu.herdr-pi-session-title herdr plugin
// reinstalling the plugin overwrites this file; do not edit in place.
// @ts-nocheck
//
// Reports the pi session title to herdr as pane display metadata.
//
// Title sources, in priority order:
//   1. the session display name (set with /name or --name; session_info entry)
//   2. a pinned title (title-pin token, set by the pane-titles skill after it
//      read the whole conversation) — it suppresses source 3 until /name or
//      a brand-new session in this pane clears the pin
//   3. the latest user message on the active branch, capped at 60 characters —
//      the pane title tracks what you are asking about right now, so it moves
//      forward with every prompt you send
//
// Reported on the herdr socket as pane.report_metadata with the source token
// `agent:title`, exactly like the Claude Code and Codex sibling plugins. The
// title token (not the --title flag) is the syntax herdr 0.9.x actually keeps.
//
// The extension is fail-open by design: every error path is swallowed so a
// herdr outage can never disturb pi. Outside a herdr-managed pane
// (HERDR_ENV / HERDR_SOCKET_PATH / HERDR_PANE_ID unset) it does nothing.

import net from "node:net";

const HERDR_ENV = process.env.HERDR_ENV;
const socketPath = process.env.HERDR_SOCKET_PATH;
const paneId = process.env.HERDR_PANE_ID;
const source = "agent:title";
const agent = "pi";

const MAX_TITLE_CHARS = 120;
const MAX_PROMPT_CHARS = 60;

function enabled() {
  return HERDR_ENV === "1" && !!socketPath && !!paneId;
}

function sendRequest(request, timeoutMs) {
  // Resolves with the first parsed response frame, or null on any failure
  // (timeout, connection error, malformed frame). Fail-open by design.
  return new Promise((resolve) => {
    let done = false;
    let timeout;
    let buffer = "";
    const finish = (value) => {
      if (done) return;
      done = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      socket.destroy();
      resolve(value);
    };

    const socket = net.createConnection(socketPath);
    socket.on("error", () => finish(null));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return; // frame not complete yet
      }
      try {
        finish(JSON.parse(buffer.slice(0, newline)));
      } catch {
        finish(null);
      }
    });
    socket.on("end", () => finish(null));
    timeout = setTimeout(() => finish(null), timeoutMs);
    timeout.unref?.();
  });
}

let reportSeq = Date.now() * 1000;

function nextReportSeq() {
  reportSeq += 1;
  return reportSeq;
}

function reportTitle(title, opts) {
  // title: string to set, null to clear. opts.clearPin also drops title-pin
  // (a /name outranks a pinned skill title and consumes the pin). A null
  // token value is the wire syntax for clearing that token.
  const tokens = { title: title ?? null };
  if (opts?.clearPin) {
    tokens["title-pin"] = null;
  }
  return sendRequest(
    {
      id: `${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      method: "pane.report_metadata",
      params: {
        pane_id: paneId,
        source,
        agent,
        seq: nextReportSeq(),
        tokens,
      },
    },
    500
  );
}

async function titlePinned() {
  // True when the pane title was pinned by the pane-titles skill: the pin
  // suppresses auto-derived titles (prompt truncation) until the user names
  // the session (/name) or a brand-new session starts in this pane.
  // Fail-open: unqueryable herdr reads as unpinned.
  try {
    const response = await sendRequest(
      {
        id: `${source}:get:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        method: "pane.get",
        params: { pane_id: paneId },
      },
      500
    );
    const tokens = response?.result?.pane?.tokens;
    return !!tokens && "title-pin" in tokens;
  } catch {
    return false;
  }
}

export function sanitizeTitle(text) {
  if (typeof text !== "string") {
    return undefined;
  }
  let cleaned = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    cleaned +=
      code < 32 || code === 127 || (code >= 128 && code <= 159) ? " " : ch;
  }
  cleaned = cleaned.split(/\s+/).join(" ").trim();
  return cleaned || undefined;
}

export function truncateTitle(text, maxChars) {
  const sanitized = sanitizeTitle(text);
  if (!sanitized) {
    return undefined;
  }
  return Array.from(sanitized).slice(0, maxChars).join("");
}

export function messageText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && block.type === "text")
      .map((block) => block.text || "")
      .join(" ");
  }
  return undefined;
}

// Fallback title: the latest user message on the active branch. Scanned
// backwards so the newest prompt with usable text wins and whitespace-only or
// image-only messages fall through to the one before them. Re-derived from the
// branch on every event, so it survives reloads and in-process session
// switches without any cached state.
export function fallbackTitleFromBranch(entries) {
  if (!Array.isArray(entries)) {
    return undefined;
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || entry.type !== "message") {
      continue;
    }
    const message = entry.message;
    if (!message || message.role !== "user") {
      continue;
    }
    const text = sanitizeTitle(messageText(message.content));
    if (text) {
      return truncateTitle(text, MAX_PROMPT_CHARS);
    }
  }
  return undefined;
}

export default function (pi) {
  if (!enabled()) {
    return;
  }

  let attached = false;

  function fallbackTitle(ctx) {
    try {
      return fallbackTitleFromBranch(ctx?.sessionManager?.getBranch?.());
    } catch {
      return undefined;
    }
  }

  function currentTitle(ctx) {
    const name = truncateTitle(pi.getSessionName?.(), MAX_TITLE_CHARS);
    if (name) {
      return name;
    }
    return fallbackTitle(ctx);
  }

  pi.on("session_start", async (event, ctx) => {
    // TUI only: RPC/JSON/print modes are headless (no PTY herdr can display).
    if (ctx?.mode !== "tui") {
      return;
    }
    attached = true;
    const named = truncateTitle(pi.getSessionName?.(), MAX_TITLE_CHARS);
    if (named) {
      // /name outranks a pinned skill title and consumes the pin.
      await reportTitle(named, { clearPin: true });
      return;
    }
    const fallback = fallbackTitle(ctx);
    if (await titlePinned()) {
      if (fallback) {
        // Resuming a session with history: the pinned title still names it.
        return;
      }
      // Brand-new session in this pane: the pin belonged to the old one.
      await reportTitle(null, { clearPin: true });
      return;
    }
    // Report the resumed session's title, or clear a stale one left by a
    // previous session in this pane that died without firing session_shutdown.
    await reportTitle(fallback ?? null);
  });

  pi.on("session_info_changed", async (event, ctx) => {
    if (!attached) {
      return;
    }
    // /name set or cleared: the name wins while set; when cleared, fall back
    // to the latest user message again (or nothing on a fresh session).
    const named = truncateTitle(pi.getSessionName?.(), MAX_TITLE_CHARS);
    if (named) {
      await reportTitle(named, { clearPin: true });
      return;
    }
    if (await titlePinned()) {
      return;
    }
    await reportTitle(fallbackTitle(ctx) ?? null);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!attached) {
      return;
    }
    // Only real user prompts are title material; custom-message runs from
    // other extensions are not.
    if (event?.messageType !== "user") {
      return;
    }
    if (pi.getSessionName?.()) {
      return;
    }
    if (await titlePinned()) {
      // The skill's title survives new prompts: it was derived from the
      // whole conversation, not from the latest message.
      return;
    }
    // The prompt being submitted right now is the title, so the pane tracks
    // the conversation instead of staying pinned to its opening message.
    // event.prompt is exact; the branch is only a safety net for a prompt with
    // no usable text, and cannot be preferred here because pi may not have
    // appended this prompt yet — a backwards scan would then return the
    // previous turn's prompt and leave the title one turn stale.
    const title =
      truncateTitle(event.prompt, MAX_PROMPT_CHARS) ?? fallbackTitle(ctx);
    if (title) {
      await reportTitle(title);
    }
  });

  pi.on("session_shutdown", async () => {
    if (!attached) {
      return;
    }
    // Covers quit AND in-process switches (/new, /resume, /fork, reload):
    // every one of those is followed by a session_start that re-reports.
    // A pinned title stays put here: session_start decides whether the next
    // session may keep it (resumed) or clears it (brand-new).
    // Awaited so pi stays alive until the write reaches the herdr socket —
    // a fire-and-forget send can lose the race against process exit.
    if (await titlePinned()) {
      return;
    }
    await reportTitle(null);
  });
}
