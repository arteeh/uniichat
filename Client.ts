import * as fs from "node:fs";
import * as os from "node:os";
import * as View from "./View.ts";
import { write_whole } from "./Write.ts";

export const DIR   = (process.env.XDG_CONFIG_HOME || os.homedir() + "/.config") + "/unii";
export const LOCAL = "http://127.0.0.1:8788";

export function read(name: string): Record<string, any> {
  try {
    const json = JSON.parse(fs.readFileSync(DIR + "/" + name + ".json", "utf8"));
    return json !== null && typeof json === "object" && !Array.isArray(json) ? json : {};
  } catch {
    return {};
  }
}

export function write(name: string, conf: object): void {
  const file = DIR + "/" + name + ".json";
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  write_whole(file, JSON.stringify(conf, null, 2) + "\n");
}

export function server(given: string | undefined, conf: Record<string, any>): string {
  return (given ?? process.env.UNII_URL ?? conf.url ?? LOCAL).replace(/\/$/, "");
}

export function auth(token: string | undefined): Record<string, string> {
  return token ? { authorization: "Bearer " + token } : {};
}

export async function signed(url: string, token: string | undefined): Promise<boolean> {
  if (!token) {
    return false;
  }
  const res = await fetch(url + "/api/me", { headers: auth(token) }).catch(() => null);
  return res === null || res.status !== 401;
}

export async function login(url: string, what: string): Promise<string> {
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const out = await View.post(url + "/api/login", { key, what });
  if (typeof out.url !== "string") {
    fail(out.error ?? "no sign-in from " + url);
  }
  console.log("To sign " + what + " in to " + url + ", open this link in a browser signed in there");
  console.log("(on the server, `unii serve link` signs a browser in):\n\n  " + out.url + "\n");
  console.log("and type this code: " + out.code + "\n");
  const wait = { headers: auth(key), timeout: false } as RequestInit;
  while (true) {
    const done = await fetch(url + "/api/wait", wait).catch(() => null);
    const ans  = await done?.json().catch(() => ({})) ?? {};
    if (done?.status === 410) {
      fail("the sign-in link expired: run unii again");
    }
    if (done?.ok && ans.ok) {
      console.log("Signed in.");
      return key;
    }
    if (done?.status !== 408) {
      await Bun.sleep(View.RETRY);
    }
  }
}

export function fail(why: string): never {
  console.error("unii: " + why);
  process.exit(1);
}

export function host(url: string): string {
  return new URL(url).host;
}
