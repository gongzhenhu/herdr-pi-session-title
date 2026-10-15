#!/bin/sh
# herdr plugin action: installs the pi extension for session title reporting
set -eu

plugin_root="${HERDR_PLUGIN_ROOT:?HERDR_PLUGIN_ROOT is not set}"
pi_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
ext_dir="$pi_dir/extensions"
target="$ext_dir/herdr-pi-session-title.ts"

mkdir -p "$ext_dir"
cp "$plugin_root/scripts/herdr-pi-session-title.ts" "$target"

echo "installed: $target"
echo "note: files in <agent-dir>/extensions/ load automatically; restart any"
echo "      pi session that was already running to pick up the extension."
