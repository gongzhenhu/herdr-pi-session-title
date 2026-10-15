#!/bin/sh
# herdr plugin action: removes the pi extension
set -eu

pi_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
target="$pi_dir/extensions/herdr-pi-session-title.ts"

rm -f "$target"
echo "uninstalled ($target removed)"
echo "note: restart any running pi session; it keeps the extension until then."
