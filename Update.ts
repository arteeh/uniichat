export const VERSION = "39";

const REPO        = "https://github.com/arteeh/uniichat";
const API         = "https://api.github.com/repos/arteeh/uniichat/releases?per_page=30";

// the agent-team beta's own: its pre-releases are tagged beta-<n>, and its
// `unii update` runs the newest one's installer (newest first, as GitHub
// lists them)
export function update_cmd(win: boolean): string {
  return win
    ? "irm ((irm '" + API + "' | Where-Object { $_.tag_name -like 'beta-*' } | Select-Object -First 1).assets | Where-Object { $_.name -eq 'install.ps1' }).browser_download_url | iex"
    : "u=$(curl -fsSL '" + API + "' | grep -o '\"browser_download_url\": *\"" + REPO + "/releases/download/beta-[0-9]*/install.sh\"' | head -1 | grep -o 'https://[^\"]*'); [ -n \"$u\" ] || { echo 'unii: no beta release found' >&2; exit 1; }; curl -fsSL \"$u\" | sh";
}
