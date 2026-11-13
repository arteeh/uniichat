# Release scripts

The owner's release tooling, run on the build computer from the checkout they build (`$REL/release`). Work dirs, locks and release notes stay in `~/Projects/uniichat-dev`.

- `cut.sh [--publish]`: release `N` from `origin/main` (checked out in `~/Projects/uniichat-wt/release`), published as Latest.
- `rc/cut.sh [--publish]`: release candidate `N.rcM` from `origin/rc` (`~/Projects/uniichat-wt/rc`), a pre-release; uses `../install.*.in` and `../sign.sh`.
- `install.sh.in`, `install.ps1.in`: the installers; cut.sh fills in the version, sums and prompts.
- `sign.sh sign|verify DIR PUB`: signs or checks `SHA256SUMS`, `install.sh`, `install.ps1` in DIR with `ssh-keygen -Y sign`, one namespace per file. PUB is `release/unii.pub`.

Both cut.sh refuse to build unless `unii.pub` holds a real `ssh-ed25519 AAAA…` key that README.md shows (and no other key, no `TODO`); they sign after writing the installers, and `--publish` checks every signature before it tags anything.

## Release key

Made once: `ssh-keygen -t ed25519 -N '' -C unii-release -f ~/.config/uniidev/unii.key`, backed up in Bitwarden. Its public half goes into `release/unii.pub` and README.md (`cut -d' ' -f1-2 release/unii.pub`), committed; the binary embeds it.

Lost on the build computer: restore it from Bitwarden. Lost for good or leaked: make a new one, commit it, and say in the release notes that `unii update` refuses it and everyone reinstalls with README's checked install lines.
