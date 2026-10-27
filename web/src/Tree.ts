import { must } from "./Dom.ts";

type Meta = { count: number; has: string[]; parts: [number, number][]; view: Got[] };

type Got = { h: string; t: string; k?: string };

type Card = HTMLDivElement & {
  firstChild: HTMLElement; lastChild: HTMLElement;
  li: number[]; v: number[]; fresh: boolean; one?: boolean; thin?: boolean; dy: number; eased: ReturnType<typeof setTimeout> | undefined;
};

type Base = [number, number, number, number, number, number, number];

type Q = [...Base, number[], number, number];

type Plan = { level: [number, number][]; A: number[]; P: Float64Array; slot: number[]; find: (m: number) => number; cards: Q[][]; total: number };

type Old = Map<string, number[]> & { total?: number };

type Which = "TREE" | "VIEW";

const LEGEND: Record<Which, string> = { VIEW: "What Unii's prompt holds now, in order: old messages as summaries, recent ones whole.", TREE: "" };

const S = {
  want  : null as Which | null,
  asked : 0,
  run   : null as { show: (which: Which) => void; stop: () => void } | null,
};

export function tree_show(which: Which): void {
  const was = S.want;
  S.want = which;
  tabs(which);
  if (S.run !== null) {
    S.run.show(which);
    focus(which);
    return;
  }
  if (was !== null) {
    return;
  }
  const me = ++S.asked;
  fetch("/api/tree").then((r) => (r.ok ? (r.json() as Promise<Meta>) : Promise.reject(new Error("HTTP " + r.status)))).then((meta) => {
    if (me === S.asked && S.want !== null) {
      S.run = start(meta);
      S.run.show(S.want);
      focus(S.want);
    }
  }, () => {
    if (me === S.asked && S.want !== null) {
      S.want = null;
      $(".legend").textContent = "Could not read the memory. Try again in a moment.";
    }
  });
}

export function tree_hide(): void {
  if (S.want === null) {
    return;
  }
  S.want = null;
  S.asked++;
  S.run?.stop();
  S.run = null;
  $(".view").replaceChildren();
  $(".bracket").replaceChildren();
  $(".view").classList.remove("on");
  $(".bracket").classList.remove("on", "drag");
}

function $(sel: string): HTMLElement {
  return document.querySelector("#tree " + sel) as HTMLElement;
}

// (the sections have tabindex -1: Firefox focuses no other)
function focus(which: Which): void {
  $(which === "TREE" ? ".bracket" : ".view").focus({ preventScroll: true });
}

function tabs(which: Which): void {
  $(".prev").hidden = $(".next").hidden = which !== "TREE";
  $(".legend").innerHTML = LEGEND[which];
  document.querySelectorAll<HTMLElement>("#tree .tab").forEach((a) => a.classList.toggle("here", a.dataset.tab === which));
  $(".view").classList.toggle("on", which === "VIEW");
  $(".bracket").classList.toggle("on", which === "TREE");
}

function start(meta: Meta): { show: (which: Which) => void; stop: () => void } {
const ac = new AbortController(), signal = ac.signal;
const N = meta.count, B = meta.has, V = meta.parts;
const tree = $(".bracket"), back = $(".prev") as HTMLButtonElement, next = $(".next") as HTMLButtonElement;
$(".view").replaceChildren(...meta.view.flatMap(({ h, t }) => {
  const [a, b] = [document.createElement("h4"), document.createElement("pre")];
  a.textContent = h;
  b.textContent = t;
  return [a, b];
}));
tree.replaceChildren(...["ROOT", ...B.map((_, l) => "LVL" + l)].map((name) => {
  const col = document.createElement("div"), h3 = document.createElement("h3");
  col.className = "col";
  h3.tabIndex = 0;
  h3.textContent = name;
  col.append(h3);
  return col;
}));
tree.scrollTop = 0;
let which: Which = "TREE";
const cols = [...tree.children] as HTMLElement[], em = parseFloat(getComputedStyle(tree).fontSize), G = .75 * em, Y = 2.6 * em, HC = 9 * em;
const HL = 1.5 * 11.5, HM = .7 * 11.5, PB = .7 * em, calm = matchMedia("(prefers-reduced-motion: reduce)");
tree.style.setProperty("--card", HC + "px");
const T = B.length - 1, vt = Math.max(-1, ...V.map((p) => p[0])), seen = new Set(V.map((p) => p.join(".")));
const has = (l: number, i: number) => (l < 0 ? i < N : B[l][i] === "1"), at = (l: number, i: number) => i * 2 ** Math.max(0, l), len = (l: number) => 2 ** Math.max(0, l);
const note = document.createElement("p");
note.className = "note";
const lo = <T,>(list: ArrayLike<T>, ok: (x: T) => boolean) => { let a = 0, z = list.length; while (a < z) { const m = (a + z) >> 1; ok(list[m]) ? (z = m) : (a = m + 1); } return a; };
const step = () => cols[1].offsetLeft - cols[0].offsetLeft || 1;
const got = new Map<string, Got | null>(), shown = new Map<string, Card>();
let L = vt, plan!: Plan, moving = 0, wait: ReturnType<typeof setTimeout> | undefined, width = 0, started = false, left = 0, sliding = false, done: () => void = () => {}, goal: number | null = null, big: Card | null = null;
const height = (_l: number, _i: number) => HC;
const level_nodes = (L: number) => Array.from({ length: L < 0 ? N : B[L].length }, (_, i) => [L, i] as [number, number]);
const layout = (L: number): Plan => {
  const level = level_nodes(L), A = level.map((p) => at(...p)), slot = level.map((p) => height(...p) + G), P = new Float64Array(level.length + 1);
  const find = (m: number) => lo(A, (a) => a > m) - 1;
  const sums = () => slot.forEach((s, k) => (P[k + 1] = P[k] + s));
  const ups: [number, number, number][][] = [];
  for (let l = L + 1; l <= T; l++) {
    sums();
    ups[l] = [];
    for (let i = 0; i < B[l].length; i++) {
      const a = find(i * 2 ** l), b = find((i + 1) * 2 ** l - 1) + 1, short = height(l, i) + G - (P[b] - P[a]);
      short > 0 && (slot[b - 1] += short);
      ups[l].push([i, a, b]);
    }
  }
  sums();
  const bases: Base[][] = cols.map(() => []);
  const halves = (l: number, i: number, y: number, h: number, d: number) => {
    if (l < 0) return;
    const n = len(l) / len(l - 1), g = Math.min(G, .08 * h), k = (h - (n - 1) * g) / n;
    if (k < 2) return;
    for (let j = 0; j < n; j++) {
      const c = at(l, i) / len(l - 1) + j, t = y + j * (k + g);
      bases[l].push([l - 1, c, t, k, at(l - 1, c), at(l - 1, c) + len(l - 1), d]);
      halves(l - 1, c, t, k, d + 1);
    }
  };
  level.forEach(([l, i], k) => {
    const t = P[k] + (slot[k] - G - height(l, i)) / 2;
    bases[L + 1].push([l, i, t, height(l, i), A[k], A[k] + len(l), 0]);
    halves(l, i, t, height(l, i), 1);
  });
  ups.forEach((list, l) => list.forEach(([i, a, b]) => bases[l + 1].push([l, i, (P[a] + P[b] - G - height(l, i)) / 2, height(l, i), at(l, i), at(l, i) + len(l), 0])));
  const cards = bases.map((list, c) => list.map((q, x): Q => {
    const v = link(bases, c, x);
    return [...q, v, v[2] < 0 ? q[2] : Math.min(q[2], q[2] + v[1]), v[2] < 0 ? q[2] + q[3] : Math.max(q[2] + q[3], q[2] + v[1] + v[2] + 1)];
  }));
  return { level, A, P, slot, find, cards, total: P[level.length] };
};
const link = (cards: Base[][], c: number, x: number) => {
  const [l, i, y, h, a, b] = cards[c][x], mid = y + h / 2, kids = cards[c - 1] ?? [];
  const up = c <= T && at(l, i) < B[c].length * 2 ** c ? 1 : 0;
  const k0 = kids[lo(kids, (q) => q[4] >= a)], k1 = kids[lo(kids, (q) => q[4] >= b) - 1];
  if (!k0 || k0[4] !== a || !k1) return [up, 0, -1, 0];
  const y0 = Math.min(k0[2] + k0[3] / 2, mid), y1 = Math.max(k1[2] + k1[3] / 2, mid);
  return [up, y0 - y, y1 - y0, mid - y0];
};
const make = (l: number, i: number) => {
  const s = document.createElement("div") as Card;
  let x = got.get(l + "." + i);
  s.className = seen.has(l + "." + i) ? "s wait in" : "s wait";
  s.tabIndex = 0;
  s.li = [l, i];
  s.append(document.createElement("h4"), document.createElement("pre"));
  s.firstChild.textContent = l < 0 ? "ROOT #" + i : "LVL" + l + " #" + at(l, i) + (l > 0 ? "-" + (at(l, i) + len(l) - 1) : "");
  if (!has(l, i)) {
    s.classList.add("none");
    x = { h: s.firstChild.textContent, t: "Not summarized yet." };
  }
  if (x) {
    fill(s, x);
  }
  return s;
};
const fill = (s: Card, x: Got) => {
  s.classList.remove("wait");
  if (x.k !== undefined && /^\w+$/.test(x.k)) {
    s.classList.add(x.k);
  }
  s.firstChild.textContent = x.h;
  s.lastChild.textContent = x.t;
  s.fresh = true;
};
const near = () => [Math.floor(tree.scrollLeft / step()) - 1, (tree.scrollLeft + tree.clientWidth) / step()];
const load = () => {
  const y = tree.scrollTop, sh = tree.clientHeight, [c0, c1] = near(), want = [...shown].filter(([, s]) => !s.thin).map(([k]) => k);
  plan.cards.forEach((list, c) => {
    for (let x = c < c0 || c > c1 ? list.length : lo(list, (q) => q[9] >= y - 4 * sh); x < list.length && list[x][8] <= y + 5 * sh; x++) {
      list[x][6] < 2 && want.push(list[x][0] + "." + list[x][1]);
    }
  });
  const keys = [...new Set(want)].filter((k) => !got.has(k) && has(...(k.split(".").map(Number) as [number, number])));
  for (let j = 0; j < keys.length; j += 200) {
    const part = keys.slice(j, j + 200), put = (list: (Got | null)[]) => {
      if (signal.aborted) return;
      part.forEach((k, x) => {
        const one = list[x] ?? { h: k, t: "(none)" };
        got.set(k, one);
        const s = shown.get(k);
        if (s !== undefined) {
          fill(s, one);
        }
      });
      moving || draw();
    };
    part.forEach((k) => got.set(k, null));
    fetch("/api/tree?get=" + part.join(","), { signal }).then((r) => r.json() as Promise<(Got | null)[]>).then(put, () => put(part.map((k) => ({ h: k, t: "Could not load this: reload the page." }))));
  }
};
const draw = (y = tree.scrollTop, e = 1, old?: Old) => {
  if (signal.aborted) return;
  const p = plan, sh = tree.clientHeight, keep = new Set<string>(), [c0, c1] = near();
  cols.forEach((col, c) => {
    col.style.height = Y + Math.max(p.total, e < 1 ? old?.total ?? 0 : 0) + 4 * em + "px";
    const list = p.cards[c];
    for (let x = c < c0 || c > c1 ? list.length : lo(list, (q) => q[9] >= y - sh / 2); x < list.length && list[x][8] <= y + 1.5 * sh; x++) {
      const [l, i, t, h, , , , [up, ...v]] = list[x], k = l + "." + i, w = e < 1 && old !== undefined && (old.get(k) ?? from(old, l, i));
      const s = shown.get(k) ?? make(l, i);
      s.parentNode !== col && col.append(s);
      shown.set(k, s);
      keep.add(k);
      s.v = [t, h, ...v].map((z, j) => (w ? w[j] + (z - w[j]) * e : z));
      s.classList.toggle("up", up === 1);
      s.classList.toggle("dn", v[1] >= 0);
      pos(s);
    }
  });
  shown.forEach((s, k) => keep.has(k) || (s === big && shut(true), s.remove(), shown.delete(k)));
  const upto = L < 0 ? N : B[L].length * 2 ** L;
  upto < N ? (note.textContent = (N - upto === 1 ? "Message #" + upto + " isn't" : "Messages #" + upto + "-" + (N - 1) + " aren't") + " in a LVL" + L + " summary yet: each holds " + 2 ** L + ".") : note.remove();
  if (upto < N) {
    note.style.top = Y + p.total + "px";
    if (note.parentNode !== cols[L + 1]) {
      cols[L + 1].append(note);
    }
  }
  y !== tree.scrollTop && (tree.scrollTop = y);
  back.disabled = tree.scrollLeft < 1;
  next.disabled = tree.scrollLeft + tree.clientWidth >= tree.scrollWidth - 1;
  load();
  const fresh = [...shown.values()].filter((s) => s.fresh && !s.one);
  fresh.map((s) => s.lastChild.scrollHeight > s.lastChild.clientHeight + 1).forEach((cut, j) => {
    const s = fresh[j];
    s.fresh = false;
    s.classList.toggle("more", cut);
    cut ? s.setAttribute("aria-expanded", String(s === big)) : s.removeAttribute("aria-expanded");
  });
};
const pos = (s: Card) => {
  const [t, hc, a, h, m] = s.v, d = s === big ? s.dy : 0, f = Math.max(0, Math.min(1, 2 * hc / HC - 1)), one = hc < HC - 1;
  s.style.top = Y + t + d + "px";
  s === big || (s.style.height = hc + "px");
  ([["--t", a - d], ["--h", h], ["--m", m], ["--c", hc / 2 - d], ["--hm", Math.max(0, (1 - f) * (hc - HL) / 2 + f * HM)], ["--pb", f * PB]] as [string, number][]).forEach(([name, z]) => s.style.setProperty(name, z + "px"));
  s.style.setProperty("--o", String(f));
  if (one !== (s.one ?? false)) {
    s.one = one;
    s.classList.toggle("one", one);
    s.tabIndex = one ? -1 : 0;
    s.fresh = !s.classList.contains("wait");
  }
  s.classList.toggle("line", f < .2);
  s.thin = hc < HL;
  s.classList.toggle("thin", s.thin);
};
const from = (old: Old, l: number, i: number) => {
  for (let u = l + 1; u <= T; u++) {
    const w = old.get(u + "." + Math.floor(at(l, i) / len(u)));
    if (w) return [w[0] + w[1] / 2, 0, 0, -1, 0];
  }
  return null;
};
const ease = (s: Card) => {
  s.getBoundingClientRect();
  s.classList.add("ease");
  clearTimeout(s.eased);
  s.eased = setTimeout(() => s.classList.remove("ease"), 200);
};
const grow = (s: Card) => {
  const pre = s.lastChild;
  s.classList.add("big");
  s.style.height = "auto";
  pre.style.flex = "none";
  const need = s.offsetHeight, top0 = Y + s.v[0], st = tree.scrollTop, sh = tree.clientHeight;
  s.style.height = pre.style.flex = "";
  const hb = Math.min(need, Math.max(HC, sh - Y - G));
  if (hb <= HC + 1) return s.classList.remove("big", "more"), s.removeAttribute("aria-expanded");
  let top = top0 + (HC - hb) / 2;
  top = Math.max(st + Y, Math.min(top, st + sh - G - hb));
  top = Math.max(Y, Math.min(top, Y + plan.total - G - hb));
  big = s;
  s.dy = top - top0;
  s.setAttribute("aria-expanded", "true");
  ease(s);
  s.style.height = hb + "px";
  pos(s);
};
const shut = (now?: boolean) => {
  const s = big;
  if (!s) return;
  big = null;
  s.classList.remove("big");
  s.setAttribute("aria-expanded", "false");
  s.lastChild.scrollTop = 0;
  now ? s.classList.remove("ease") : ease(s);
  s.style.height = "";
  pos(s);
};
const press = (s: Card) => {
  if (s.one) return shut(), slide(cols.indexOf(s.parentNode as HTMLElement));
  const sel = must(getSelection(), "a selection");
  if (s === big) return (sel.isCollapsed || !s.contains(sel.anchorNode)) && shut();
  shut();
  s.classList.contains("more") && grow(s);
};
const anchor = () => {
  const { level, A, P, slot } = plan, k = Math.max(0, Math.min(plan.level.length - 1, lo(P, (z) => z > tree.scrollTop) - 1)), d = tree.scrollTop - P[k];
  return level.length ? { key: level[k].join("."), d, m: A[k] + Math.min(.999, d / slot[k]) * len(level[k][0]) } : null;
};
const place = (a: ReturnType<typeof anchor>, p: Plan) => {
  if (!a) return 0;
  const k = p.find(Math.floor(a.m)), [l, i] = p.level[k];
  return p.P[k] + (l + "." + i === a.key ? Math.min(a.d, p.slot[k]) : ((a.m - p.A[k]) / len(l)) * p.slot[k]);
};
// (not while sliding to another column: setting scrollTop would stop it;
// its end packs anew)
const redo = () => {
  if (!moving && !sliding) {
    const a = anchor();
    plan = layout(L);
    draw(place(a, plan));
  }
};
const pack = () => {
  if (signal.aborted) return;
  const to = Math.max(-1, Math.min(T, Math.round(tree.scrollLeft / step()) - 1));
  // (a scroll event coming after the end, from where it ended, is no slide)
  left = tree.scrollLeft;
  sliding = false;
  goal = null;
  if (to === L) return moving || redo();
  shut(true);
  const a = anchor(), old: Old = new Map(), y0 = tree.scrollTop, t0 = performance.now(), me = ++moving, D = calm.matches ? 0 : 300;
  plan.cards.forEach((list) => list.forEach((q) => old.set(q[0] + "." + q[1], [q[2], q[3], ...q[7].slice(1)])));
  shown.forEach((s, k) => old.set(k, s.v));
  old.total = plan.total;
  L = to;
  plan = layout(L);
  const y1 = place(a, plan);
  const frame = (now: number) => {
    const e = D ? Math.min(1, (now - t0) / D) : 1, f = 1 - (1 - e) ** 3;
    if (me === moving) {
      if (e < 1) {
        draw(y0 + (y1 - y0) * f, f, old);
        requestAnimationFrame(frame);
      } else {
        done();
      }
    }
  };
  done = () => me === moving && ((moving = 0), draw(y1));
  requestAnimationFrame(frame);
};
const end = "onscrollend" in tree;
// (not while a mouse drags it: each step it sets ends a scroll; its
// slide to a column, once let go, restores the snap)
tree.addEventListener(end ? "scrollend" : "scroll", () => {
  if (drag?.on) return;
  tree.classList.remove("drag");
  clearTimeout(wait);
  wait = setTimeout(pack, end ? 0 : 150);
}, { signal });
// a slide the user starts mid-ease ends the ease where it is (setting
// scrollTop would stop the slide)
tree.addEventListener("scroll", () => {
  if (tree.scrollLeft !== left) {
    [left, sliding, moving] = [tree.scrollLeft, true, 0];
    shut(true);
  }
  moving || draw();
}, { signal });
plan = layout(L);
const show = () => {
  which === "TREE" || shut(true);
  if (which === "TREE" && tree.clientWidth > 0) {
    // as wide a column, as much text cut? (a phone's bar coming and
    // going changes the height only)
    if (cols[0].offsetWidth !== width) {
      width = cols[0].offsetWidth;
      shut(true);
      shown.forEach((s) => (s.fresh = !s.classList.contains("wait")));
    }
    if (!started) {
      started = true;
      tree.scrollLeft = (L + 1) * step();
    }
    redo();
  }
};
addEventListener("resize", show, { signal });
const slide = (c: number) => {
  goal = Math.max(0, Math.min(cols.length - 1, c));
  done();
  tree.scrollTo({ left: goal * step(), behavior: calm.matches ? "instant" : "smooth" });
};
let drag: { x: number; y: number; left: number; id: number; on: boolean } | null = null, dragged = false;
tree.addEventListener("pointerdown", (e) => {
  dragged = false;
  const bar = e.target === tree && e.offsetX >= tree.clientWidth;
  drag = e.pointerType === "mouse" && e.button === 0 && !bar && !(e.target as HTMLElement).closest(".big, h3") ? { x: e.clientX, y: e.clientY, left: tree.scrollLeft, id: e.pointerId, on: false } : null;
}, { signal });
addEventListener("pointermove", (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.on) {
    if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) return void (drag = null);
    if (Math.abs(dx) < 8) return;
    drag.on = dragged = true;
    shut(true);
    tree.classList.add("drag");
  }
  getSelection()?.removeAllRanges();
  tree.scrollLeft = drag.left - dx;
}, { signal });
const drop = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  const on = drag.on;
  drag = null;
  if (!on) return;
  const c = Math.max(0, Math.min(Math.round(tree.scrollLeft / step()), Math.ceil((tree.scrollWidth - tree.clientWidth) / step())));
  if (Math.abs(tree.scrollLeft - c * step()) < 1) {
    tree.classList.remove("drag");
    pack();
  } else {
    slide(c);
  }
};
addEventListener("pointerup", drop, { signal });
addEventListener("pointercancel", drop, { signal });
tree.addEventListener("click", (e) => dragged && ((dragged = false), e.stopPropagation(), e.preventDefault()), { capture: true, signal });
const here = () => goal ?? Math.round(tree.scrollLeft / step());
back.addEventListener("click", () => slide(here() - 1), { signal });
next.addEventListener("click", () => slide(Math.min(here() + 1, Math.ceil((tree.scrollWidth - tree.clientWidth) / step()))), { signal });
const go = (t: HTMLElement) => {
  const col = t.closest("h3")?.parentNode as HTMLElement | undefined;
  col && slide(cols.indexOf(col));
};
tree.addEventListener("click", (e) => {
  const s = (e.target as HTMLElement).closest<Card>(".s");
  if (s) {
    press(s);
  } else {
    shut();
    go(e.target as HTMLElement);
  }
}, { signal });
tree.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if ((e.key === "Enter" || e.key === " ") && t.matches("h3, .s")) {
    e.preventDefault();
    t.matches("h3") ? go(t) : press(t as Card);
  }
}, { signal });
addEventListener("click", (e: MouseEvent) => tree.contains(e.target as Node) || shut(), { signal });
addEventListener("keydown", (e: KeyboardEvent) => e.key === "Escape" && big && (big.focus({ preventScroll: true }), shut()), { signal });
let viewed = false;
return {
  show: (w: Which) => {
    if (w === "VIEW" && !viewed) {
      viewed = true;
      $(".view").scrollTop = 0;
    }
    which = w;
    show();
  },
  stop: () => ((moving = 0), clearTimeout(wait), ac.abort()),
};
}
