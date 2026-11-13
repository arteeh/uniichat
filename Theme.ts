import type { Kind } from "./AskAI.ts";

type Look = { dim: boolean; it: boolean };

export const WHO: Record<string, string> = { work: "Report", note: "Note" };

const KIND: Record<Kind, Look> = {
  user : { dim: false, it: false },
  work : { dim: false, it: false },
  reply: { dim: false, it: false },
  tool : { dim: true, it: false },
  echo : { dim: true, it: false },
  note : { dim: true, it: true },
  mind : { dim: true, it: true },
  team : { dim: true, it: false },
};

const TOOL: Record<string, string> = {
  zoom       : "🔍",
  date       : "📅",
  shell      : "⌨️",
  read       : "📖",
  write      : "📄",
  edit       : "📝",
  computer   : "🖱️",
  schedule   : "⏰",
  schedules  : "⏰",
  unschedule : "⏰",
  spawn      : "🐣",
  tell       : "💬",
  stop       : "✋",
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
