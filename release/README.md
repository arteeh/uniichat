# Release scripts

The owner's release tooling, run on the build computer from the checkout they build (`$REL/release`). Work dirs, locks and release notes stay in `~/Projects/uniichat-dev`.

- `cut.sh [--publish]`: cuts the version in `Update.ts` from the checkout it is in: `N` is a release (from `origin/main`, in `~/Projects/uniichat-wt/release`, published as Latest), `N.rcM` a release candidate (from `origin/rc`, in `~/Projects/uniichat-wt/rc`, a pre-release, never Latest).
- `install.sh.in`, `install.ps1.in`: the installers; cut.sh fills in the version, sums, prompts and `rename.js`, which gives data from unii, as ki was called before, ki's names, and `upgrade.js`, which brings older data to this version's layout. Every migration step lives in the installers, none in the app.
- `sign.sh sign|verify DIR PUB`: signs or checks `SHA256SUMS`, `install.sh`, `install.ps1` in DIR with `ssh-keygen -Y sign`, one namespace per file. PUB is `release/ki.pub`.

cut.sh refuses to build unless `ki.pub` holds a real `ssh-ed25519 AAAA…` key that README.md shows (and no other key, no `TODO`); it signs after writing the installers, and `--publish` checks every signature before it tags anything.

## Release key

Made once: `ssh-keygen -t ed25519 -N '' -C ki-release -f ~/.config/uniidev/ki.key`, backed up in Bitwarden. Its public half goes into `release/ki.pub` and README.md (`cut -d' ' -f1-2 release/ki.pub`), committed; the binary embeds it.

Lost on the build computer: restore it from Bitwarden. Lost for good or leaked: make a new one, commit it, and say in the release notes that `ki update` refuses it and everyone reinstalls with README's checked install lines.
