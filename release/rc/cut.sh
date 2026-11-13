#!/bin/bash
# rc/cut.sh [--publish]: cut.sh for the agent team's release candidates
# (#90): builds the pre-release N.rcM named by Update.ts's VERSION (40.rc1,
# 40.rc2, ...) from origin/rc as checked out in ~/Projects/uniichat-wt/rc,
# with this folder's installers (they also copy ~/.unii/chat to agents/unii
# once, and write the fixed prompts to ~/.local/share/unii,
# %LOCALAPPDATA%\unii); web/install.sh must name the same N.rcM;
# --publish tags N.rcM and publishes a pre-release, never Latest, so
# nothing installs it but its own install line.
# What follows is cut.sh's own description:
#
# cut.sh [--publish]: builds the fork release named by Update.ts's VERSION,
# a plain release number N (18, 19, ...; the one source of the version:
# `unii version`, the tag and release title $N, the archive names, install.sh and
# install.ps1 all come from it) from origin/main
# as checked out in ~/Projects/uniichat-wt/release ($REL: another
# worktree, to check a branch builds; never published).
#   1. checks: worktree clean; to publish, = origin/main and tag $VER unused
#   2. `bun install --frozen-lockfile` then `bun run check` (tsc, eslint, knip) if package.json has a check
#      script, else strict tsc (no errors beyond base's)
#   3. builds 6 targets into work-release/a$N/b$N, checks the linux-x64
#      binary says "unii $VER", writes dist/: archives (tar.gz; zip for
#      Windows), SHA256SUMS, install.sh (from install.sh.in, sums and the
#      built-in prompt filled in), install.ps1 (from install.ps1.in, the
#      Windows sums filled in; ASCII only, for Windows PowerShell 5.1),
#      and the commit it built (dist/../commit)
#   4. --publish (reuses a finished build of this version and commit): tags $VER, pushes the tag, creates the GitHub release
#      (marked Latest) with notes reviews/release/notes-$N.md
# Bump VERSION in Update.ts (a commit on main) before each cut.
set -euo pipefail
export PATH=$PATH:/home/linuxbrew/.linuxbrew/bin
GH=/home/linuxbrew/.linuxbrew/bin/gh
PODMAN=/usr/bin/podman
DEV=~/Projects/uniichat-dev
MAIN=~/Projects/uniichat-wt/rc
REL=${REL:-$MAIN}
HERE=$REL/release/rc
cd "$REL"

VER=$(sed -n 's/^export const VERSION = "\([^"]*\)";$/\1/p' Update.ts)
[[ "$VER" =~ ^[1-9][0-9]*\.rc[1-9][0-9]*$ ]] || { echo "Update.ts VERSION '$VER' is not a release candidate (40.rc1, 40.rc2, ...)"; exit 1; }
grep -q "/releases/download/$VER/install.sh" web/install.sh || { echo "web/install.sh doesn't install $VER"; exit 1; }
N=$VER
TAG=$VER
NOTES=$DEV/reviews/release/notes-$N.md
PUB=$REL/release/unii.pub
grep -q '^ssh-ed25519 AAAA' "$PUB" || { echo "$PUB holds no release key: make it (see $HERE/../sign.sh) and commit it first"; exit 1; }
grep -qF "$(cut -d' ' -f2 "$PUB")" README.md || { echo "README.md doesn't show the release key in $PUB"; exit 1; }
[ "$(grep -o 'ssh-ed25519 [^ "`]*' README.md | sort -u)" = "$(cut -d' ' -f1-2 "$PUB")" ] || { echo "README.md shows a key other than the one in $PUB (a placeholder left?)"; exit 1; }
! grep -q 'TODO' README.md || { echo "README.md still has a TODO"; exit 1; }
echo "== $VER (tag $TAG)"

git fetch -q origin --tags
[ -z "$(git status --porcelain)" ] || { echo "worktree $REL not clean"; exit 1; }
if [ "${1:-}" = "--publish" ]; then
  [ "$REL" = "$MAIN" ] || { echo "only $MAIN publishes"; exit 1; }
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/rc)" ] || { echo "HEAD is not origin/rc"; exit 1; }
  ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "tag $TAG exists"; exit 1; }
fi
HEAD=$(git rev-parse HEAD)

if python3 -I -c 'import json, sys; sys.exit(0 if "check" in json.load(open(sys.argv[1])).get("scripts", {}) else 1)' "$REL/package.json"; then
  flock $DEV/heavy.lock $PODMAN run --rm --memory 3g -v "$REL:/src:z" -w /src localhost/uniidev:latest bash -lc 'bun install --frozen-lockfile' || { echo "check: bun install --frozen-lockfile failed"; exit 1; }
  flock $DEV/heavy.lock $PODMAN run --rm --memory 3g -v "$REL:/src:ro,z" -w /src localhost/uniidev:latest bash -lc 'bun run check' || { echo "check: bun run check failed"; exit 1; }
  echo "check: passed"
else
  T=$(REL=$REL flock $DEV/heavy.lock $DEV/work-release/tsc.sh); echo "$T"
  [ "$(echo "$T" | wc -l)" = 1 ] || { echo "tsc: new errors"; exit 1; }
fi

B=$DEV/work-release/a$N/b$N
# a branch's build ($REL) goes to its own dir, never one a release reuses
[ "$REL" = "$MAIN" ] || B=$DEV/work-release/rel-$(git rev-parse --short HEAD)
if [ "${1:-}" = "--publish" ] && [ -f "$B/dist/install.sh" ]; then
  echo "== publishing the existing build in $B"
  [ "$(cat "$B/commit")" = "$HEAD" ] || { echo "$B is a build of another commit"; exit 1; }
  SAYS=$($PODMAN run --rm -v "$B:/out:ro,z" localhost/uniidev:latest /out/linux-x64/unii version)
  [ "$SAYS" = "unii $VER" ] || { echo "the build says '$SAYS', not 'unii $VER'"; exit 1; }
  [ -f "$B/dist/install.ps1" ] || { echo "$B has no install.ps1"; exit 1; }
  cd "$B/dist"; $HERE/../sign.sh verify "$B/dist" "$PUB"; sha256sum -c --quiet SHA256SUMS
else
echo "== build"
[ ! -e "$B" ] || { echo "$B exists: remove it first"; exit 1; }
mkdir -p "$B/dist"
R=(flock $DEV/heavy.lock $PODMAN run --rm --memory 8g -e BUN_INSTALL_CACHE_DIR=/out/cache -e npm_config_cache=/out/npmcache -v "$REL:/src:z" -v "$B:/out:z" -w /src localhost/uniidev:latest bash -lc)
for t in linux-x64 linux-arm64 darwin-arm64 darwin-x64; do
  "${R[@]}" "bun Build.ts bun-$t /out/$t/unii 2>&1 | tail -1 && tar -czf /out/dist/unii-$VER-$t.tar.gz -C /out/$t unii"
done
for a in x64 arm64; do
  "${R[@]}" "bun Build.ts bun-windows-$a /out/windows-$a/unii.exe 2>&1 | tail -1"
done
SAYS=$("${R[@]}" "/out/linux-x64/unii version")
$PODMAN unshare rm -rf "$B/cache" "$B/npmcache"; $PODMAN unshare chown -R 0:0 "$B"
[ "$SAYS" = "unii $VER" ] || { echo "the build says '$SAYS', not 'unii $VER'"; exit 1; }
echo "built: $SAYS"
for a in x64 arm64; do
  (cd "$B/windows-$a" && python3 -I -c "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED);z.write('unii.exe');z.close()" "../dist/unii-$VER-windows-$a.zip")
done
cd "$B/dist"
sha256sum unii-* > SHA256SUMS
python3 -I - "$HERE/.." "$VER" SHA256SUMS "$REL/prompts" <<'EOF'
import base64, json, os, sys
here, ver, sums, prompts = sys.argv[1:]
texts = {f: open(os.path.join(prompts, f)).read().strip() for f in sorted(os.listdir(prompts)) if f.endswith(".md")}
assert all("UNII_PROMPT_EOF" not in t for t in texts.values())
sh = "\n".join("cat > \"$share/%s\" <<'UNII_PROMPT_EOF'\n%s\nUNII_PROMPT_EOF" % (f, t) for f, t in texts.items())
ps1 = "\n".join("    [IO.File]::WriteAllText((Join-Path $share '%s'), ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%s')) + \"`n\"))" % (f, base64.b64encode(t.encode()).decode()) for f, t in texts.items())
sum = {}
for line in open(sums):
    h, name = line.split()
    for t in ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "windows-x64", "windows-arm64"]:
        if name == "unii-%s-%s.%s" % (ver, t, "zip" if t.startswith("windows") else "tar.gz"):
            sum[t] = h
for src, out in [("install.sh.in", "install.sh"), ("install.ps1.in", "install.ps1")]:
    s = open(here + "/" + src).read().replace("@VER@", ver).replace("@PROMPT_JSON@", json.dumps(texts["prompt.md"]))
    s = s.replace("@PROMPT_FILES_PS1@", ps1).replace("@PROMPT_FILES@", sh)
    for t, h in sum.items():
        s = s.replace("@SUM_%s@" % t, h)
    assert "@VER@" not in s and "@SUM_" not in s and "@PROMPT_" not in s, "unfilled placeholder in " + out
    assert out != "install.ps1" or s.isascii(), "install.ps1 is not ASCII"
    open(out, "w").write(s)
EOF
chmod +x install.sh; sh -n install.sh
$HERE/../sign.sh sign "$B/dist" "$PUB"
echo "$HEAD" > "$B/commit"
cat SHA256SUMS
du -sh "$B"
fi

[ "${1:-}" = "--publish" ] || { echo "== built, not published (--publish to tag and release)"; exit 0; }
[ -f "$NOTES" ] || { echo "notes $NOTES missing"; exit 1; }
$HERE/../sign.sh verify "$B/dist" "$PUB"
KEYLINE=$(cut -d' ' -f1-2 "$PUB")
{ cat "$NOTES"; printf '\n## Checking the download\n\n'
  printf 'install.sh, install.ps1 and SHA256SUMS are signed with our release key (`%s`); `unii update` checks it before it runs the installer. To check by hand, next to the downloaded files, with ssh-keygen (OpenSSH 8.1 or newer, built into Linux, macOS and Windows 10/11).\n\nLinux or macOS:\n\n' "$KEYLINE"
  printf '    echo "unii %s" > unii.signers\n    ssh-keygen -Y verify -f unii.signers -I unii -n unii-install.sh -s install.sh.sig < install.sh\n\n' "$KEYLINE"
  printf 'Windows (PowerShell):\n\n'
  printf '    Set-Content unii.signers "unii %s" -Encoding ascii\n    cmd /c "ssh-keygen -Y verify -f unii.signers -I unii -n unii-install.ps1 -s install.ps1.sig < install.ps1"\n\n' "$KEYLINE"
  printf 'The sha256 of each file (the archives are in the signed SHA256SUMS too, and the install scripts check the one they download):\n\n'
  sha256sum install.sh install.ps1 SHA256SUMS install.sh.sig install.ps1.sig SHA256SUMS.sig | cat - SHA256SUMS | sed 's/^/    /'; } > "$B/notes.md"
echo "== publish"
git -C "$REL" tag -a "$TAG" -m "unii $VER" HEAD
git -C "$REL" push origin "$TAG" 2>&1 | tail -1
timeout 1800 $GH release create "$TAG" -R arteeh/uniichat --verify-tag --prerelease --latest=false --title "$VER" --notes-file "$B/notes.md" \
  install.sh install.ps1 SHA256SUMS install.sh.sig install.ps1.sig SHA256SUMS.sig unii-$VER-*.tar.gz unii-$VER-windows-*.zip 2>&1 | tail -1
echo "install line: curl -fsSL https://github.com/arteeh/uniichat/releases/download/$TAG/install.sh | sh"
