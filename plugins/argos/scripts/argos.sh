#!/usr/bin/env sh
set -eu
PLUGIN_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
REPO_ROOT=$(CDPATH= cd -- "$PLUGIN_ROOT/../.." && pwd)
if [ -f "$PLUGIN_ROOT/dist/cli.js" ]; then
  exec node "$PLUGIN_ROOT/dist/cli.js" "$@"
fi
exec node "$REPO_ROOT/dist/cli.js" "$@"
