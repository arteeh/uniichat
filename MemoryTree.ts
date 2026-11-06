import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { Memory } from "./Memory.ts";

type Part = { l: number; i: number };
type Record = Part & { text: string | null; source?: string };
type Input = { text: string; source: string };

export namespace MemoryTree {

  export function range(mem: Memory, { l, i }: Part): boolean {
    return Number.isInteger(l) && l >= 0 && l <= 30 && Number.isInteger(i) && i >= 0 && (i + 1) * 2 ** l <= mem.count;
  }

  export function record(mem: Memory, value: unknown, part?: Part): asserts value is Record {
    if (typeof value !== "object" || value === null) {
      throw new Error("invalid memory tree record");
    }
    const rec = value as Record;
    if (!MemoryTree.range(mem, rec) || (part !== undefined && (rec.l !== part.l || rec.i !== part.i)) || (rec.text !== null && typeof rec.text !== "string") || (rec.source !== undefined && (typeof rec.source !== "string" || !/^sha256-v1:[0-9a-f]{64}$/.test(rec.source)))) {
      throw new Error("unsupported memory tree record");
    }
  }

  export function input(mem: Memory, l: number, i: number): Input | null {
    if (!MemoryTree.range(mem, { l, i })) {
      return null;
    }
    const root = l === 0 ? Memory.message(mem, i) : null;
    if (root !== null && root.i !== i) {
      throw new Error("memory message index points to another record");
    }
    const halves = Memory.halves({ l, i });
    const children = halves.map((half) => Memory.read(mem, "tree", Memory.slot(half.l, half.i)));
    if (l === 0 ? root === null : children.some((child) => child === null)) {
      return null;
    }
    const texts: string[] = [];
    for (const [k, child] of children.entries()) {
      MemoryTree.record(mem, child, halves[k]);
      if (child.text === null) {
        return null;
      }
      texts.push(Memory.flat(child.text));
    }
    const text = root === null ? texts.join("\n") : root.line ?? Memory.show(root);
    const source = "sha256-v1:" + createHash("sha256").update(JSON.stringify([l, i, root ?? children])).digest("hex");
    return { text, source };
  }

  export function audit(mem: Memory): Part[] {
    const bad = new Set<number>();
    const invalid: Part[] = [];
    for (let l = 0; 2 ** l <= mem.count; l++) {
      for (let i = 0; (i + 1) * 2 ** l <= mem.count; i++) {
        const part = { l, i };
        const key = Memory.slot(l, i);
        const rec = Memory.read(mem, "tree", key);
        if (rec === null) {
          bad.add(key);
          continue;
        }
        MemoryTree.record(mem, rec, part);
        const input = MemoryTree.input(mem, l, i);
        // Complete legacy records have no fingerprint; retain them without rewriting history.
        const legacy = rec.source === undefined;
        if (input === null || Memory.halves(part).some((half) => bad.has(Memory.slot(half.l, half.i))) || (!legacy && rec.source !== input.source)) {
          bad.add(key);
          invalid.push(part);
        }
      }
    }
    return invalid;
  }

  export function closure(mem: Memory, parts: Part[]): Part[] {
    const all = new Map<number, Part>();
    for (const part of parts) {
      if (!MemoryTree.range(mem, part)) {
        throw new Error("memory invalidation outside complete message ranges");
      }
      for (let { l, i } = part; MemoryTree.range(mem, { l, i }); l++, i = Math.floor(i / 2)) {
        const key = Memory.slot(l, i);
        if (all.has(key)) {
          break;
        }
        all.set(key, { l, i });
      }
    }
    return [...all.values()];
  }

  export function sync(file: string): void {
    if (process.platform === "win32" && fs.statSync(file).isDirectory()) {
      return;
    }
    const fd = fs.openSync(file, process.platform === "win32" ? "r+" : "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  export function quarantine(mem: Memory, parts: Part[], reason: string): Part[] {
    const records = parts.flatMap((part) => {
      const rec = Memory.read(mem, "tree", Memory.slot(part.l, part.i));
      if (rec === null) {
        return [];
      }
      MemoryTree.record(mem, rec, part);
      return [{ ...part, record: rec }];
    });
    if (records.length === 0) {
      return [];
    }
    const dir = mem.dir + "/tree-quarantine";
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(dir).isSymbolicLink()) {
      throw new Error("memory quarantine must not be a symlink");
    }
    fs.chmodSync(dir, 0o700);
    const at = new Date().toISOString();
    const file = dir + "/" + at.replaceAll(":", "-") + "-" + randomUUID() + ".json";
    fs.writeFileSync(file, JSON.stringify({ at, reason, count: records.length, keys: records.map(({ l, i }) => [l, i]), records }) + "\n", { mode: 0o600, flag: "wx" });
    MemoryTree.sync(file);
    MemoryTree.sync(dir);
    MemoryTree.sync(mem.dir);
    return records.map(({ l, i }) => ({ l, i }));
  }

}
