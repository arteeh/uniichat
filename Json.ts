function has<K extends string>(x: unknown, k: K): x is Record<K, unknown> {
  return typeof x === "object" && x !== null && k in x;
}

export function get(x: unknown, k: string): unknown {
  return has(x, k) ? x[k] : undefined;
}

export function str(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined;
}

export function text_of(x: unknown, or = ""): string {
  const shown = String(x);
  return x === undefined || x === null ? or : shown;
}

export function rec(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function list(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}
