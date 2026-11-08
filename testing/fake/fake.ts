import { get, list, str } from "../../Json.ts";
import type { Kind } from "./cases.ts";
import { CONTROL, type Order } from "./server.ts";

const USE = `fake reply "text"              the next call streams this text
fake reply --think "t" "text"  the same after thinking "t" for 5 s (Claude only)
fake tool NAME 'JSON' [...]    the next call asks for these tools
fake error KIND [--reset 5m]   the next call fails: prompt-too-long, overloaded, rate-limit, usage-limit, auth-expired
fake stall 60s | fake cut      the next stream hangs that long, or drops halfway
fake log | fake last [--json]  what the app sent: every call, or the last one (--json: its headers and body)
fake clear                     forget what's queued, limits and refused sign-ins
--match TEXT                   only for the call whose latest message contains TEXT (the newest part of a turn's message, or a tool's result)`;

const KINDS: Kind[] = ["prompt-too-long", "overloaded", "rate-limit", "usage-limit", "auth-expired"];

const BASE = "http://127.0.0.1:" + CONTROL;

function span(s: string | undefined): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(s ?? "");
  if (m === null) {
    throw new Error("not a duration: " + String(s) + " (60s, 5m, 1h)");
  }
  const unit: Record<string, number> = { ms: 1, s: 1e3, m: 60e3, h: 3600e3 };
  return Number(m[1]) * unit[m[2] ?? "s"];
}

function flag(args: string[], name: string): string | undefined {
  const k = args.indexOf(name);
  return k < 0 ? undefined : args.splice(k, 2)[1];
}

function order(what: string | undefined, args: string[], reset: string | undefined): Order {
  switch (what) {
    case "reply": {
      const think = flag(args, "--think");
      return { what, text: args.join(" "), ...(think === undefined ? {} : { think }) };
    }
    case "tool": {
      const calls: Array<[string, unknown]> = [];
      for (let k = 0; k < args.length; k += 2) {
        calls.push([args[k], JSON.parse(args[k + 1] ?? "{}")]);
      }
      return { what, calls };
    }
    case "error": {
      const kind = KINDS.find((k) => k === args[0]);
      if (kind === undefined) {
        throw new Error("fake error " + KINDS.join(" | "));
      }
      return { what, kind, reset: Date.now() + span(reset ?? (kind === "usage-limit" ? "1h" : "60s")) };
    }
    case "stall":
      return { what, ms: span(args[0]) };
    case "cut":
      return { what };
  }
  throw new Error(USE);
}

function shown(seen: unknown): string {
  const said = list(get(seen, "said"));
  const system = str(get(seen, "system")) ?? "";
  const out = [String(get(seen, "n")) + " " + String(get(seen, "at")) + " " + String(get(seen, "vendor")) + " " + String(get(seen, "model")) + " -> " + String(get(seen, "answer"))];
  out.push("system (" + system.length + " chars): " + system.slice(0, 300).replace(/\n/g, " ") + (system.length > 300 ? " ..." : ""));
  out.push("tools: " + list(get(seen, "tools")).map(String).join(", "));
  said.forEach((m, k) => {
    const text = str(get(m, "text")) ?? "";
    const labels = text.match(/^(Turn:.*|A new message from [^:\n]+:)$/gm) ?? [];
    out.push("[" + k + "] " + String(get(m, "role")) + (get(m, "marked") === true ? " (cache mark)" : "") + ", " + text.length + " chars" + (labels.length > 0 ? ": " + labels.join(" / ") : ""));
  });
  out.push("latest message:\n" + (str(get(seen, "latest")) ?? "").slice(0, 2000));
  return out.join("\n");
}

async function main(args: string[]): Promise<void> {
  const match = flag(args, "--match") ?? "";
  const json = args.includes("--json");
  const what = args.shift();
  if (what === "log" || what === "last") {
    const got: unknown = await (await fetch(BASE + "/" + what + "?match=" + encodeURIComponent(match))).json();
    const log = list(get(got, "log"));
    if (what === "last") {
      console.log(log.length === 0 ? "no calls yet" : json ? JSON.stringify({ headers: get(log[0], "headers"), body: get(log[0], "body") }, null, 2) : shown(log[0]));
    } else {
      log.forEach((s) => console.log([get(s, "n"), get(s, "at"), get(s, "vendor"), get(s, "path"), get(s, "model"), JSON.stringify(get(s, "latest")), "->", get(s, "answer")].map(String).join(" ")));
    }
    const queue = list(get(got, "queue"));
    console.log(queue.length === 0 ? "queue: empty" : "queue: " + queue.map((o) => JSON.stringify(o)).join(", "));
    return;
  }
  if (what === "clear") {
    await fetch(BASE + "/clear", { method: "POST" });
    return;
  }
  const reset = flag(args, "--reset");
  const res = await fetch(BASE + "/queue", { method: "POST", body: JSON.stringify({ ...order(what, args, reset), match }) });
  console.log("queued, " + String(get(await res.json(), "queued")) + " waiting");
}

await main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
