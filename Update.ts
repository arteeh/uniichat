// Update
// ======
// Where this build of unii updates from: arteeh's fork's GitHub releases,
// not uniichat.com. `unii update` pipes the newest release's install.sh to
// sh, telling it to replace this very executable (UNII_BIN); the daily
// note reads the newest release's tag from where /releases/latest
// redirects. Versions: upstream's x.y.z, the fork's x.y.z-arteeh.N.

// this unii's version: each release ships one, a new one for every
// change to Term.ts or what it imports. The fork's release script reads
// it here and tags the release v + it; BASE is upstream's part
export const VERSION = "1.0.138-arteeh.11";
export const BASE    = VERSION.replace(/-.*/, "");

export const REPO    = "https://github.com/arteeh/uniichat";
export const LATEST  = REPO + "/releases/latest";
export const INSTALL = LATEST + "/download/install.sh";

// a version as numbers, x.y.z as x.y.z-arteeh.0; null if not one
export function update_parse(ver: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-arteeh\.(\d+))?$/.exec(ver);
  return m === null ? null : [m[1], m[2], m[3], m[4] ?? "0"].map(Number);
}

// whether ver is newer than than
export function update_newer(ver: string, than: string): boolean {
  const a = update_parse(ver);
  const b = update_parse(than);
  if (a === null || b === null) {
    return false;
  }
  const i = a.findIndex((n, k) => n !== b[k]);
  return i >= 0 && a[i] > b[i];
}

// the version a redirect of LATEST names (.../releases/tag/v<ver>)
export function update_tag(location: string | null): string | null {
  const m = /\/releases\/tag\/v([^/?#]+)$/.exec(location ?? "");
  return m !== null && update_parse(m[1]) !== null ? m[1] : null;
}

// the update's shell command: url's installer if given (another
// server's), else the newest release's; either may put the new unii at bin
export function update_cmd(url: string | undefined, bin: string): string {
  const src = url === undefined ? INSTALL : url.replace(/\/$/, "") + "/install.sh";
  return "curl -fsSL " + src + " | UNII_BIN='" + bin.replaceAll("'", "'\\''") + "' sh";
}
