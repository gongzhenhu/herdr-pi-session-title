# Herdr Pi Session Title

Herdr plugin that mirrors the current **pi coding agent** session title into
the herdr pane display metadata — the pi sibling of
[`herdr-claude-session-title`](https://github.com/gongzhenhu/herdr-claude-session-title)
and [`herdr-codex-session-title`](https://github.com/gongzhenhu/herdr-codex-session-title).

A `/name`-chosen name (or `--name`) wins; otherwise the **latest** user message
serves as the title, capped at 60 characters — so the pane tracks what the
session is working on right now and moves forward with every prompt you send.

## How it works

- Installs one TypeScript extension into pi's user extensions directory
  (`PI_CODING_AGENT_DIR/extensions/`, default `~/.pi/agent/extensions/`).
  Files there load automatically; no settings file is modified.
- The extension talks to the herdr server directly over the herdr socket
  (`HERDR_SOCKET_PATH`) — same in-process approach as herdr's own agent-state
  integration, no subprocess and no python3.
- Reports go out as `pane.report_metadata` with the source token `agent:title`
  and `tokens.title` — the same source token (and the same legacy token
  syntax) as the Claude/Codex siblings.
- Title sources, in priority order:
  1. the session display name (`/name`, `--name`, or `pi.setSessionName()`),
     reported the moment `session_info_changed` fires;
  2. the latest user message on the active branch — re-derived from
     `ctx.sessionManager.getBranch()` (scanned backwards) on every event, so
     it needs no cached state and survives reloads and session switches.
     Whitespace-only or image-only prompts fall through to the one before.
- Events:
  - `session_start` — reports the resumed/named session's title, or clears a
    stale title left by a session that died without `session_shutdown`
    (TUI only: RPC/JSON/print modes are headless).
  - `session_info_changed` — `/name` set or cleared.
  - `before_agent_start` — every prompt of an unnamed session (real user
    prompts only; extension-triggered custom-message runs are ignored). The
    submitted prompt is used directly rather than read back from the branch,
    which may not contain it yet and would then leave the title one turn
    stale.
  - `session_shutdown` — clears the title. Covers quit AND in-process
    switches (`/new`, `/resume`, `/fork`, reload); each of those is followed
    by a `session_start` that re-reports. The handler awaits the socket send
    so the clear cannot lose the race against process exit.
- Fully fail-open: every error path is swallowed, so a herdr outage can never
  disturb pi. Outside a herdr-managed pane (`HERDR_ENV` / `HERDR_SOCKET_PATH`
  / `HERDR_PANE_ID` unset) the extension does nothing.

Requires pi >= 1.2 (extension events) inside herdr >= 0.7.0. Nothing leaves
the machine.

## Install

```sh
herdr plugin install gongzhenhu/herdr-pi-session-title
herdr plugin action invoke install --plugin gongzhenhu.herdr-pi-session-title
```

(Development alternative: `herdr plugin link <checkout>` and invoke the
`install` action the same way.)

Restart already-running pi sessions; extensions load at startup.

## Verify

1. Inside herdr, open pi in a pane.
2. Run `/name my-task-name`.
3. The pane's metadata title is now `my-task-name`
   (`herdr pane list` shows `tokens.title`; herdr's navigator/detail view
   displays it).

Check installation state any time:

```sh
herdr plugin action invoke status --plugin gongzhenhu.herdr-pi-session-title
```

## Uninstall

```sh
herdr plugin action invoke uninstall --plugin gongzhenhu.herdr-pi-session-title
herdr plugin uninstall gongzhenhu.herdr-pi-session-title
```

`install`/`uninstall` only add or remove their own single file in the
extensions directory; nothing else is touched.

## Differences from the Claude/Codex siblings (all deliberate)

| | Claude plugin | Codex plugin | this plugin |
|---|---|---|---|
| Mechanism | Claude Code hooks (`settings.json`) | Codex hooks (`hooks.json`) | pi extension (auto-loaded `.ts`) |
| Title source | `custom-title`/`ai-title` in transcript | `thread_name` in session index | `session_info` name; latest user message fallback |
| Auto-generated titles | yes (Claude writes `ai-title`) | yes (Codex writes `thread_name`, ~3s late) | none (pi generates no titles) — latest-prompt fallback instead |
| Stale-title cleanup | on `SessionEnd` | on `SessionStart` (no SessionEnd hook) | on `session_shutdown` (fires on quit AND `/new`/`/resume`/fork/reload) |
| Transport | `herdr pane report-metadata` CLI | `herdr pane report-metadata` CLI | herdr socket directly from the pi process |
| Runtime deps | python3 | python3 | node only (pi itself) |

## Development

```sh
sh tests/run.sh        # offline unit tests (node >= 22.18 for native TS)
herdr plugin link .    # register the working tree with herdr
```

To try the extension without installing the plugin:

```sh
pi --extension ./scripts/herdr-pi-session-title.ts
```

Troubleshooting: `herdr plugin log list --plugin gongzhenhu.herdr-pi-session-title`
