// Update
// ======
// Where this build of unii updates from: arteeh's fork's GitHub releases,
// not uniichat.com. Updating is manual: unii asks nothing of GitHub by
// itself. `unii update` pipes the newest release's install.sh to sh,
// telling it to replace this very executable (UNII_BIN).

// this unii's version: each release ships one, a new one for every
// change to Term.ts or what it imports. The fork's release script reads
// it here and tags the release v + it
export const VERSION = "1.0.138-arteeh.17";

export const REPO    = "https://github.com/arteeh/uniichat";
export const INSTALL = REPO + "/releases/latest/download/install.sh";

// the update's shell command: the newest release's installer, told to
// put the new unii at bin
export function update_cmd(bin: string): string {
  return "curl -fsSL " + INSTALL + " | UNII_BIN='" + bin.replaceAll("'", "'\\''") + "' sh";
}
