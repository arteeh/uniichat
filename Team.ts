import { Owner } from "./Owner.ts";
import { get as field } from "./Json.ts";

// prompt null: the default, which follows renames until it's edited
export type Agent = { id: string; name: string; about: string; picture: string; prompt: string | null; archived: number; made: number; unread: number };

type Fields = { name: string; about: string; picture: string; prompt: string | null };

export const UNII = "unii";

const SCHEMA = "create table if not exists agents (id text primary key, name text not null, about text not null, picture text not null, prompt text, archived integer not null default 0, made integer not null, unread integer not null default 0)";

const NAME  = 24;
const ABOUT = 120;
const OWN   = 64 * 1024;

const HEADS = 24;

const PROMPT      = "You are {Name}.";
const UNII_PROMPT = "You are {Name}, the user's executive assistant and main point of contact. You see what every agent does and what the user tells them; keep track of it all and answer for the whole team.";
const UNII_ABOUT  = "Executive assistant: keeps track of the whole team.";

export namespace Team {

  export function open(): void {
    const db = Owner.open();
    db.run(SCHEMA);
    if (Team.get(UNII) === null) {
      db.query("insert into agents (id, name, about, picture, prompt, made) values (?, ?, ?, ?, null, 0)").run(UNII, "Unii", UNII_ABOUT, UNII);
    }
  }

  export function all(): Agent[] {
    return Owner.open().query("select * from agents order by id <> 'unii', made").all() as Agent[];
  }

  export function active(): Agent[] {
    return Team.all().filter((a) => a.archived === 0);
  }

  export function get(id: string): Agent | null {
    return (Owner.open().query("select * from agents where id = ?").get(id) as Agent | null) ?? null;
  }

  export function by_name(name: string): Agent | null {
    return Team.all().find((a) => a.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
  }

  export function prompt(a: Agent): string {
    return a.prompt ?? Team.default_prompt(a.id, a.name);
  }

  export function default_prompt(id: string, name: string): string {
    return (id === UNII ? UNII_PROMPT : PROMPT).replace("{Name}", name);
  }

  // the fields a form sent, checked: a text saying what's wrong, or the
  // fields to keep (a prompt that is the default is kept as none)
  export function fields(x: unknown, id: string | null): Fields | string {
    const text = (k: string) => (typeof field(x, k) === "string" ? String(field(x, k)) : "");
    const name = text("name").trim();
    const about = text("about").trim();
    const picture = text("picture").trim() || Team.head_random();
    const own = text("prompt").trim();
    const taken = Team.by_name(name);
    if (name === "" || name.length > NAME) {
      return "A name is 1 to " + NAME + " characters.";
    }
    if (name.includes("@")) {
      return "A name has no @.";
    }
    if (taken !== null && taken.id !== id) {
      return taken.name + " is taken" + (taken.archived === 0 ? "." : ", by an archived agent.");
    }
    if (about === "" || about.length > ABOUT || /[\r\n]/.test(about)) {
      return "A description is one line of 1 to " + ABOUT + " characters.";
    }
    if (!Team.picture_ok(picture, id)) {
      return "No picture " + picture + ".";
    }
    if (own === "") {
      return "A system prompt is needed.";
    }
    if (own.length > OWN) {
      return "A system prompt holds at most " + OWN / 1024 + " KB.";
    }
    return { name, about, picture, prompt: own === Team.default_prompt(id ?? "", name) ? null : own };
  }

  export function picture_ok(picture: string, id: string | null): boolean {
    const head = /^head-(\d\d)$/.exec(picture);
    return (head !== null && Number(head[1]) >= 1 && Number(head[1]) <= HEADS) || /^\/media\/[0-9a-f]{16}\.(png|jpeg|webp)$/.test(picture) || (picture === UNII && id === UNII);
  }

  export function head_random(): string {
    return "head-" + String(1 + Math.floor(Math.random() * HEADS)).padStart(2, "0");
  }

  export function add(f: Fields): Agent {
    let id = "";
    do {
      id = "a" + Math.random().toString(36).slice(2, 9);
    } while (Team.get(id) !== null);
    Owner.open().query("insert into agents (id, name, about, picture, prompt, made) values (?, ?, ?, ?, ?, ?)").run(id, f.name, f.about, f.picture, f.prompt, Date.now());
    return Team.get(id) as Agent;
  }

  export function set(id: string, f: Fields): Agent | null {
    Owner.open().query("update agents set name = ?, about = ?, picture = ?, prompt = ? where id = ?").run(f.name, f.about, f.picture, f.prompt, id);
    return Team.get(id);
  }

  export function archive(id: string, on: boolean): void {
    Owner.open().query("update agents set archived = ? where id = ? and id <> 'unii'").run(on ? Date.now() : 0, id);
  }

  export function drop(id: string): void {
    Owner.open().query("delete from agents where id = ? and id <> 'unii'").run(id);
  }

  export function unread(id: string, n: number | null): void {
    const sql = n === null ? "update agents set unread = unread + 1 where id = ?" : "update agents set unread = ? where id = ?";
    Owner.open().query(sql).run(...(n === null ? [id] : [n, id]));
  }

}
