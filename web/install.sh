#!/bin/sh
set -eu
# a server's devices install that same release (cut.sh checks this names
# Update.ts's VERSION)
curl -fsSL https://github.com/arteeh/ki/releases/download/40/install.sh | KI_BIN="${KI_BIN:-$HOME/.local/bin/ki}" sh
