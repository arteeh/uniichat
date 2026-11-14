import { Database } from "bun:sqlite";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as config from "./Config.ts";
import { Disk } from "./Disk.ts";
import { get, text_of } from "./Json.ts";
import { Push } from "./Push.ts";
import { SIGN_IN, SIGN_IN_FORM } from "./View.ts";

// a device's sign-in (session: the hash of its key), or the browser
// sign-in code of `ki serve login` (tries: its wrong ones so far)
type Ticket = { session: string | null; what: string; tries?: number };

export const FILE = config.DIR + "/ki.db";

const COOKIE = "ki";

const KEEP = "; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000";

const ACTS = 7 * 864e5;

const LINK  = 15 * 60 * 1000;
const WAIT  = 5 * 60 * 1000;
const ASKS  = 100;

// a sign-in code's ticket is kept as the hash of this and the code
const LOGIN = "login ";
const TRIES = 5;

const WEB_PUSHES = 32;

const SCHEMA = `
create table if not exists sessions (hash text primary key, what text not null default '', at integer not null default 0);
create table if not exists tickets  (hash text primary key, data text not null, expires integer not null);
create table if not exists web_pushes (endpoint text primary key, p256dh text not null, auth text not null, session text not null);
create trigger if not exists web_pushes_go after delete on sessions begin delete from web_pushes where session = old.hash; end;
create table if not exists acts     (id text primary key, ans text not null, at integer not null);
create index if not exists acts_big on acts (at) where ans <> '{}';
`;

let DB: Database | null = null;
const WAITS = new Map<string, () => void>();

export namespace Owner {

  export function open(): Database {
    if (DB === null) {
      fs.mkdirSync(config.DIR, { recursive: true, mode: 0o700 });
      DB = Disk.db(FILE);
      DB.run(SCHEMA);
    }
    return DB;
  }

  export function hash(token: string): string {
    return new Bun.CryptoHasher("sha256").update(token).digest("hex");
  }

  export function token(req: Request): string {
    const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const cookies = (req.headers.get("cookie") ?? "").split(/;\s*/);
    const cookie = cookies.find((c) => c.startsWith(COOKIE + "=")) ?? "";
    return auth || decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  }

  export function is(req: Request): boolean {
    return Owner.open().query("select 1 from sessions where hash = ?").get(Owner.hash(Owner.token(req))) !== null;
  }

  export function random(): string {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  }

  export function ticket(data: Ticket): string {
    const db = Owner.open();
    const token = Owner.random();
    db.query("delete from tickets where expires < ?").run(Date.now());
    db.query("insert into tickets values (?, ?, ?)").run(Owner.hash(token), JSON.stringify(data), Date.now() + LINK);
    return token;
  }

  export function ticket_read(token: string, use: boolean): Ticket | null {
    const sql = use ? "delete from tickets where hash = ? and expires >= ? returning data" : "select data from tickets where hash = ? and expires >= ?";
    const row = Owner.open().query(sql).get(Owner.hash(token), Date.now()) as { data: string } | null;
    return row === null ? null : (JSON.parse(row.data) as Ticket);
  }

  export function code(session: string): string {
    return (parseInt(session.slice(0, 8), 16) % 1e6).toString().padStart(6, "0");
  }

  export function kept(): Set<string> {
    return new Set((Owner.open().query("select hash from sessions").all() as { hash: string }[]).map((r) => r.hash));
  }

  export async function sessions(revoke?: string): Promise<void> {
    const db = Owner.open();
    const rows = db.query("select hash, what, at from sessions order by rowid").all() as { hash: string; what: string; at: number }[];
    if (revoke === "--all") {
      db.query("delete from sessions").run();
      return console.log("Signed out " + rows.length + " session" + (rows.length === 1 ? "" : "s") + ": every browser and device signs in again.");
    }
    if (revoke !== undefined) {
      const row = rows[Number(revoke) - 1];
      if (!/^\d+$/.test(revoke) || row === undefined) {
        throw new Error("no session " + revoke + (rows.length === 0 ? ": there are none" : ": `ki serve sessions` numbers them 1 to " + rows.length));
      }
      db.query("delete from sessions where hash = ?").run(row.hash);
      return console.log("Signed out " + revoke + " (" + (row.what || "a session") + ").");
    }
    const Client = await import("./Client.ts");
    const mine = new Map<string, string>([[Owner.hash(text_of(Client.read("device").token)), "this computer's device"]]);
    const kind = (what: string) => (what.startsWith("the device ") ? "device" : what === "a browser" ? "browser" : "-");
    const when = (at: number) => (at > 0 ? new Date(at).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "before arteeh.17");
    rows.forEach((r, i) => console.log(String(i + 1).padStart(3) + ". " + kind(r.what).padEnd(9) + (r.what || "-").padEnd(32) + " signed in " + when(r.at) + (mine.has(r.hash) ? "  (" + mine.get(r.hash) + ")" : "")));
    console.log(rows.length === 0 ? "No sessions." : "Last use isn't tracked. `ki serve sessions revoke <n>` signs one out; `--all`, all.");
  }

  // one code at a time: a new one replaces the one before, in one write
  // that another `ki serve login` waits for
  export function cli(): void {
    const db = Owner.open();
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
    db.transaction(() => {
      db.query("delete from tickets where expires < ? or data ->> 'session' is null").run(Date.now());
      db.query("insert into tickets values (?, ?, ?)").run(Owner.hash(LOGIN + code), JSON.stringify({ session: null, what: "", tries: 0 }), Date.now() + LINK);
    }).immediate();
    console.log("Sign-in code: " + code + "\n\nType it on this server's sign-in page, at whatever address you open it, within 15 minutes. It works once.");
  }

  // Secure when the request came over https (or a proxy says it did), as
  // Safari drops a Secure cookie that an http page (127.0.0.1) sets
  export function cookie(req: Request): string {
    const proto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
    return KEEP + (new URL(req.url).protocol === "https:" || proto === "https" ? "; Secure" : "");
  }

  export function act_put(id: string, ans: object): void {
    const db = Owner.open();
    db.query("update acts set ans = '{}' where at < ? and ans <> '{}'").run(Date.now() - ACTS);
    db.query("insert or ignore into acts values (?, ?, ?)").run(id, JSON.stringify(ans), Date.now());
  }

  export function act_get(id: string): object | null {
    const row = Owner.open().query("select ans from acts where id = ?").get(id) as { ans: string } | null;
    return row === null ? null : (JSON.parse(row.ans) as object);
  }

  export async function http(req: Request): Promise<Response | null> {
    const db = Owner.open();
    const url = new URL(req.url);
    const owner = Owner.is(req);
    switch (url.pathname) {
      case "/api/login": {
        const body: unknown = await req.json().catch(() => ({}));
        const key = text_of(get(body, "key"));
        const asks = db.query("select count(*) n from tickets where expires >= ? and data ->> 'session' is not null").get(Date.now()) as { n: number };
        if (key.length < 32 || asks.n >= ASKS) {
          return Response.json({ error: key.length < 32 ? "No key." : "Too many sign-ins waiting: try again in 15 minutes." }, { status: key.length < 32 ? 400 : 429 });
        }
        const session = Owner.hash(key);
        const what = text_of(get(body, "what"), "a device").replace(/[^\w .,:@()-]/g, "").slice(0, 80);
        return Response.json({ ticket: Owner.ticket({ session, what }), code: Owner.code(session) });
      }
      case "/auth": {
        const t = url.searchParams.get("t") ?? "";
        if (req.method === "POST") {
          return Owner.confirm(req);
        }
        if (t === "") {
          return Owner.page_login("");
        }
        const link = Owner.ticket_read(t, false);
        if (link === null || link.session === null) {
          return Owner.page("This sign-in link expired", "Start the device again for a new one.");
        }
        return owner ? Owner.page_confirm(t, link.what, "") : Owner.page("Sign in this browser first", "Run <code>ki serve login</code> on the server's computer and type the code it prints on this server's sign-in page, then open this link again.");
      }
      case "/api/wait": {
        if (owner) {
          return Response.json({ ok: true });
        }
        const hash = Owner.hash(Owner.token(req));
        const waits = db.query("select 1 from tickets where expires >= ? and data ->> 'session' = ?").get(Date.now(), hash) !== null;
        if (!waits) {
          return Response.json({ error: "The sign-in link expired." }, { status: 410 });
        }
        const signed = await new Promise<boolean>((done) => {
          const timer = setTimeout(() => done(false), WAIT);
          WAITS.set(hash, () => { clearTimeout(timer); done(true); });
          req.signal.addEventListener("abort", () => { clearTimeout(timer); done(false); });
        });
        WAITS.delete(hash);
        return Response.json({ ok: signed }, signed ? {} : { status: 408 });
      }
      case "/api/logout": {
        db.query("delete from sessions where hash = ?").run(Owner.hash(Owner.token(req)));
        return Owner.out();
      }
    }
    if (!owner) {
      return null;
    }
    switch (url.pathname) {
      case "/api/me": {
        return Response.json({ ok: true });
      }
      case "/api/webpush": {
        return Owner.web_subscribe(req);
      }
    }
    return null;
  }

  export async function web_subscribe(req: Request): Promise<Response> {
    const db = Owner.open();
    const session = Owner.hash(Owner.token(req));
    if (req.method === "GET") {
      const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";
      const row = db.query("select 1 from web_pushes where endpoint = ? and session = ?").get(endpoint, session);
      return Response.json({ key: Push.keys()?.public ?? null, on: row !== null });
    }
    const body: unknown = await req.json().catch(() => null);
    if (req.method === "DELETE") {
      db.query("delete from web_pushes where endpoint = ?").run(text_of(get(body, "endpoint")));
      return Response.json({ ok: true });
    }
    const sub = Push.sub_read(body);
    if (req.method !== "POST" || sub === null || (await Push.inside(sub.endpoint))) {
      return Response.json({ error: "Not a push subscription" }, { status: 400 });
    }
    const sql = "insert or replace into web_pushes select ?, ?, ?, hash from sessions where hash = ?";
    if (db.query(sql).run(sub.endpoint, sub.p256dh, sub.auth, session).changes === 0) {
      return Response.json({ error: "Signed out" }, { status: 401 });
    }
    db.query("delete from web_pushes where rowid not in (select rowid from web_pushes order by rowid desc limit ?)").run(WEB_PUSHES);
    return Response.json({ ok: true });
  }

  export function out(): Response {
    return new Response(null, { status: 204, headers: { "set-cookie": COOKIE + "=; Path=/; Max-Age=0" } });
  }

  export async function confirm(req: Request): Promise<Response> {
    const form = await req.formData().catch(() => new FormData());
    const field = (name: string) => {
      const got = form.get(name);
      return typeof got === "string" ? got : "";
    };
    const t = field("t");
    const typed = field("code").replace(/\D/g, "");
    if (t === "") {
      return Owner.login(req, typed);
    }
    const link = Owner.ticket_read(t, false);
    if (link === null || link.session === null || !Owner.is(req)) {
      return Owner.page("This sign-in link expired", "Start the device again for a new one.");
    }
    if (typed !== Owner.code(link.session)) {
      return Owner.page_confirm(t, link.what, "That code didn't match. Check the code it shows and try again.");
    }
    Owner.open().query("insert or ignore into sessions values (?, ?, ?)").run(link.session, link.what, Date.now());
    Owner.ticket_read(t, true);
    WAITS.get(link.session)?.();
    return Owner.page("Signed in", "You can close this tab and go back to " + Owner.safe(link.what) + ".");
  }

  // a browser signs in with the code of `ki serve login`: used once, and
  // gone after TRIES wrong ones; it stays on the address it came in on
  export function login(req: Request, typed: string): Response {
    const db = Owner.open();
    const live = db.query("select hash from tickets where expires >= ? and data ->> 'session' is null and data ->> 'tries' is not null").get(Date.now()) as { hash: string } | null;
    if (live === null) {
      return Owner.page_login("No sign-in code is waiting: run <code>ki serve login</code> again for a new one.");
    }
    const used = typed.length === 6 && db.query("delete from tickets where hash = ? and expires >= ? returning 1").get(Owner.hash(LOGIN + typed), Date.now()) !== null;
    if (!used) {
      const row = db.query("update tickets set data = json_set(data, '$.tries', (data ->> 'tries') + 1) where hash = ? returning data ->> 'tries' as tries").get(live.hash) as { tries: number } | null;
      if (row !== null && row.tries >= TRIES) {
        db.query("delete from tickets where hash = ?").run(live.hash);
        return Owner.page_login(TRIES + " wrong codes: this sign-in code works no more. Run <code>ki serve login</code> again for a new one.");
      }
      return Owner.page_login("That code didn't match. Check the code <code>ki serve login</code> printed and try again.");
    }
    db.query("delete from sessions where hash = ?").run(Owner.hash(Owner.token(req)));
    const token = Owner.random();
    db.query("insert into sessions values (?, ?, ?)").run(Owner.hash(token), "a browser", Date.now());
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": COOKIE + "=" + token + Owner.cookie(req) } });
  }

  export function page_login(err: string): Response {
    const note = err === "" ? "" : `<p class="err">${err}</p>`;
    return Owner.page("Sign in", `${SIGN_IN}</p>${note}${SIGN_IN_FORM}<p>`);
  }

  export function page_confirm(t: string, what: string, err: string): Response {
    const note = err === "" ? "" : `<p class="err">${err}</p>`;
    return Owner.page("Sign in " + Owner.safe(what), `Type the code it shows to let it use this server as you.</p>${note}<form method="post" action="/auth"><input type="hidden" name="t" value="${Owner.safe(t)}"><input name="code" inputmode="numeric" autocomplete="off" autofocus aria-label="code"><button type="submit">Confirm</button></form><p>`);
  }

  export function safe(s: string): string {
    return s.replace(/[<>&"]/g, "");
  }

  export function page(title: string, body: string): Response {
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Ki</title><link rel="stylesheet" href="/style.css"></head><body class="solo"><main><h1>${title}</h1><p class="sub">${body}</p></main></body></html>`;
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

}
