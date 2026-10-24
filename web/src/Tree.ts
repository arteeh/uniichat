// The memory tree (/tree)
// =======================
// A section for the view, and the tree as a bracket: a column
// for the messages, then one per level, each node beside the two it
// merges. A column holds its level's nodes only (one not built yet
// said so); the leftmost in view is packed, the columns right of it
// spread to match. It opens on the view's top level, the view's nodes
// marked "in context". Every card is as tall, its text cut (faded),
// so the tree's shape alone lays out the cards and their lines, and a
// text loaded moves nothing. The script draws the cards near the
// screen and fetches their text (/api/tree): a chat has thousands. A
// card cut, clicked or tapped, grows over its neighbours, as much up
// as down (kept on screen), its shadow on them; again, Escape or
// another click shuts it. Left of the packed column its nodes' halves,
// and theirs, are there too, with their lines: each a one-line card,
// squeezed into its parent's height, as Google's bracket shows the
// round before mid-swipe; once a swipe (touch, wheel, a mouse drag,
// ‹ ›) settles on them they ease to full height, their lines along.
//
// The app's view at /tree (TREE) and /tree#view (VIEW) (main.ts
// route), its markup index.html's #tree, its looks style.css's (under
// #tree). Each time it opens it asks /api/tree (Memory.meta) for the
// tree's shape and the view, and opens at the view's top level; hidden,
// its cards are gone and its listeners off (start's signal), so they
// run only while it shows.

// Types
// =====

// what /api/tree gives with no `get` (Memory.meta): the messages' count,
// each level's nodes built ("1": built), the view's parts and its cards
type Meta = { count: number; has: string[]; parts: [number, number][]; view: Got[] };

// a card's text (/api/tree?get=): its head, text and kind
type Got = { h: string; t: string; k?: string };

// a card drawn: its node (li), where the plan puts it (v), its text
// come and not yet measured (fresh), less than whole (one), too thin for
// its head (thin), how far it moved grown (dy)
type Card = HTMLDivElement & {
  firstChild: HTMLElement; lastChild: HTMLElement;
  li: number[]; v: number[]; fresh: boolean; one: boolean; thin: boolean; dy: number; eased: ReturnType<typeof setTimeout> | undefined;
};

// a card in a plan: [l, i, top, height, the messages it holds from, to,
// how far left of F, its lines, from where, to where it and they reach]
type Q = any[];

type Plan = { F: [number, number][]; A: number[]; P: Float64Array; slot: number[]; find: (m: number) => number; cards: Q[][]; total: number };

// where every card was, before a pack
type Old = Map<string, number[]> & { total?: number };

type Which = "TREE" | "VIEW";

// Constants
// =========

const LEGEND: Record<Which, string> = { VIEW: "What Unii's prompt holds now, in order: old messages as summaries, recent ones whole.", TREE: "" };

// the tree view's: want, the section shown (null: hidden); asked, the
// last /api/tree asked (one answered after, or once hidden, is dropped);
// run, the tree drawn
const S = {
  want  : null as Which | null,
  asked : 0,
  run   : null as { show: (which: Which) => void; stop: () => void } | null,
};

// Show
// ====

// shown at which: drawn anew if it was hidden; its section focused, as
// the old page's hash did, so keys scroll it
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
  fetch("/api/tree").then((r) => (r.ok ? r.json() : Promise.reject())).then((meta: Meta) => {
    if (me === S.asked && S.want !== null) {
      S.run = start(meta);
      S.run.show(S.want);
      focus(S.want);
    }
  }, () => {
    // (shown again, it asks again)
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

// the bar's tabs, its legend and ‹ ›, and the section, for which
function tabs(which: Which): void {
  $(".prev").hidden = $(".next").hidden = which !== "TREE";
  $(".legend").innerHTML = LEGEND[which];
  document.querySelectorAll<HTMLElement>("#tree .tab").forEach((a) => a.classList.toggle("here", a.dataset.tab === which));
  $(".view").classList.toggle("on", which === "VIEW");
  $(".bracket").classList.toggle("on", which === "TREE");
}

// Tree
// ====
// Memory.page's script, as it was, run on meta; its listeners go with
// stop.

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
// F, the leftmost column's cards: level L's nodes (L -1: the
// messages), so a node joins its two halves (the view's nodes, of
// many levels, are marked, and whole under VIEW); the messages past
// L's last node, too few for one, a note under it; every card HC
// tall, a node set mid the cards it merges; the message at the top
// of the screen stays there as L changes, which eases out over 300
// ms, as Google's bracket does
const cols = [...tree.children] as HTMLElement[], em = parseFloat(getComputedStyle(tree).fontSize), G = .75 * em, Y = 2.6 * em, HC = 9 * em;
// a card's head: its line's height, its margin over it; its bottom padding
const HL = 1.5 * 11.5, HM = .7 * 11.5, PB = .7 * em, calm = matchMedia("(prefers-reduced-motion: reduce)");
tree.style.setProperty("--card", HC + "px");
const T = B.length - 1, vt = Math.max(-1, ...V.map((p) => p[0])), seen = new Set(V.map((p) => p.join(".")));
const has = (l: number, i: number) => (l < 0 ? i < N : B[l][i] === "1"), at = (l: number, i: number) => i * 2 ** Math.max(0, l), len = (l: number) => 2 ** Math.max(0, l);
const note = document.createElement("p");
note.className = "note";
const lo = <T,>(list: ArrayLike<T>, ok: (x: T) => boolean) => { let a = 0, z = list.length; while (a < z) { const m = (a + z) >> 1; ok(list[m]) ? (z = m) : (a = m + 1); } return a; };
const step = () => cols[1].offsetLeft - cols[0].offsetLeft || 1;
const got = new Map<string, Got | null>(), shown = new Map<string, Card>();
// big: the card grown, if any
let L = vt, plan!: Plan, moving = 0, wait: ReturnType<typeof setTimeout> | undefined, width = 0, started = false, left = 0, sliding = false, done: () => void = () => {}, goal: number | null = null, big: Card | null = null;
const height = (_l: number, _i: number) => HC;
const frontier = (L: number) => Array.from({ length: L < 0 ? N : B[L].length }, (_, i) => [L, i] as [number, number]);
const layout = (L: number): Plan => {
  const F = frontier(L), A = F.map((p) => at(...p)), slot = F.map((p) => height(...p) + G), P = new Float64Array(F.length + 1);
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
  // each column's cards in order: [l, i, top, height, the messages it
  // holds from, to, how far left of F (1: F's halves)]
  const cards: Q[][] = cols.map(() => []);
  // node l.i's halves (a LVL0's: its message), at y, in its height h,
  // one under the other, a gap between, then theirs: in order, as each
  // column's go down; too thin to see, none
  const halves = (l: number, i: number, y: number, h: number, d: number) => {
    if (l < 0) return;
    const n = len(l) / len(l - 1), g = Math.min(G, .08 * h), k = (h - (n - 1) * g) / n;
    if (k < 2) return;
    for (let j = 0; j < n; j++) {
      const c = at(l, i) / len(l - 1) + j, t = y + j * (k + g);
      cards[l].push([l - 1, c, t, k, at(l - 1, c), at(l - 1, c) + len(l - 1), d]);
      halves(l - 1, c, t, k, d + 1);
    }
  };
  F.forEach(([l, i], k) => {
    const t = P[k] + (slot[k] - G - height(l, i)) / 2;
    cards[L + 1].push([l, i, t, height(l, i), A[k], A[k] + len(l), 0]);
    halves(l, i, t, height(l, i), 1);
  });
  ups.forEach((list, l) => list.forEach(([i, a, b]) => cards[l + 1].push([l, i, (P[a] + P[b] - G - height(l, i)) / 2, height(l, i), at(l, i), at(l, i) + len(l), 0])));
  // then its lines, and from where to where it and they reach: a card is
  // drawn while either is near the screen, so a line never goes missing
  // for its card being far
  cards.forEach((list, c) => list.forEach((q, x) => {
    const v = link(cards, c, x);
    q.push(v, v[2] < 0 ? q[2] : Math.min(q[2], q[2] + v[1]), v[2] < 0 ? q[2] + q[3] : Math.max(q[2] + q[3], q[2] + v[1] + v[2] + 1));
  }));
  return { F, A, P, slot, find, cards, total: P[F.length] };
};
// the lines of card x of column c: to its parent (1) or not (0), then the
// one joining its children, from its top: where it starts, its length,
// where it meets this card
const link = (cards: Q[][], c: number, x: number) => {
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
  has(l, i) || (s.classList.add("none"), (x = { h: s.firstChild.textContent, t: "Not summarized yet." }));
  x && fill(s, x);
  return s;
};
const fill = (s: Card, x: Got) => {
  s.classList.remove("wait");
  /^\w+$/.test(x.k ?? "") && s.classList.add(x.k!);
  s.firstChild.textContent = x.h;
  s.lastChild.textContent = x.t;
  s.fresh = true;
};
// the texts not here yet of the cards drawn, then of those within four
// screens, in the columns on screen and the one left of them (its cards
// one line, but whole once a swipe settles there): a quick scroll finds
// them here; not those further left, as thin
const near = () => [Math.floor(tree.scrollLeft / step()) - 1, (tree.scrollLeft + tree.clientWidth) / step()];
const load = () => {
  const y = tree.scrollTop, sh = tree.clientHeight, [c0, c1] = near(), want = [...shown.keys()].filter((k) => !shown.get(k)!.thin);
  plan.cards.forEach((list, c) => {
    for (let x = c < c0 || c > c1 ? list.length : lo(list, (q) => q[9] >= y - 4 * sh); x < list.length && list[x][8] <= y + 5 * sh; x++) {
      list[x][6] < 2 && want.push(list[x][0] + "." + list[x][1]);
    }
  });
  const keys = [...new Set(want)].filter((k) => !got.has(k) && has(...(k.split(".").map(Number) as [number, number])));
  for (let j = 0; j < keys.length; j += 200) {
    const part = keys.slice(j, j + 200), put = (list: (Got | null)[]) => {
      if (signal.aborted) return;
      part.forEach((k, x) => (got.set(k, list[x] ?? { h: k, t: "(none)" }), shown.has(k) && fill(shown.get(k)!, got.get(k)!)));
      moving || draw();
    };
    part.forEach((k) => got.set(k, null));
    fetch("/api/tree?get=" + part.join(","), { signal }).then((r) => r.json()).then(put, () => put(part.map((k) => ({ h: k, t: "Could not load this: reload the page." }))));
  }
};
// the cards near y; e < 1: on the way from `old` (a card not in it
// from its parent's middle), their sizes and lines too
const draw = (y = tree.scrollTop, e = 1, old?: Old) => {
  if (signal.aborted) return;
  const p = plan, sh = tree.clientHeight, keep = new Set<string>(), [c0, c1] = near();
  cols.forEach((col, c) => {
    col.style.height = Y + Math.max(p.total, e < 1 ? old!.total! : 0) + 4 * em + "px";
    const list = p.cards[c];
    for (let x = c < c0 || c > c1 ? list.length : lo(list, (q) => q[9] >= y - sh / 2); x < list.length && list[x][8] <= y + 1.5 * sh; x++) {
      const [l, i, t, h, , , , [up, ...v]] = list[x], k = l + "." + i, w = e < 1 && (old!.get(k) ?? from(old!, l, i));
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
  upto < N && ((note.style.top = Y + p.total + "px"), note.parentNode !== cols[L + 1] && cols[L + 1].append(note));
  y !== tree.scrollTop && (tree.scrollTop = y);
  back.disabled = tree.scrollLeft < 1;
  next.disabled = tree.scrollLeft + tree.clientWidth >= tree.scrollWidth - 1;
  load();
  // the cards whose text came, whole: is it cut? (all read, then all
  // marked; a one-line card's once it's whole)
  const fresh = [...shown.values()].filter((s) => s.fresh && !s.one);
  fresh.map((s) => s.lastChild.scrollHeight > s.lastChild.clientHeight + 1).forEach((cut, j) => {
    const s = fresh[j];
    s.fresh = false;
    s.classList.toggle("more", cut);
    cut ? s.setAttribute("aria-expanded", String(s === big)) : s.removeAttribute("aria-expanded");
  });
};
// a card where plan puts it (s.v), its lines too; grown (big), dy from
// there, its lines kept where they were. Less than whole (one), its text
// fades and its head goes mid it, one line (none, too thin)
const pos = (s: Card) => {
  const [t, hc, a, h, m] = s.v, d = s === big ? s.dy : 0, f = Math.max(0, Math.min(1, 2 * hc / HC - 1)), one = hc < HC - 1;
  s.style.top = Y + t + d + "px";
  s === big || (s.style.height = hc + "px");
  ([["--t", a - d], ["--h", h], ["--m", m], ["--c", hc / 2 - d], ["--hm", Math.max(0, (1 - f) * (hc - HL) / 2 + f * HM)], ["--pb", f * PB]] as [string, number][]).forEach(([name, z]) => s.style.setProperty(name, z + "px"));
  s.style.setProperty("--o", String(f));
  if (one !== !!s.one) {
    s.one = one;
    s.classList.toggle("one", one);
    s.tabIndex = one ? -1 : 0;
    s.fresh = !s.classList.contains("wait");
  }
  // (its head one line while its text hardly shows, so it wraps unseen)
  s.classList.toggle("line", f < .2);
  s.thin = hc < HL;
  s.classList.toggle("thin", s.thin);
};
// where a card not in plan `old` comes from: its parent's (or theirs')
// middle, no height, no lines
const from = (old: Old, l: number, i: number) => {
  for (let u = l + 1; u <= T; u++) {
    const w = old.get(u + "." + Math.floor(at(l, i) / len(u)));
    if (w) return [w[0] + w[1] / 2, 0, 0, -1, 0];
  }
  return null;
};
// a change of size or place eased (ease: on top meanwhile)
const ease = (s: Card) => {
  s.offsetHeight;
  s.classList.add("ease");
  clearTimeout(s.eased);
  s.eased = setTimeout(() => s.classList.remove("ease"), 200);
};
// card s grown to its text, up to the screen's height, as much up as
// down, then moved onto the screen and into the tree if it would leave
// them; its neighbours stay
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
// the card grown back (now: not eased)
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
// a click on a card: it shuts if grown (unless its text is being
// selected), else the one grown shuts and it grows, if cut
const press = (s: Card) => {
  if (s.one) return shut(), slide(cols.indexOf(s.parentNode as HTMLElement));
  const sel = getSelection()!;
  if (s === big) return (sel.isCollapsed || !s.contains(sel.anchorNode)) && shut();
  shut();
  s.classList.contains("more") && grow(s);
};
// the message at the top of the screen, as F's card holding it, how far
// into it, and the message as a fraction; where it is in plan p
const anchor = () => {
  const { F, A, P, slot } = plan, k = Math.max(0, Math.min(plan.F.length - 1, lo(P, (z) => z > tree.scrollTop) - 1)), d = tree.scrollTop - P[k];
  return F.length ? { key: F[k].join("."), d, m: A[k] + Math.min(.999, d / slot[k]) * len(F[k][0]) } : null;
};
const place = (a: ReturnType<typeof anchor>, p: Plan) => {
  if (!a) return 0;
  const k = p.find(Math.floor(a.m)), [l, i] = p.F[k];
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
  // where every card was: in the plan, or, if drawn, where it's drawn
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
      e < 1 ? (draw(y0 + (y1 - y0) * f, f, old), requestAnimationFrame(frame)) : done();
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
  tree.scrollLeft !== left && ((left = tree.scrollLeft), (sliding = true), (moving = 0), shut(true));
  moving || draw();
}, { signal });
plan = layout(L);
const show = () => {
  // (TREE is shown once tabs() shows its section)
  which === "TREE" || shut(true);
  if (which === "TREE" && tree.clientWidth > 0) {
    // as wide a column, as much text cut? (a phone's bar coming and
    // going changes the height only)
    if (cols[0].offsetWidth !== width) {
      width = cols[0].offsetWidth;
      shut(true);
      shown.forEach((s) => (s.fresh = !s.classList.contains("wait")));
    }
    started || ((started = true), (tree.scrollLeft = (L + 1) * step()));
    redo();
  }
};
addEventListener("resize", show, { signal });
// to column c: the ease under way done first, as it sets scrollTop; a
// click while sliding counts from where the slide goes
const slide = (c: number) => {
  goal = Math.max(0, Math.min(cols.length - 1, c));
  done();
  tree.scrollTo({ left: goal * step(), behavior: calm.matches ? "instant" : "smooth" });
};
// a mouse dragging the tree sideways moves it, as a finger does (its
// snap off meanwhile); let go, it slides to the nearest column. A drag
// up or down, or one from a card grown, selects text as before; a click
// ending a drag does nothing
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
  Math.abs(tree.scrollLeft - c * step()) < 1 ? (tree.classList.remove("drag"), pack()) : slide(c);
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
  s ? press(s) : (shut(), go(e.target as HTMLElement));
}, { signal });
tree.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if ((e.key === "Enter" || e.key === " ") && t.matches("h3, .s")) {
    e.preventDefault();
    t.matches("h3") ? go(t) : press(t as Card);
  }
}, { signal });
// a click elsewhere, or Escape, shuts the card grown
addEventListener("click", (e: MouseEvent) => tree.contains(e.target as Node) || shut(), { signal });
addEventListener("keydown", (e: KeyboardEvent) => e.key === "Escape" && big && (big.focus({ preventScroll: true }), shut()), { signal });
// VIEW, the first time it shows, at its top, as its cards are new
let viewed = false;
return {
  show: (w: Which) => {
    w === "VIEW" && !viewed && ((viewed = true), ($(".view").scrollTop = 0));
    which = w;
    show();
  },
  stop: () => ((moving = 0), clearTimeout(wait), ac.abort()),
};
}
