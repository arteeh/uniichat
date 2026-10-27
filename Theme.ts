import type { Kind } from "./AskAI.ts";

type Look = { dim: boolean; it: boolean };

export const ANSI = { block: "7", ink: "0", add: "2", del: "1", you: "4" };

export const WHO: Record<string, string> = { work: "Report", note: "Note" };

export const KIND: Record<Kind, Look> = {
  user : { dim: false, it: false },
  work : { dim: false, it: false },
  unii : { dim: false, it: false },
  tool : { dim: true, it: false },
  echo : { dim: true, it: false },
  note : { dim: true, it: true },
  mind : { dim: true, it: true },
};

export const FILLED: Kind[] = ["tool"];
export const FRAMED: Kind[] = ["user", "work"];

const TOOL: Record<string, string> = {
  zoom       : "🔍",
  date       : "📅",
  shell      : "⌨️",
  read       : "📖",
  write      : "📄",
  edit       : "📝",
  spawn      : "🤖",
  tell       : "💬",
  computer   : "🖱️",
  schedule   : "⏰",
  schedules  : "⏰",
  unschedule : "⏰",
};
const TOOL_ANY = "🔧";

export const GLYPH = {
  tab   : "◯",
  here  : "●",
  input : "> ",
  open  : "▾",
};

export function tool_glyph(name: string): string {
  return TOOL[name] ?? TOOL_ANY;
}

export function theme_css(): string {
  return Object.entries(KIND).map(([k, look]) => look_css(k, look)).join("");
}

function look_css(kind: string, look: Look): string {
  const ink   = look.dim ? "mid" : "ink";
  const style = look.it ? "italic" : "normal";
  const body  = "--fg:var(--" + ink + ");--it:" + style;
  return ".msg." + kind + "{" + body + "}";
}
