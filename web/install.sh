#!/bin/sh
# Installs unii, the UniiChat terminal, from arteeh's fork: this runs the
# installer of the fork's newest GitHub release, which says what it
# installs and where (here ~/.local/bin/unii; set UNII_BIN to change). To
# run unii from this source instead: bun Cli.ts.
set -eu
curl -fsSL https://github.com/arteeh/uniichat/releases/latest/download/install.sh | UNII_BIN="${UNII_BIN:-$HOME/.local/bin/unii}" sh
