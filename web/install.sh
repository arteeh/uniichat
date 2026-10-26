#!/bin/sh
set -eu
curl -fsSL https://github.com/arteeh/uniichat/releases/latest/download/install.sh | UNII_BIN="${UNII_BIN:-$HOME/.local/bin/unii}" sh
