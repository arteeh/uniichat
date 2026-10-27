// what the page's own markup always has: an error if it doesn't
export function must<T>(x: T | null | undefined, what: string): T {
  if (x === null || x === undefined) {
    throw new Error("no " + what);
  }
  return x;
}

export function find<T extends Element>(root: ParentNode, sel: string, type: { new (): T; prototype: T }): T {
  const el = root.querySelector(sel);
  if (!(el instanceof type)) {
    throw new Error("no " + sel);
  }
  return el;
}
