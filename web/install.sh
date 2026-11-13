#!/bin/sh
set -eu
# a server's devices install that same release (cut.sh checks this names
# Update.ts's VERSION)
curl -fsSL https://github.com/arteeh/uniichat/releases/download/40/install.sh | UNII_BIN="${UNII_BIN:-$HOME/.local/bin/unii}" sh
