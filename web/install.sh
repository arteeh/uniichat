#!/bin/sh
set -eu
u=$(curl -fsSL 'https://api.github.com/repos/arteeh/uniichat/releases?per_page=30' | grep -o '"browser_download_url": *"https://github.com/arteeh/uniichat/releases/download/beta-[0-9]*/install.sh"' | head -1 | grep -o 'https://[^"]*')
[ -n "$u" ] || { echo "unii: no beta release found" >&2; exit 1; }
curl -fsSL "$u" | UNII_BIN="${UNII_BIN:-$HOME/.local/bin/unii}" sh
