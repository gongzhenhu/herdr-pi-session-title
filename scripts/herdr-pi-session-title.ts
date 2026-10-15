// installed by the gongzhenhu.herdr-pi-session-title herdr plugin
// reinstalling the plugin overwrites this file; do not edit in place.
// @ts-nocheck
//
// Reports the pi session title to herdr as pane display metadata.
//
// Title sources, in priority order:
//   1. the session display name (set with /name or --name; session_info entry)
//   2. the latest user message on the active branch, capped at 60 characters —
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
  return new Promise((resolve) => {
    let done = false;
    let timeout;
    const finish = (delivered) => {
      if (done) return;
      done = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      socket.destroy();
      resolve(delivered);
    };

    const socket = net.createConnection(socketPath);
    socket.on("error", () => finish(false));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", () => finish(true));
    socket.on("end", () => finish(false));
    timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref?.();
  });
}

let reportSeq = Date.now() * 1000;

function nextReportSeq() {
  reportSeq += 1;
  return reportSeq;
}

function reportTitle(title) {
  // title: string to set, null to clear
  return sendRequest(
    {
      id: `${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      method: "pane.report_metadata",
      params: {
        pane_id: paneId,
        source,
        agent,
        seq: nextReportSeq(),
        tokens: { title: title ?? null },
      },
    },
    500
  );
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

  pi.on("session_start", (event, ctx) => {
    // TUI only: RPC/JSON/print modes are headless (no PTY herdr can display).
    if (ctx?.mode !== "tui") {
      return;
    }
    attached = true;
    const title = currentTitle(ctx);
    // Report the resumed/named session's title, or clear a stale one left by a
    // previous session in this pane that died without firing session_shutdown.
    void reportTitle(title ?? null);
  });

  pi.on("session_info_changed", (event, ctx) => {
    if (!attached) {
      return;
    }
    // /name set or cleared: the name wins while set; when cleared, fall back
    // to the latest user message again (or nothing on a fresh session).
    void reportTitle(currentTitle(ctx) ?? null);
  });

  pi.on("before_agent_start", (event, ctx) => {
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
    // The prompt being submitted right now is the title, so the pane tracks
    // the conversation instead of staying pinned to its opening message.
    // event.prompt is exact; the branch is only a safety net for a prompt with
    // no usable text, and cannot be preferred here because pi may not have
    // appended this prompt yet — a backwards scan would then return the
    // previous turn's prompt and leave the title one turn stale.
    const title =
      truncateTitle(event.prompt, MAX_PROMPT_CHARS) ?? fallbackTitle(ctx);
    if (title) {
      void reportTitle(title);
    }
  });

  pi.on("session_shutdown", async () => {
    if (!attached) {
      return;
    }
    // Covers quit AND in-process switches (/new, /resume, /fork, reload):
    // every one of those is followed by a session_start that re-reports.
    // Awaited so pi stays alive until the clear reaches the herdr socket —
    // a fire-and-forget send can lose the race against process exit.
    await reportTitle(null);
  });
}
