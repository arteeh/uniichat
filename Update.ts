export const VERSION = "33";

const REPO        = "https://github.com/arteeh/uniichat";
export const INSTALL     = REPO + "/releases/latest/download/install.sh";
export const INSTALL_PS1 = REPO + "/releases/latest/download/install.ps1";

export function update_cmd(bin: string, win: boolean): string {
  if (win) {
    return "$env:UNII_BIN = '" + bin.replaceAll("'", "''") + "'; irm " + INSTALL_PS1 + " | iex";
  }
  return "curl -fsSL " + INSTALL + " | UNII_BIN='" + bin.replaceAll("'", "'\\''") + "' sh";
}
