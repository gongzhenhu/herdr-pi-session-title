#!/bin/sh
# herdr plugin action: prints extension installation status (read-only)
set -eu

pi_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
target="$pi_dir/extensions/herdr-pi-session-title.ts"

if [ -f "$target" ]; then
  echo "extension: installed ($target)"
else
  echo "extension: NOT installed"
fi

if command -v pi >/dev/null 2>&1; then
  echo "pi: $(command -v pi) ($("${PI_BIN:-pi}" --version 2>/dev/null | head -1 || echo unknown))"
else
  echo "pi: not on PATH"
fi

if [ -n "${HERDR_SOCKET_PATH:-}" ] && [ -S "$HERDR_SOCKET_PATH" ]; then
  echo "herdr socket: reachable ($HERDR_SOCKET_PATH)"
else
  echo "herdr socket: not available in this environment"
fi
