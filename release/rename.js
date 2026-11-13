// The installers run this with the new ki as bun (BUN_BE_BUN=1), with no
// server on DIR, after unii's data moved there: it gives the data ki's
// names. unii.db becomes ki.db; the main agent's id and picture "unii"
// become "main", its folder agents/unii agents/main; in every agent's
// memory the kind "unii" becomes "reply" and the sender or origin "unii"
// "main". Memory indexes of changed streams are removed: ki rebuilds them
// at its next start. Each step is skipped once done, so a run stopped
// halfway goes on where it stopped.
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
if (there(path.join(dir, "ki.db"))) {
  const db = new Database(path.join(dir, "ki.db"));
  if (db.query("select 1 from sqlite_master where type = 'table' and name = 'agents'").get() !== null) {
    db.run("update agents set id = 'main' where id = 'unii' and not exists (select 1 from agents where id = 'main')");
    db.run("update agents set picture = 'main' where picture = 'unii'");
  }
  db.close();
}
const agents = path.join(dir, "agents");
if (there(path.join(agents, "unii")) && !there(path.join(agents, "main"))) {
  fs.renameSync(path.join(agents, "unii"), path.join(agents, "main"));
}

const fix = (v) => {
  if (Array.isArray(v)) return v.map(fix);
  if (v === null || typeof v !== "object") return v;
  for (const k of Object.keys(v)) {
    if (v[k] === "unii" && k === "kind") v[k] = "reply";
    else if (v[k] === "unii" && (k === "from" || k === "origin")) v[k] = "main";
    else v[k] = fix(v[k]);
  }
  return v;
};
// a line that isn't JSON (one cut short) is left as it is
const fixed = (text) => {
  if (!text.includes('"unii"')) return text;
  try { return JSON.stringify(fix(JSON.parse(text))); } catch { return text; }
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
