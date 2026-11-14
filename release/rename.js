// The installers run this with the new ki as bun (BUN_BE_BUN=1), with no
// server on DIR, after unii's data moved there: it gives the data ki's
// names. unii.db becomes ki.db; the main agent keeps its id unii and its
// folder agents/unii, and its picture "unii" becomes "logo"; in every
// agent's memory the kind "unii" becomes "reply" (in ki's own files only:
// the user's are left as they are). Memory indexes of changed streams are removed:
// ki rebuilds them at its next start. Each step is skipped once done, so a
// run stopped halfway goes on where it stopped. With CONF (ki's config
// folder), a device's saved work folder that was unii's default moves too.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Database } from "bun:sqlite";
const [dir, conf] = process.argv.slice(2);
const there = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const write = (p, text) => { fs.writeFileSync(p + ".new", text); fs.renameSync(p + ".new", p); };

// both: a ki started on a folder whose move stopped halfway made a new,
// empty ki.db beside unii's. Which to keep is the user's call
if (there(path.join(dir, "unii.db")) && there(path.join(dir, "ki.db"))) {
  console.log("  " + dir + " has both unii.db (unii's sign-ins, agents and settings) and ki.db (made by a ki that started on it before it was moved over), and which one to keep isn't clear. Move ki.db (and ki.db-wal, ki.db-shm) aside to keep unii's, or unii.db (and its -wal, -shm) to keep ki's, then run the installer again.");
  process.exit(1);
}
if (there(path.join(dir, "unii.db")) && !there(path.join(dir, "ki.db"))) {
  for (const end of ["-wal", "-shm", ""]) {
    if (there(path.join(dir, "unii.db" + end))) fs.renameSync(path.join(dir, "unii.db" + end), path.join(dir, "ki.db" + end));
  }
}
const agents = path.join(dir, "agents");
if (there(path.join(dir, "ki.db")) || there(path.join(agents, "unii"))) {
  const db = new Database(path.join(dir, "ki.db"));
  // as Team.ts makes it; 39 had none: 40.rc's ki made it at its first start
  db.run("create table if not exists agents (id text primary key, name text not null, about text not null, picture text not null, prompt text, archived integer not null default 0, made integer not null, unread integer not null default 0)");
  if (there(path.join(agents, "unii"))) {
    db.run("insert or ignore into agents (id, name, about, picture, prompt, made) values ('unii', 'Unii', 'The user''s assistant.', 'unii', null, 0)");
  }
  db.run("update agents set picture = 'logo' where picture = 'unii'");
  db.close();
}

let changed = false;
const fix = (v) => {
  if (Array.isArray(v)) return v.map(fix);
  if (v === null || typeof v !== "object") return v;
  for (const k of Object.keys(v)) {
    if (v[k] === "unii" && k === "kind") { v[k] = "reply"; changed = true; }
    else v[k] = fix(v[k]);
  }
  return v;
};
// a line that isn't JSON (one cut short) is left as it is
const fixed = (text) => {
  if (!text.includes('"unii"')) return text;
  try { changed = false; const out = JSON.stringify(fix(JSON.parse(text))); return changed ? out : text; } catch { return text; }
};
// only the files ki itself writes there: the memory streams (main/, tree/),
// queue.json and view.json, and the subagents' state in docs/agent/; never
// the user's files (docs/media/, uploads, anything else)
let files = 0;
const names = (d, test) => {
  try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && test.test(e.name)).map((e) => path.join(d, e.name)); } catch { return []; }
};
const redo = (p, agent, stream) => {
  const text = fs.readFileSync(p, "utf8");
  if (!text.includes('"unii"')) return;
  const out = p.endsWith(".jsonl") ? text.split("\n").map((line) => (line.trim() === "" ? line : fixed(line))).join("\n") : fixed(text);
  if (out === text) return;
  if (stream !== undefined) fs.rmSync(path.join(agent, stream + ".index"), { force: true });
  write(p, out);
  files += 1;
};
for (const e of fs.existsSync(agents) ? fs.readdirSync(agents, { withFileTypes: true }) : []) {
  if (!e.isDirectory() || e.name.startsWith(".")) continue;
  const a = path.join(agents, e.name);
  for (const stream of ["main", "tree"]) for (const p of names(path.join(a, stream), /^\d{4}-\d\d-\d\d\.jsonl$/)) redo(p, a, stream);
  for (const p of names(a, /^(queue|view)\.json$/)) redo(p, a);
  for (const p of names(path.join(a, "docs", "agent"), /\.jsonl?$/)) redo(p, a);
}
if (files > 0) console.log("  Gave " + files + (files === 1 ? " memory file" : " memory files") + " in " + agents + " ki's names.");

// unii's device saved its default work folder, ~/.unii/work, in its
// device.json: once ~/.unii is gone (moved, or never there), it is ki's,
// where the move took it (<dir>/work), else ki's default
if (conf !== undefined) {
  const file = path.join(conf, "device.json");
  const home = os.homedir();
  const slash = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  const was = saved !== null && typeof saved === "object" && typeof saved.work === "string" ? saved.work : null;
  if (was !== null && ["~/.unii/work", slash(path.join(home, ".unii", "work"))].includes(slash(was)) && !there(path.join(home, ".unii"))) {
    const moved = path.join(path.resolve(dir), "work");
    const now = there(moved) && slash(moved) !== slash(path.join(home, ".ki", "work")) ? moved : "~/.ki/work";
    const mode = fs.statSync(file).mode & 0o777;
    fs.writeFileSync(file + ".new", JSON.stringify({ ...saved, work: now }, null, 2) + "\n", { mode });
    fs.renameSync(file + ".new", file);
    console.log("  The device's work folder is " + now + " now (it was " + was + ").");
  }
}
