#!/bin/bash
# cut.sh [--publish]: builds the release named by Update.ts's VERSION
# (the one source of the version: `ki version`, the tag and release
# title, the archive names, install.sh and install.ps1 all come from it)
# from the checkout this script is in ($REL; REL=<worktree> builds another,
# never published). VERSION decides what it cuts:
#   N (18, 19, ...): a release, from origin/main as checked out in
#     ~/Projects/uniichat-wt/release, published as Latest;
#   N.rcM (40.rc1, ...): a release candidate, from origin/rc as checked out
#     in ~/Projects/uniichat-wt/rc, published as a pre-release, never Latest,
#     so nothing installs it but its own install line.
#   1. checks: worktree clean; to publish, = origin/main (origin/rc) and tag $VER unused
#   2. `bun install --frozen-lockfile` then `bun run check` (tsc, eslint, knip) if package.json has a check
#      script, else strict tsc (no errors beyond base's)
#   3. builds 6 targets into work-release/a$N/b$N, checks the linux-x64
#      binary says "ki $VER", writes dist/: archives (tar.gz; zip for
#      Windows), SHA256SUMS, install.sh (from install.sh.in, sums and the
#      built-in prompt filled in), install.ps1 (from install.ps1.in, the
#      Windows sums filled in; ASCII only, for Windows PowerShell 5.1),
#      and the commit it built (dist/../commit), then signs SHA256SUMS,
#      install.sh and install.ps1 (sign.sh, the key of release/ki.pub)
#   4. --publish (reuses a finished build of this version and commit; refuses
#      unless every signature checks): tags $VER, pushes the tag, creates the
#      GitHub release (Latest, or a pre-release) with notes reviews/release/notes-$N.md
#      plus the key and every file's sha256
# Bump VERSION in Update.ts (a commit on main or rc) before each cut.
set -euo pipefail
export PATH=$PATH:/home/linuxbrew/.linuxbrew/bin
GH=/home/linuxbrew/.linuxbrew/bin/gh
PODMAN=/usr/bin/podman
DEV=~/Projects/uniichat-dev
REL=${REL:-$(cd "$(dirname "$0")/.." && pwd)}
HERE=$REL/release
cd "$REL"

VER=$(sed -n 's/^export const VERSION = "\([^"]*\)";$/\1/p' Update.ts)
if [[ "$VER" =~ ^[1-9][0-9]*$ ]]; then
  RC="" MAIN=~/Projects/uniichat-wt/release BRANCH=main
elif [[ "$VER" =~ ^[1-9][0-9]*\.rc[1-9][0-9]*$ ]]; then
  RC=1 MAIN=~/Projects/uniichat-wt/rc BRANCH=rc
else
  echo "Update.ts VERSION '$VER' is neither a release number (18, 19, ...) nor a release candidate (40.rc1, 40.rc2, ...)"; exit 1
fi
# whether $REL is $MAIN, the worktree that publishes
MAINS=""; [ "$(pwd -P)" != "$(cd "$MAIN" 2>/dev/null && pwd -P)" ] || MAINS=1
grep -q "/releases/download/$VER/install.sh" web/install.sh || { echo "web/install.sh doesn't install $VER"; exit 1; }
N=$VER
TAG=$VER
NOTES=$DEV/reviews/release/notes-$N.md
PUB=$REL/release/ki.pub
grep -q '^ssh-ed25519 AAAA' "$PUB" || { echo "$PUB holds no release key: make it (see $HERE/sign.sh) and commit it first"; exit 1; }
grep -qF "$(cut -d' ' -f2 "$PUB")" README.md || { echo "README.md doesn't show the release key in $PUB"; exit 1; }
[ "$(grep -o 'ssh-ed25519 [^ "`]*' README.md | sort -u)" = "$(cut -d' ' -f1-2 "$PUB")" ] || { echo "README.md shows a key other than the one in $PUB (a placeholder left?)"; exit 1; }
! grep -q 'TODO' README.md || { echo "README.md still has a TODO"; exit 1; }
echo "== $VER (tag $TAG)"

git fetch -q origin --tags
[ -z "$(git status --porcelain)" ] || { echo "worktree $REL not clean"; exit 1; }
if [ "${1:-}" = "--publish" ]; then
  [ -n "$MAINS" ] || { echo "only $MAIN publishes"; exit 1; }
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/$BRANCH)" ] || { echo "HEAD is not origin/$BRANCH"; exit 1; }
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
[ -n "$MAINS" ] || B=$DEV/work-release/rel-$(git rev-parse --short HEAD)
if [ "${1:-}" = "--publish" ] && [ -f "$B/dist/install.sh" ]; then
  echo "== publishing the existing build in $B"
  [ "$(cat "$B/commit")" = "$HEAD" ] || { echo "$B is a build of another commit"; exit 1; }
  SAYS=$($PODMAN run --rm -v "$B:/out:ro,z" localhost/uniidev:latest /out/linux-x64/ki version)
  [ "$SAYS" = "ki $VER" ] || { echo "the build says '$SAYS', not 'ki $VER'"; exit 1; }
  [ -f "$B/dist/install.ps1" ] || { echo "$B has no install.ps1"; exit 1; }
  cd "$B/dist"; $HERE/sign.sh verify "$B/dist" "$PUB"; sha256sum -c --quiet SHA256SUMS
else
echo "== build"
[ ! -e "$B" ] || { echo "$B exists: remove it first"; exit 1; }
mkdir -p "$B/dist"
R=(flock $DEV/heavy.lock $PODMAN run --rm --memory 8g -e BUN_INSTALL_CACHE_DIR=/out/cache -e npm_config_cache=/out/npmcache -v "$REL:/src:z" -v "$B:/out:z" -w /src localhost/uniidev:latest bash -lc)
for t in linux-x64 linux-arm64 darwin-arm64 darwin-x64; do
  "${R[@]}" "bun Build.ts bun-$t /out/$t/ki 2>&1 | tail -1 && tar -czf /out/dist/ki-$VER-$t.tar.gz -C /out/$t ki"
done
for a in x64 arm64; do
  "${R[@]}" "bun Build.ts bun-windows-$a /out/windows-$a/ki.exe 2>&1 | tail -1"
done
SAYS=$("${R[@]}" "/out/linux-x64/ki version")
$PODMAN unshare rm -rf "$B/cache" "$B/npmcache"; $PODMAN unshare chown -R 0:0 "$B"
[ "$SAYS" = "ki $VER" ] || { echo "the build says '$SAYS', not 'ki $VER'"; exit 1; }
echo "built: $SAYS"
for a in x64 arm64; do
  (cd "$B/windows-$a" && python3 -I -c "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED);z.write('ki.exe');z.close()" "../dist/ki-$VER-windows-$a.zip")
done
cd "$B/dist"
sha256sum ki-* > SHA256SUMS
python3 -I - "$HERE" "$VER" SHA256SUMS "$REL/prompts" <<'EOF'
import base64, json, os, sys
here, ver, sums, prompts = sys.argv[1:]
texts = {f: open(os.path.join(prompts, f)).read().strip() for f in sorted(os.listdir(prompts)) if f.endswith(".md")}
assert all("KI_PROMPT_EOF" not in t for t in texts.values())
rename = open(here + "/rename.js").read().strip()
assert "KI_RENAME_JS" not in rename and rename.isascii()
upgrade = open(here + "/upgrade.js").read().strip()
assert "KI_UPGRADE_JS" not in upgrade and upgrade.isascii()
sh = "\n".join("cat > \"$share/%s\" <<'KI_PROMPT_EOF'\n%s\nKI_PROMPT_EOF" % (f, t) for f, t in texts.items())
ps1 = "\n".join("    [IO.File]::WriteAllText((Join-Path $share '%s'), ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%s')) + \"`n\"))" % (f, base64.b64encode(t.encode()).decode()) for f, t in texts.items())
sum = {}
for line in open(sums):
    h, name = line.split()
    for t in ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "windows-x64", "windows-arm64"]:
        if name == "ki-%s-%s.%s" % (ver, t, "zip" if t.startswith("windows") else "tar.gz"):
            sum[t] = h
for src, out in [("install.sh.in", "install.sh"), ("install.ps1.in", "install.ps1")]:
    s = open(here + "/" + src).read().replace("@VER@", ver).replace("@PROMPT_JSON@", json.dumps(texts["prompt.md"]))
    s = s.replace("@PROMPT_FILES_PS1@", ps1).replace("@PROMPT_FILES@", sh)
    s = s.replace("@RENAME_JS_B64@", base64.b64encode(rename.encode()).decode()).replace("@RENAME_JS@", rename)
    s = s.replace("@UPGRADE_JS_B64@", base64.b64encode(upgrade.encode()).decode()).replace("@UPGRADE_JS@", upgrade)
    for t, h in sum.items():
        s = s.replace("@SUM_%s@" % t, h)
    assert "@VER@" not in s and "@SUM_" not in s and "@PROMPT_" not in s and "@RENAME_" not in s and "@UPGRADE_" not in s, "unfilled placeholder in " + out
    assert out != "install.ps1" or s.isascii(), "install.ps1 is not ASCII"
    open(out, "w").write(s)
EOF
chmod +x install.sh; sh -n install.sh
$HERE/sign.sh sign "$B/dist" "$PUB"
echo "$HEAD" > "$B/commit"
cat SHA256SUMS
du -sh "$B"
fi

[ "${1:-}" = "--publish" ] || { echo "== built, not published (--publish to tag and release)"; exit 0; }
[ -f "$NOTES" ] || { echo "notes $NOTES missing"; exit 1; }
$HERE/sign.sh verify "$B/dist" "$PUB"
KEYLINE=$(cut -d' ' -f1-2 "$PUB")
{ cat "$NOTES"; printf '\n## Checking the download\n\n'
  printf 'install.sh, install.ps1 and SHA256SUMS are signed with our release key (`%s`); `ki update` checks it before it runs the installer. To check by hand, next to the downloaded files, with ssh-keygen (OpenSSH 8.1 or newer, built into Linux, macOS and Windows 10/11).\n\nLinux or macOS:\n\n' "$KEYLINE"
  printf '    echo "ki %s" > ki.signers\n    ssh-keygen -Y verify -f ki.signers -I ki -n ki-install.sh -s install.sh.sig < install.sh\n\n' "$KEYLINE"
  printf 'Windows (PowerShell):\n\n'
  printf '    Set-Content ki.signers "ki %s" -Encoding ascii\n    cmd /c "ssh-keygen -Y verify -f ki.signers -I ki -n ki-install.ps1 -s install.ps1.sig < install.ps1"\n\n' "$KEYLINE"
  printf 'The sha256 of each file (the archives are in the signed SHA256SUMS too, and the install scripts check the one they download):\n\n'
  sha256sum install.sh install.ps1 SHA256SUMS install.sh.sig install.ps1.sig SHA256SUMS.sig | cat - SHA256SUMS | sed 's/^/    /'; } > "$B/notes.md"
echo "== publish"
git -C "$REL" tag -a "$TAG" -m "ki $VER" HEAD
git -C "$REL" push origin "$TAG" 2>&1 | tail -1
LATEST=(--latest); [ -z "$RC" ] || LATEST=(--prerelease --latest=false)
timeout 1800 $GH release create "$TAG" -R arteeh/ki --verify-tag "${LATEST[@]}" --title "$VER" --notes-file "$B/notes.md" \
  install.sh install.ps1 SHA256SUMS install.sh.sig install.ps1.sig SHA256SUMS.sig ki-$VER-*.tar.gz ki-$VER-windows-*.zip 2>&1 | tail -1
if [ -z "$RC" ]; then
  curl -sI https://github.com/arteeh/ki/releases/latest | grep -i '^location'
else
  echo "install line: curl -fsSL https://github.com/arteeh/ki/releases/download/$TAG/install.sh | sh"
fi
