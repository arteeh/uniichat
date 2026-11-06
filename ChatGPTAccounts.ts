import * as fs from "node:fs";
import * as path from "node:path";
import { get } from "./Json.ts";

export type ChatGPTAccount = { id: number; label: string; connected: boolean };

export namespace ChatGPTAccounts {

  export function file(primary: string, id: number): string {
    return id === 1 ? primary : primary.replace(/(\.json)?$/, "-" + id + ".json");
  }

  export function list(primary: string): ChatGPTAccount[] {
    const stem = path.basename(primary).replace(/\.json$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp("^" + stem + "-([1-9]\\d*)\\.json$");
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.dirname(primary));
    } catch {}
    const ids = [1, ...names.flatMap((name) => {
      const match = pattern.exec(name);
      const id = Number(match?.[1]);
      return Number.isSafeInteger(id) && id > 1 ? [id] : [];
    })].filter((id) => fs.existsSync(ChatGPTAccounts.file(primary, id))).sort((a, b) => a - b);
    return ids.map((id) => {
      let connected = false;
      let who = "";
      try {
        const auth: unknown = JSON.parse(fs.readFileSync(ChatGPTAccounts.file(primary, id), "utf8"));
        const tokens = get(auth, "tokens");
        connected = typeof get(tokens, "access_token") === "string" && typeof get(tokens, "refresh_token") === "string";
        const token = get(tokens, "id_token");
        if (typeof token === "string") {
          const claims: unknown = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
          const email = get(claims, "email");
          const plan = get(get(claims, "https://api.openai.com/auth"), "chatgpt_plan_type");
          who = typeof email === "string" ? email + (typeof plan === "string" ? " (" + plan + ")" : "") : "";
        }
      } catch {}
      return { id, label: "Account " + id + (who ? " · " + who : "") + (connected ? "" : " (sign in again)"), connected };
    });
  }

}
