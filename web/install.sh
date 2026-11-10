#!/bin/sh
set -eu
# a release candidate's devices install that same candidate (cut.sh checks
# this names Update.ts's VERSION)
curl -fsSL https://github.com/arteeh/uniichat/releases/download/40.rc1/install.sh | UNII_BIN="${UNII_BIN:-$HOME/.local/bin/unii}" sh
