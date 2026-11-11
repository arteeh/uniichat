import type { Block, End, Say } from "./AskAI.ts";
import * as config from "./Config.ts";
import { list as items, rec, text_of } from "./Json.ts";
import * as Names from "./Names.ts";
import { EFFORTS, Pick } from "./Pick.ts";
import type { Run } from "./Run.ts";

// subagents (#116): one-off agents an agent spawns for a task, each with
// its own run, its log in its spawner's folder; done once it has reported,
// never woken again

export type Role = { model: string | null; effort: string | null };

export type Spawn = { task: string; role: Role; memory: boolean };

// doing: what it does now, since at (a tool's name, thinking, a usage limit)
export type Sub<M> = {
  name    : string;
  role    : Role;
  task    : string;
  view    : Block[];
  replies : string[];
  why     : string | null;
  run     : Run<Say, M>;
  doing   : string;
  at      : number;
};

// a subagent's row in the chat list
export type Row = { name: string; face: string; task: string; model: string; effort: string; doing: string; at: number };

const NOTE = "subagent";
const ON   = " on ";
const AT   = " at effort ";
const BARE = " without view";
const ROLE = new RegExp("^" + NOTE + "(?:" + ON + "(\\S+))?(?:" + AT + "(\\S+))?(" + BARE + ")?$");

const TASK_SHOWN = 120;

export namespace Sub {

  // the models a task may name: those offered now
  export function models(): string[] {
    return [...new Set(Pick.models(config.OFFER.vendors, config.OFFER.models).map(([, m]) => m.label))];
  }

  export function spawns(args: Record<string, unknown>): Spawn[] | string {
    if (Object.keys(args).some((k) => k !== "tasks")) {
      return "Give model and effort per task, in each of tasks: { task, model?, effort?, memory? }. Nothing started.";
    }
    const models = Sub.models();
    const out: Spawn[] = [];
    for (const [k, t] of items(args.tasks).entries()) {
      const x: Record<string, unknown> = typeof t === "string" ? { task: t } : rec(t) ? t : {};
      const task = typeof x.task === "string" ? x.task.trim() : "";
      const model = x.model === undefined ? null : text_of(x.model, "null");
      const effort = x.effort === undefined ? null : text_of(x.effort, "null");
      const bad = task === "" ? "no task text" : model !== null && !models.includes(model) ? "no model " + model + "; one of " + models.join(", ") : effort !== null && !EFFORTS.includes(effort) ? "no effort " + effort + "; one of " + EFFORTS.join(", ") : null;
      if (bad !== null) {
        return "Task " + (k + 1) + (task === "" ? "" : " (" + JSON.stringify(task.length > 60 ? task.slice(0, 60) + "…" : task) + ")") + ": " + bad + ". Nothing started.";
      }
      out.push({ task, role: { model, effort }, memory: x.memory !== false });
    }
    return out.length === 0 ? "No tasks. Nothing started." : out;
  }

  // its log's first line, which says how it runs
  export function note(role: Role, memory: boolean): string {
    return NOTE + (role.model === null ? "" : ON + role.model) + (role.effort === null ? "" : AT + role.effort) + (memory ? "" : BARE);
  }

  export function role(note: string): { role: Role; memory: boolean } | null {
    const m = ROLE.exec(note);
    return m === null ? null : { role: { model: m[1] ?? null, effort: m[2] ?? null }, memory: m[3] === undefined };
  }

  // the spawner's pick, with the task's model and effort
  export function pick(base: Pick, role: Role, name: string): Pick {
    const given = role.model === null ? base : Pick.to_model(base, role.model, config.OFFER.vendors, config.OFFER);
    if (given === null) {
      throw new Error(name + "'s model " + role.model + " is no longer offered; spawn another subagent.");
    }
    return { ...given, effort: role.effort ?? given.effort };
  }

  // what its report gets from a call: its text, or why it failed, a prompt
  // too long as itself (#88, #89)
  export function ended<M>(sub: Sub<M>, end: End): void {
    sub.replies.push(end.ok ? end.text : sub.why ?? "failed: " + (end.long === true ? end.why ?? end.text : end.text));
  }

  export function report<M>(sub: Sub<M>): string {
    return "[" + sub.name + "]\n" + (sub.replies.join("\n\n").trim() || "(no reply)");
  }

  export function row<M>(sub: Sub<M>, pick: Pick | null): Row {
    const task = sub.task.replace(/\s+/g, " ").trim();
    return {
      name   : sub.name,
      face   : Names.name_face(sub.name),
      task   : task.length > TASK_SHOWN ? task.slice(0, TASK_SHOWN) + "…" : task,
      model  : pick?.model ?? sub.role.model ?? "",
      effort : pick?.effort ?? sub.role.effort ?? "",
      doing  : sub.doing,
      at     : sub.at,
    };
  }

}
