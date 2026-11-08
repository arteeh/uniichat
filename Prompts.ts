import * as fs from "node:fs";
import * as config from "./Config.ts";
import AGENT from "./prompts/agent.md" with { type: "text" };
import COMPACT from "./prompts/compact.md" with { type: "text" };
import GOAL from "./prompts/goal.md" with { type: "text" };
import INSTRUCTIONS from "./prompts/instructions.md" with { type: "text" };
import PROMPT from "./prompts/prompt.md" with { type: "text" };
import TEAM from "./prompts/team.md" with { type: "text" };
import TEAM_VIEW from "./prompts/team-view.md" with { type: "text" };
import UNII from "./prompts/unii.md" with { type: "text" };
import YOU from "./prompts/you.md" with { type: "text" };

// the fixed prompts, each read from its file in config.SHARE, which the
// installer writes again each time, else the copy built in: the base of
// every agent's system prompt (prompt), the compaction prompt, every
// summary's and nothing else (compact; after upstream #37 by @tinqr: with
// one prompt for both, a turn sometimes came back a summary), the parts
// the system prompt is laid out with, Unii's and other agents' default
// prompts, and the goal check's
const BUILT = { prompt: PROMPT, compact: COMPACT, instructions: INSTRUCTIONS, team: TEAM, "team-view": TEAM_VIEW, you: YOU, agent: AGENT, unii: UNII, goal: GOAL };

export type Which = keyof typeof BUILT;

export function prompt(which: Which, vars: Record<string, string> = {}): string {
  let text = "";
  try {
    text = fs.readFileSync(config.SHARE + "/" + which + ".md", "utf8").trim();
  } catch {}
  return fill(text || BUILT[which].trim(), vars);
}

// one pass: a value put in is never filled again
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (all, key: string) => (Object.hasOwn(vars, key) ? vars[key] : all));
}
