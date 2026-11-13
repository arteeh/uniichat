#!/bin/bash
# sign.sh sign|verify DIR PUB: signs (sign, then checks) or checks (verify)
# DIR's SHA256SUMS, install.sh and install.ps1 with `ssh-keygen -Y`
# (namespace unii-<file name>, so one file's signature can't pass for
# another's), against PUB, the repo's release/unii.pub.
# The private key is $UNII_KEY (default ~/.config/uniidev/unii.key, mode
# 600, no passphrase; its backup is in the owner's Bitwarden). Make it once:
#   ssh-keygen -t ed25519 -N '' -C unii-release -f ~/.config/uniidev/unii.key
# and put unii.key.pub in the repo as release/unii.pub (and its key in README.md).
set -euo pipefail
what=$1 dir=$2 pub=$3
KEY=${UNII_KEY:-$HOME/.config/uniidev/unii.key}
FILES="SHA256SUMS install.sh install.ps1"
grep -q '^ssh-ed25519 AAAA' "$pub" || { echo "$pub holds no release key (still the placeholder?)"; exit 1; }
want=$(cut -d' ' -f1-2 "$pub")
cd "$dir"
if [ "$what" = sign ]; then
  [ -f "$KEY" ] || { echo "no signing key $KEY"; exit 1; }
  [ "$(ssh-keygen -y -f "$KEY" | cut -d' ' -f1-2)" = "$want" ] || { echo "$KEY is not the key in $pub"; exit 1; }
  for f in $FILES; do
    rm -f "$f.sig"
    ssh-keygen -q -Y sign -f "$KEY" -n "unii-$f" "$f"
  done
elif [ "$what" != verify ]; then
  echo "sign.sh sign|verify DIR PUB"; exit 2
fi
signers=$(mktemp)
trap 'rm -f "$signers"' EXIT
echo "unii $want" > "$signers"
for f in $FILES; do
  [ -f "$f.sig" ] || { echo "$f has no signature ($f.sig)"; exit 1; }
  ssh-keygen -Y verify -f "$signers" -I unii -n "unii-$f" -s "$f.sig" < "$f" > /dev/null 2>&1 || { echo "$f: its signature doesn't match $pub"; exit 1; }
done
echo "signed and checked: $FILES"
