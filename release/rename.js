// The installers run this with the new ki as bun (BUN_BE_BUN=1), with no
// server on DIR, after unii's data moved there: it gives the data ki's
// names. unii.db becomes ki.db; the main agent keeps its id unii and its
// folder agents/unii, and gets the lead field (it sees every agent's chat),
// its picture "unii" becomes "logo"; in every agent's memory the kind
// "unii" becomes "reply". Memory indexes of changed streams are removed:
// ki rebuilds them at its next start. Each step is skipped once done, so a
// run stopped halfway goes on where it stopped.
import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
const dir = process.argv[2];
const there = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const write = (p, text) => { fs.writeFileSync(p + ".new", text); fs.renameSync(p + ".new", p); };

if (there(path.join(dir, "unii.db")) && !there(path.join(dir, "ki.db"))) {
  for (const end of ["-wal", "-shm", ""]) {
    if (there(path.join(dir, "unii.db" + end))) fs.renameSync(path.join(dir, "unii.db" + end), path.join(dir, "ki.db" + end));
  }
}
const agents = path.join(dir, "agents");
if (there(path.join(dir, "ki.db")) || there(path.join(agents, "unii"))) {
  const db = new Database(path.join(dir, "ki.db"));
  // as Team.ts makes it; 39 had none: 40.rc's ki made it at its first start
  db.run("create table if not exists agents (id text primary key, name text not null, about text not null, picture text not null, prompt text, lead integer not null default 0, archived integer not null default 0, made integer not null, unread integer not null default 0)");
  if (!db.query("pragma table_info(agents)").all().some((c) => c.name === "lead")) {
    db.run("alter table agents add column lead integer not null default 0");
  }
  if (there(path.join(agents, "unii"))) {
    db.run("insert or ignore into agents (id, name, about, picture, prompt, made) values ('unii', 'Unii', 'Executive assistant: automatically keeps track of the whole team.', 'unii', null, 0)");
  }
  db.run("update agents set lead = 1 where id = 'unii' and not exists (select 1 from agents where lead = 1)");
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
let files = 0;
const walk = (d, agent) => {
  for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      walk(p, agent ?? p);
    } else if (e.isFile() && /\.jsonl?$/.test(e.name)) {
      const text = fs.readFileSync(p, "utf8");
      if (!text.includes('"unii"')) continue;
      const out = e.name.endsWith(".jsonl") ? text.split("\n").map((line) => (line.trim() === "" ? line : fixed(line))).join("\n") : fixed(text);
      if (out === text) continue;
      const stream = path.basename(d);
      if (agent !== undefined && (stream === "main" || stream === "tree") && path.dirname(d) === agent) {
        fs.rmSync(path.join(agent, stream + ".index"), { force: true });
      }
      write(p, out);
      files += 1;
    }
  }
};
for (const e of fs.existsSync(agents) ? fs.readdirSync(agents, { withFileTypes: true }) : []) {
  if (e.isDirectory()) walk(path.join(agents, e.name), path.join(agents, e.name));
}
if (files > 0) console.log("  Gave " + files + (files === 1 ? " memory file" : " memory files") + " in " + agents + " ki's names.");
