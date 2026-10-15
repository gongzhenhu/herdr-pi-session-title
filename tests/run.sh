#!/bin/sh
# Offline unit tests for the pure title logic of herdr-pi-session-title.ts.
# Runs on node >= 22.18 (native TypeScript stripping); no pi or herdr needed.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
err=$(mktemp)

if ! node "$here/title-tests.mjs" 2>"$err"; then
  if grep -q "ERR_UNKNOWN_FILE_EXTENSION\|ERR_MODULE_NOT_FOUND" "$err" 2>/dev/null; then
    echo "SKIP: this node cannot strip TypeScript types natively (need >= 22.18)" >&2
    rm -f "$err"
    exit 1
  fi
  cat "$err" >&2
  rm -f "$err"
  exit 1
fi
rm -f "$err"
