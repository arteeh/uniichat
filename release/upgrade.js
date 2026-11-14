// The installers run this every time, with the new ki as bun (BUN_BE_BUN=1),
// after unii's data was moved and given ki's names (rename.js): it brings
// the data in DIR to this version's layout, and then writes DIR/layout,
// without which a ki finding agents there won't start. A server of an older
// ki may still run on it (`ki update` from its shell): every step only adds,
// and a step done is skipped.
//
// 41: each agent keeps its own pictures and files (#169). Before, all were in
// one agent's folder (the lead's in 40, unii's in 40.rc): each agent gets
// the ones its memory names (hard links, else copies), and its uploaded
// picture becomes /media/<id>/<name>; links in memory stay as they are (ki
// finds an old /media/<name> in any agent's store). The MCP servers switched
// off in 40 (the lead's view.json "off") go to config.json's mcp_off, unless
// that has one already. 40's description of its main agent becomes the first
// agent's new one, if it was never edited.
import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
const [dir] = process.argv.slice(2);
const LAYOUT = 41;
const OLD_ABOUT = "Executive assistant: automatically keeps track of the whole team.";
const NEW_ABOUT = "The user's assistant and first point of contact.";
const say = (s) => console.log("  " + s);
const there = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
const layout = Number((read(path.join(dir, "layout")) ?? "0").trim()) || 0;
const agents = path.join(dir, "agents");
const db_file = path.join(dir, "ki.db");
if (layout >= LAYOUT || !there(agents) || !there(db_file)) {
  if (!there(path.join(dir, "layout")) && there(agents) && !there(db_file)) say(dir + " has agents but no ki.db: left as it is.");
  process.exit(0);
}

const db = new Database(db_file);
db.run("PRAGMA busy_timeout = 10000");
const has = db.query("select 1 from sqlite_master where type = 'table' and name = 'agents'").get() !== null;
const rows = has ? db.query("select * from agents order by made, id").all() : [];
// the folder that held them all: 40's lead, 40.rc's unii, else the oldest
const lead = rows.find((r) => r.lead === 1) ?? rows.find((r) => r.id === "unii") ?? rows[0];

// 41: each agent's own pictures and files
const NAME = /[0-9a-f]{16}\.[a-z0-9]{1,10}/g;
const files = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(d, e.name)); } catch { return []; } };
const keep = (from, to) => {
  if (there(to) || !there(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to + ".new"); fs.renameSync(to + ".new", to); }
  return true;
};
if (lead !== undefined) {
  const store = path.join(agents, lead.id, "docs");
  let kept = 0, pictures = 0;
  for (const a of rows) {
    const own = path.join(agents, a.id, "docs");
    const names = new Set((a.picture.match(NAME) ?? []));
    if (a.id !== lead.id && there(store)) {
      const mem = path.join(agents, a.id);
      for (const p of [...files(path.join(mem, "main")), ...files(path.join(mem, "tree")), ...files(path.join(mem, "docs", "agent")), path.join(mem, "queue.json")]) {
        const text = read(p);
        for (const name of text === null ? [] : text.match(NAME) ?? []) names.add(name);
      }
      for (const name of names) {
        for (const sub of ["media", "images"]) {
          if (keep(path.join(store, sub, name), path.join(own, sub, name))) kept += 1;
        }
        keep(path.join(store, "images", name + ".jpg"), path.join(own, "images", name + ".jpg"));
      }
    }
    const old = /^\/media\/([0-9a-f]{16}\.(png|jpeg|webp))$/.exec(a.picture);
    if (old !== null) {
      keep(path.join(store, "media", old[1]), path.join(own, "media", old[1]));
      db.query("update agents set picture = ? where id = ?").run("/media/" + a.id + "/" + old[1], a.id);
      pictures += 1;
    }
  }
  if (kept > 0) say("Gave each agent its own copy of the " + kept + (kept === 1 ? " picture or file" : " pictures and files") + " its memory names (the rest stay with " + lead.name + ").");
  if (pictures > 0) say("Each agent's uploaded picture is in its own store now.");
}

// 41: the MCP servers switched off, for every agent
if (lead !== undefined) {
  let off = [];
  try { off = JSON.parse(read(path.join(agents, lead.id, "view.json")) ?? "{}").off ?? []; } catch {}
  off = Array.isArray(off) ? off.filter((n) => typeof n === "string") : [];
  const file = path.join(dir, "config.json");
  const text = read(file);
  let conf = null;
  try { conf = text === null ? {} : JSON.parse(text); } catch {}
  if (off.length > 0 && conf !== null && typeof conf === "object" && !Array.isArray(conf) && conf.mcp_off === undefined) {
    const mode = text === null ? 0o600 : fs.statSync(file).mode & 0o777;
    fs.writeFileSync(file + ".new", JSON.stringify({ ...conf, mcp_off: off }, null, 2) + "\n", { mode });
    fs.renameSync(file + ".new", file);
    say("The MCP servers switched off (" + off.join(", ") + ") stay off, for every agent.");
  } else if (off.length > 0 && (conf === null || typeof conf !== "object" || Array.isArray(conf))) {
    say(file + " isn't plain JSON, so the MCP servers switched off before (" + off.join(", ") + ") are on again: switch them off in Settings.");
  }
}

// 41: the first agent's description
if (has) db.query("update agents set about = ? where about = ?").run(NEW_ABOUT, OLD_ABOUT);
db.close();

fs.writeFileSync(path.join(dir, "layout.new"), LAYOUT + "\n");
fs.renameSync(path.join(dir, "layout.new"), path.join(dir, "layout"));
