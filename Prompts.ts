import * as fs from "node:fs";
import * as config from "./Config.ts";
import AGENT from "./prompts/agent.md" with { type: "text" };
import COMPACT from "./prompts/compact.md" with { type: "text" };
import COMPACT_AGENT from "./prompts/compact-agent.md" with { type: "text" };
import CONTINUE from "./prompts/continue.md" with { type: "text" };
import DEVICE from "./prompts/device.md" with { type: "text" };
import DEVICE_SHELL from "./prompts/device-shell.md" with { type: "text" };
import DEVICES from "./prompts/devices.md" with { type: "text" };
import DEVICES_NONE from "./prompts/devices-none.md" with { type: "text" };
import GO_ON from "./prompts/go-on.md" with { type: "text" };
import GOAL from "./prompts/goal.md" with { type: "text" };
import GOAL_ASK from "./prompts/goal-ask.md" with { type: "text" };
import GOAL_NO from "./prompts/goal-no.md" with { type: "text" };
import JOBS from "./prompts/jobs.md" with { type: "text" };
import LEAF from "./prompts/leaf.md" with { type: "text" };
import MERGE from "./prompts/merge.md" with { type: "text" };
import MESSAGE from "./prompts/message.md" with { type: "text" };
import MESSAGE_WORKING from "./prompts/message-working.md" with { type: "text" };
import NOT_SUMMARIZED from "./prompts/not-summarized.md" with { type: "text" };
import OVER from "./prompts/over.md" with { type: "text" };
import PROMPT from "./prompts/prompt.md" with { type: "text" };
import RESTARTED from "./prompts/restarted.md" with { type: "text" };
import SENDERS from "./prompts/senders.md" with { type: "text" };
import SKILLS from "./prompts/skills.md" with { type: "text" };
import STEER from "./prompts/steer.md" with { type: "text" };
import SUB from "./prompts/sub.md" with { type: "text" };
import SUB_FOLDER from "./prompts/sub-folder.md" with { type: "text" };
import SUB_PROMPT from "./prompts/sub-prompt.md" with { type: "text" };
import SUBS from "./prompts/subs.md" with { type: "text" };
import TALKING from "./prompts/talking.md" with { type: "text" };
import TEAM from "./prompts/team.md" with { type: "text" };
import TURN from "./prompts/turn.md" with { type: "text" };
import UNII from "./prompts/unii.md" with { type: "text" };
import YOU from "./prompts/you.md" with { type: "text" };

// the fixed prompts, each read from its file in config.SHARE, which the
// installer writes again each time, else the copy built in: the base of
// every agent's system prompt (prompt), the compaction prompt, every
// summary's and nothing else (compact; after upstream #37 by @tinqr: with
// one prompt for both, a turn sometimes came back a summary), the parts
// the system prompt is laid out with, Unii's and other agents' default
// prompts, the goal check's, and the fixed text of each turn's and each
// compaction's request
const BUILT = { agent: AGENT, compact: COMPACT, "compact-agent": COMPACT_AGENT, continue: CONTINUE, device: DEVICE, "device-shell": DEVICE_SHELL, devices: DEVICES, "devices-none": DEVICES_NONE, "go-on": GO_ON, goal: GOAL, "goal-ask": GOAL_ASK, "goal-no": GOAL_NO, jobs: JOBS, leaf: LEAF, merge: MERGE, message: MESSAGE, "message-working": MESSAGE_WORKING, "not-summarized": NOT_SUMMARIZED, over: OVER, prompt: PROMPT, restarted: RESTARTED, senders: SENDERS, skills: SKILLS, steer: STEER, sub: SUB, "sub-folder": SUB_FOLDER, "sub-prompt": SUB_PROMPT, subs: SUBS, talking: TALKING, team: TEAM, turn: TURN, unii: UNII, you: YOU };

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

// the names a new message's sender goes by (senders.md: "key: name" lines)
export function sender(key: "user" | "uniichat" | "timer" | "job" | "agent"): string {
  const line = prompt("senders").split("\n").find((l) => l.startsWith(key + ":"));
  return line === undefined ? key : line.slice(key.length + 1).trim();
}
