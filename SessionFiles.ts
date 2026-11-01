// Terminal-only session discovery; browser imports do not load fs APIs.
import * as fs from "node:fs";
import * as path from "node:path";
import { import_session, type Session } from "./Import.ts";

export async function session_files(dir: string, skipped: (path: string) => void = () => {}): Promise<Session[]> {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".jsonl") && !name.split(path.sep).includes("subagents"));
  const found: Session[] = [];
  for (const name of files) {
    const file = path.join(dir, name);
    try {
      const session = await import_session(Bun.file(file), "log");
      if (session !== null) found.push(session);
    } catch { skipped(file); }
  }
  return found;
}
