import { text_of } from "./Json.ts";

export type Timer = { id: string; text: string; at: string; cron: string | null; zone: string };

type Cron = { sets: Array<Set<number>>; day: boolean; week: boolean };

type Wall = { y: number; mo: number; d: number; h: number; mi: number; wd: number };

export const TIMERS = 50;
const TEXT   = 2000;

const LATE  = 60000;

const AHEAD = 8 * 366;

const MINUTE = 60000;

const GAP = 5;

const FIELDS: Array<[number, number, string[]]> = [
  [0, 59, []],
  [0, 23, []],
  [1, 31, []],
  [1, 12, ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]],
  [0, 7, ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]],
];

const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const CLOCKS = new Map<string, Intl.DateTimeFormat>();

function clock(zone: string): Intl.DateTimeFormat | null {
  const had = CLOCKS.get(zone);
  if (had !== undefined) {
    return had;
  }
  try {
    const fields = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" } as const;
    const made = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", ...fields });
    CLOCKS.set(zone, made);
    return made;
  } catch {
    return null;
  }
}

function zone_ok(zone: string): boolean {
  return zone !== "" && clock(zone) !== null;
}

function wall(ms: number, zone: string): Wall {
  const c = clock(zone);
  if (c === null) {
    throw new Error("no time zone " + zone);
  }
  const parts = Object.fromEntries(c.formatToParts(ms).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24, mi: Number(parts.minute), wd: DAYS[parts.weekday] };
}

function wall_key(w: Wall): number {
  return (((w.y * 100 + w.mo) * 100 + w.d) * 100 + w.h) * 100 + w.mi;
}

function wall_show(ms: number, zone: string): string {
  const w = wall(ms, zone);
  const two = (n: number) => String(n).padStart(2, "0");
  return w.y + "-" + two(w.mo) + "-" + two(w.d) + " " + two(w.h) + ":" + two(w.mi);
}

function wall_time(w: Omit<Wall, "wd">, zone: string): number | null {
  return wall_times(w, zone)[0] ?? null;
}

function wall_times(w: Omit<Wall, "wd">, zone: string): number[] {
  const want = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  const key = wall_key({ ...w, wd: 0 });
  const off = (ms: number) => {
    const at = wall(ms, zone);
    return Date.UTC(at.y, at.mo - 1, at.d, at.h, at.mi) - Math.floor(ms / MINUTE) * MINUTE;
  };
  const offs = new Set([-26, -14, 0, 14, 26].map((h) => off(want + h * 3600e3)));
  const times = [...offs].map((o) => want - o).filter((ms) => wall_key(wall(ms, zone)) === key);
  return [...new Set(times)].sort((a, b) => a - b);
}

function cron_read(expr: string): Cron | string {
  const fields = expr.trim().toLowerCase().split(/\s+/);
  if (fields.length !== 5) {
    return "A cron has five fields (minute hour day month weekday), not " + fields.length + ".";
  }
  const sets: Array<Set<number>> = [];
  for (const [k, field] of fields.entries()) {
    const set = field_read(field, FIELDS[k]);
    if (typeof set === "string") {
      return set;
    }
    sets.push(set);
  }
  if (sets[4].delete(7)) {
    sets[4].add(0);
  }
  return { sets, day: !fields[2].startsWith("*"), week: !fields[4].startsWith("*") };
}

function field_read(field: string, [lo, hi, names]: [number, number, string[]]): Set<number> | string {
  const set = new Set<number>();
  const num = (s: string) => (names.includes(s) ? names.indexOf(s) + lo : /^\d+$/.test(s) ? Number(s) : NaN);
  for (const item of field.split(",")) {
    const m = /^(\*|([a-z0-9]+)(?:-([a-z0-9]+))?)(?:\/(\d+))?$/.exec(item);
    const [a, b] = m === null ? [NaN, NaN] : m[1] === "*" ? [lo, hi] : [num(m[2]), m[3] === undefined ? (m[4] === undefined ? num(m[2]) : hi) : num(m[3])];
    const step = Number(m?.[4] ?? 1);
    if (!(a >= lo && b <= hi && a <= b && step >= 1)) {
      return "No cron field " + JSON.stringify(field) + ": its values go from " + lo + " to " + hi + ".";
    }
    for (let n = a; n <= b; n += step) {
      set.add(n);
    }
  }
  return set;
}

function cron_day(c: Cron, w: Wall): boolean {
  const [day, week] = [c.sets[2].has(w.d), c.sets[4].has(w.wd)];
  return c.sets[3].has(w.mo) && (c.day && c.week ? day || week : day && week);
}

function cron_next(c: Cron, zone: string, after: number): number | null {
  const w = wall(after, zone);
  const [hours, minutes] = [c.sets[1], c.sets[0]].map((set) => [...set].sort((a, b) => a - b));
  for (let k = 0; k <= AHEAD; k++) {
    const date = new Date(Date.UTC(w.y, w.mo - 1, w.d + k));
    const day = { y: date.getUTCFullYear(), mo: date.getUTCMonth() + 1, d: date.getUTCDate() };
    if (!cron_day(c, { ...day, h: 0, mi: 0, wd: date.getUTCDay() })) {
      continue;
    }
    for (const h of hours) {
      for (const mi of minutes) {
        const first = wall_times({ ...day, h, mi }, zone)[0];
        if (first !== undefined && first > after) {
          return first;
        }
      }
    }
  }
  return null;
}

function cron_gap(c: Cron): number {
  const times = [...c.sets[1]].flatMap((h) => [...c.sets[0]].map((mi) => h * 60 + mi)).sort((a, b) => a - b);
  const gaps = times.map((_, k) => (k === 0 ? times[times.length - 1] - 1440 : times[k - 1])).map((prev, k) => times[k] - prev);
  return Math.min(...gaps);
}

function at_read(text: string, zone: string): number | string {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?\s*(Z|[+-]\d\d:?\d\d)?$/i.exec(text.trim());
  const [y, mo, d, h, mi] = (m ?? []).slice(1, 6).map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (m === null || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d || h > 23 || mi > 59) {
    return "No time " + JSON.stringify(text) + ": give YYYY-MM-DD HH:MM.";
  }
  if (m[6] !== undefined) {
    return Date.parse(m.slice(1, 4).join("-") + "T" + m[4] + ":" + m[5] + ":00" + m[6].toUpperCase().replace(/^([+-]\d\d)(\d\d)$/, "$1:$2"));
  }
  const ms = wall_time({ y, mo, d, h, mi }, zone);
  return ms ?? text + " doesn't exist in " + zone + ": a daylight-saving change skips it.";
}

export function timer_new(args: { message?: unknown; at?: unknown; cron?: unknown; zone?: unknown }, now: number): Timer | string {
  const text = text_of(args.message).trim();
  const zone = text_of(args.zone);
  const [at, cron] = [args.at, args.cron].map((x) => (x === undefined || x === null || x === "" ? null : text_of(x)));
  if (text === "" || text.length > TEXT) {
    return "A schedule's message has 1 to " + TEXT + " characters.";
  }
  if (!zone_ok(zone)) {
    return "No time zone " + JSON.stringify(zone) + ": give an IANA name, such as Europe/Amsterdam or UTC.";
  }
  if ((at === null) === (cron === null)) {
    return "Give either at (once) or cron (again and again), not both or neither.";
  }
  const read = cron === null ? null : cron_read(cron);
  if (typeof read === "string") {
    return read;
  }
  if (read !== null && cron_gap(read) < GAP) {
    return "A cron's times must be at least " + GAP + " minutes apart (*/" + GAP + " is the most often).";
  }
  const ms = read !== null ? cron_next(read, zone, now) : at !== null ? at_read(at, zone) : null;
  if (typeof ms === "string") {
    return ms;
  }
  if (ms === null || Number.isNaN(ms)) {
    return "That cron never comes.";
  }
  if (ms <= now) {
    return wall_show(ms, zone) + " " + zone + " has passed; it is " + wall_show(now, zone) + " there now.";
  }
  const id = crypto.randomUUID().slice(0, 6);
  return { id, text, at: new Date(ms).toISOString(), cron: cron === null ? null : cron.trim(), zone };
}

export function timer_after(t: Timer, now: number): Timer | null {
  const read = t.cron === null ? null : cron_read(t.cron);
  const next = read === null || typeof read === "string" ? null : cron_next(read, t.zone, now);
  return next === null ? null : { ...t, at: new Date(next).toISOString() };
}

export function timer_say(t: Timer, now: number): string {
  const due = Date.parse(t.at);
  const late = now - due > LATE ? "\n\n(Due " + wall_show(due, t.zone) + " " + t.zone + "; it came late, at " + wall_show(now, t.zone) + ".)" : "";
  return "[Timer " + t.id + "]\n" + t.text + late;
}

export function timer_when(t: Timer): string {
  const next = wall_show(Date.parse(t.at), t.zone) + " " + t.zone;
  return t.cron === null ? "once, " + next : "cron " + t.cron + ", next " + next;
}

export function timer_line(t: Timer): string {
  return t.id + ": " + timer_when(t) + ": " + t.text.replace(/\s+/g, " ");
}
