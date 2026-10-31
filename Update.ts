export const VERSION = "36";

const REPO        = "https://github.com/arteeh/uniichat";
const INSTALL     = REPO + "/releases/latest/download/install.sh";
const INSTALL_PS1 = REPO + "/releases/latest/download/install.ps1";

export function update_cmd(win: boolean): string {
  return win ? "irm " + INSTALL_PS1 + " | iex" : "curl -fsSL " + INSTALL + " | sh";
}
