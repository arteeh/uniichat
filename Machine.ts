import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Out } from "./Agent.ts";
import { CAP, clip, clip_end } from "./Clip.ts";
import { Mcp } from "./Mcp.ts";
import { FIT, HEAD, IMAGE, image_kind, PIXELS } from "./View.ts";

export type Job = { name: string; input: any; cwd: string };

export type Spec = { name: string; info: string; schema: object };

export type Skill = { name: string; description: string; dir: string };

type Op = { s: " " | "-" | "+"; x: string };

type Box = [number, number, number, number];

// on Windows, PowerShell (pwsh, else Windows PowerShell): its output in
// UTF-8, without progress bars, its stderr read with stdout (PowerShell's
// `2>&1` wraps a program's stderr lines as errors)
export const WIN = process.platform === "win32";
const SHELL = WIN ? Bun.which("pwsh") ?? "powershell.exe" : process.env.SHELL ?? "/bin/sh";
const PWSH  = "$ProgressPreference = 'SilentlyContinue'; $OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); ";

const RUN = crypto.randomUUID();
const UID = String(process.getuid?.() ?? "");
const PS  = process.platform === "darwin" ? ["ps", "-wwE", "-U", UID, "-o", "pid=,command="] : ["ps", "-wwe", "-u", UID, "-o", "pid=,args=", "e"];

const SHELLS = new Map<Bun.Subprocess, string>();

const GONE = 3000;

const CONTEXT = 3;

export const STR = { type: "string" };
export const INT = { type: "integer" };

const SHEET = 100;

const GAP = 4;

// the containers (ffprobe's names) a seek lands exactly in; in others
// (MPEG-TS...) it may land a keyframe late, so they decode from the start
const INDEXED = /\b(mov|mp4|matroska|webm|avi)\b/;

const SPARSE = 2;

// the packets read past a range's end: a frame shows after those decoded
// before it, at most this many later
const REORDER = 16;

const CELL = 16;

export const SCRATCH = (process.env.UNII_DIR ?? "~/.unii").replace(/[\\/]+$/, "") + "/scratch";

const TIMEOUT = [1, 3600];

const EDIT = { type: "object", properties: { path: STR, old: STR, new: STR, all: { type: "boolean" } }, required: ["path", "old", "new"] };

export const TOOLS: Spec[] = [
  spec("shell", "Run a command with the device's shell ($SHELL -c), stdout and stderr together, and return its output, then its exit code and time, as (exit 0 in 0.4 s); output past " + CAP + " characters keeps its head and tail. Each call is a new shell. The call waits until the command and everything holding its output end, or until timeout seconds pass: then it returns the output so far and the shell's pid, and leaves it running (a later call can end it; a stop kills it). Set timeout to how long the command should take, with room to spare. Start a background job (a server) detached, with its own output file, so the call needn't wait for its timeout. Background jobs live only while the device runs: stopping it kills every process the calls started.", { command: STR, timeout: { type: "integer", minimum: TIMEOUT[0], maximum: TIMEOUT[1], description: "Seconds to wait, " + TIMEOUT[0] + " to " + TIMEOUT[1] + ": then the call returns, leaving the command running." } }, ["command", "timeout"]),
  spec("read", "Read a text file. offset: the first line to show (from 1); limit: how many lines; at: the character of the first line to start from. It ends saying the lines shown, as [lines 4-7 of 15]; output past " + CAP + " characters comes in pages, saying where to go on. An image file (png, jpeg, gif, webp) comes as the picture, scaled to fit " + FIT + " px, or max_side px if given (a GIF shows its first frame; view_video plays it).", { path: STR, offset: INT, limit: INT, at: INT, max_side: INT }, ["path"]),
  spec("write", "Write a whole file, making its directories. Answers a unified diff of what changed (a new file: all its lines added).", { path: STR, content: STR }, ["path", "content"]),
  spec("view_video", "See part of a video (any file ffmpeg opens: mp4, mkv, webm, mov, avi, gif...) as ONE image: a grid of its frames, row by row, each stamped with its frame number (top) and time (bottom), fitting " + FIT + " px, or max_side px. It also answers a line on the whole video (duration, fps, frames, size). start and end: the range, ends included, in frames from 0 (or seconds, with unit \"second\"); by default the whole video. step: take every step-th frame; by default the one that gives at most 16. Each frame gets smaller as more share the sheet: past about 25 they get hard to read, and " + SHEET + " is the most. For a long stretch, raise step, narrow the range, or call again on the next range. Needs ffmpeg and ffprobe on the device.", { path: STR, start: { type: "number" }, end: { type: "number" }, unit: { type: "string", enum: ["frame", "second"] }, step: INT, max_side: INT }, ["path"]),
  spec("show", "Show the user files of this device in the chat: images (png, jpeg, gif, webp, svg), video (mp4, webm, mov) and audio (mp3, m4a, aac, ogg, opus, wav), and small HTML/CSS pages (html; no scripts: none run); any other file (a pdf, a zip) as a link to download. Each is copied to the chat's media store and shows under this call; the answer is a markdown line per file, ![name](/media/…) (another file's [name](/media/…)). Don't repeat it in your reply: put a line there only to place that file inside your text again.", { paths: { type: "array", items: STR, minItems: 1 } }, ["paths"]),
  spec("edit", "Replace text in files: the edits in order, each on its file as the edits before it left it. old must match exactly, whitespace included, and only once, unless all is true, which replaces every match. If any edit fails, no file is changed. Answers a unified diff of each file.", { edits: { type: "array", items: EDIT, minItems: 1 } }, ["edits"]),
];

export function spec(name: string, info: string, fields: object, need: string[]): Spec {
  const schema = { type: "object", properties: fields, required: need };
  return { name, info, schema };
}

export namespace Machine {

  export function agent_dir(agent: string): string {
    const root = SCRATCH.replace(/^~(?=[\\/]|$)/, os.homedir());
    return path.join(root, path.basename(agent));
  }

  export async function run(job: Job, signal: AbortSignal): Promise<Out> {
    const cwd = Machine.agent_dir(job.cwd);
    const input = job.input;
    const file = path.resolve(cwd, String(input.path));
    try {
      fs.mkdirSync(cwd, { recursive: true });
      switch (job.name) {
        case "shell": {
          const t = input.timeout;
          const secs = typeof t === "number" || (typeof t === "string" && t.trim() !== "") ? Number(t) : NaN;
          if (!(Number.isInteger(secs) && secs >= TIMEOUT[0] && secs <= TIMEOUT[1])) {
            return { text: "shell needs timeout: the seconds to wait for the command, a whole number from " + TIMEOUT[0] + " to " + TIMEOUT[1] + " (then the call returns, leaving it running). Nothing was run.", fail: true };
          }
          return await Machine.shell(cwd, String(input.command), secs * 1e3, signal);
        }
        case "read": {
          const kind = image_kind(Machine.head(file));
          const data = kind === null ? null : fs.readFileSync(file);
          const shown = data === null ? null : await Machine.image(data, kind!, Machine.side(input.max_side));
          if (shown !== null) {
            return shown;
          }
          if (data?.includes(0)) {
            return { text: "Not a readable " + kind + " (" + data.length + " bytes).", fail: true };
          }
          return Machine.read(file, Number(input.offset ?? 1), Number(input.limit ?? Infinity), Number(input.at ?? 0));
        }
        case "view_video": {
          return await Machine.video(file, input, signal);
        }
        case "write": {
          return Machine.write(file, String(input.path), String(input.content));
        }
        case "edit": {
          return Machine.edit(cwd, input.edits);
        }
        case "mcp": {
          return await Mcp.here(input, signal);
        }
        case "skills": {
          return { text: JSON.stringify(Machine.skills(os.homedir())), fail: false };
        }
        case "skill": {
          return Machine.skill(os.homedir(), String(input.name));
        }
        case "halt": {
          const left = await Machine.halt(String(input.agent));
          return { text: left === null ? "Its shells' trees killed; Windows can't find a process that left one." : left + " left", fail: (left ?? 0) > 0 };
        }
        default: {
          return { text: "No tool " + job.name + ".", fail: true };
        }
      }
    } catch (err: any) {
      return { text: String(err?.message ?? err), fail: true };
    }
  }

  export async function shell(cwd: string, command: string, ms: number, signal: AbortSignal): Promise<Out> {
    SHELLS.forEach((_, p) => Machine.group(p) || SHELLS.delete(p));
    const agent = path.basename(cwd);
    const start = performance.now();
    const argv = WIN ? [SHELL, "-NoProfile", "-NonInteractive", "-Command", PWSH + command] : [SHELL, "-c", "exec 2>&1\n" + command];
    const proc = Bun.spawn(argv, {
      cwd         : cwd,
      env         : { ...process.env, UNII_RUN: RUN, UNII_AGENT: agent },
      stdin       : "ignore",
      stdout      : "pipe",
      stderr      : WIN ? "pipe" : "ignore",
      detached    : !WIN,
      windowsHide : true,
    });
    const out = clip();
    SHELLS.set(proc, agent);
    const readers = [proc.stdout, ...(WIN ? [proc.stderr as typeof proc.stdout] : [])].map((s) => s.pipeThrough(new TextDecoderStream()).getReader());
    const kill = () => {
      if (!WIN || Machine.group(proc)) {
        Machine.kill(-proc.pid);
      }
      readers.forEach((r) => r.cancel().catch(() => {}));
    };
    signal.addEventListener("abort", kill, { once: true });
    let kept = true;
    const read = Promise.all(readers.map(async (reader) => {
      try {
        for (let got = await reader.read(); !got.done; got = await reader.read()) {
          if (kept) {
            out.add(got.value);
          }
        }
      } catch {}
    })).then(() => proc.exited);
    let timer: Timer | undefined;
    const late = new Promise<"late">((ok) => (timer = setTimeout(() => ok("late"), ms)));
    const ended = await Promise.race([read, late]);
    clearTimeout(timer);
    signal.removeEventListener("abort", kill);
    const secs = (performance.now() - start) / 1000;
    const text = (WIN ? out.text().replace(/\r\n/g, "\n") : out.text()).replace(/\n$/, "");
    if (ended === "late" && !signal.aborted) {
      kept = false;
      return { text: (text === "" ? "" : text + "\n") + "(still running after " + Math.round(secs) + " s, pid " + proc.pid + "; not killed)", fail: false };
    }
    const code = await proc.exited;
    const exit = signal.aborted ? "stopped" : proc.signalCode ? "killed by " + proc.signalCode : "exit " + code;
    return { text: (text === "" ? "" : text + "\n") + "(" + exit + " in " + secs.toFixed(1) + " s)", fail: exit !== "exit 0" };
  }

  export function group(proc: Bun.Subprocess): boolean {
    const ended = proc.exitCode !== null || proc.signalCode !== null;
    // Windows has no groups, and an ended shell's id may be reused
    return !ended || (!WIN && !Machine.alive(proc.pid) && Machine.alive(-proc.pid));
  }

  export function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      return err.code === "EPERM";
    }
  }

  export function kill(pid: number): void {
    try {
      if (WIN) {
        Bun.spawnSync(["taskkill", "/T", "/F", "/PID", String(Math.abs(pid))], { windowsHide: true });
      } else {
        process.kill(pid, "SIGKILL");
      }
    } catch {}
  }

  export function end(): void {
    Machine.sweep(null);
  }

  export async function halt(agent: string): Promise<number | null> {
    const until = Date.now() + GONE;
    let left = Machine.sweep(agent);
    while (left !== null && left > 0 && Date.now() < until) {
      await Bun.sleep(100);
      left = Machine.sweep(agent);
    }
    return left;
  }

  export function sweep(agent: string | null): number | null {
    for (const [proc, who] of SHELLS) {
      if ((agent === null || who === agent) && Machine.group(proc)) {
        Machine.kill(-proc.pid);
      }
    }
    if (WIN) {
      return null; // no ps: a process that left its shell's tree lives on
    }
    const marks = ["UNII_RUN=" + RUN, ...(agent === null ? [] : ["UNII_AGENT=" + agent])];
    const found = Bun.spawnSync(PS).stdout.toString().split("\n").map((line) => line.trim().split(/\s+/)).filter((words) => marks.every((m) => words.includes(m)));
    found.forEach((words) => Machine.kill(Number(words[0])));
    return found.length;
  }

  export function read(file: string, offset: number, limit: number, at: number): Out {
    const data = fs.readFileSync(file);
    if (data.includes(0)) {
      return { text: "A binary file of " + data.length + " bytes.", fail: true };
    }
    const lines = data.toString("utf8").replace(/\n$/, "").split("\n");
    const from  = Math.max(1, offset);
    const rows  = lines.slice(from - 1, from - 1 + limit);
    if (rows.length === 0) {
      return { text: "No lines from line " + from + ": the file has " + lines.length + ".", fail: true };
    }
    const text  = rows.join("\n");
    const end   = clip_end(text, at);
    const whole = end === text.length;
    const head  = text.slice(0, end).split("\n");
    const next  = from + head.length - 1;
    const col   = head[head.length - 1].length;
    const last  = whole ? from + rows.length - 1 : col === 0 ? next - 1 : next;
    const go    = whole ? "" : "; go on with offset " + next + (col === 0 ? "" : ", at " + col);
    const shown = "\n[lines " + from + "-" + last + " of " + lines.length + go + "]";
    return { text: text.slice(at, end).replace(/\n$/, "") + shown, fail: false };
  }

  export function head(file: string): Buffer {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(HEAD);
      return buf.subarray(0, fs.readSync(fd, buf, 0, HEAD, 0));
    } finally {
      fs.closeSync(fd);
    }
  }

  export function side(max: unknown): number {
    const n = Math.floor(Number(max));
    return n >= 1 && n < FIT ? n : FIT;
  }

  export async function image(data: Buffer, kind: string, side: number): Promise<Out | null> {
    const size = await new Bun.Image(data).metadata().catch(() => null);
    if (size === null) {
      return null;
    }
    const { width: w0, height: h0 } = size;
    if (w0 * h0 > PIXELS) {
      return { text: "An image of " + w0 + "x" + h0 + ": too many pixels to open.", fail: true };
    }
    const k = Math.min(1, side / Math.max(w0, h0));
    const kinds = kind === "image/jpeg" ? ["jpeg"] : ["png", "webp", "jpeg"];
    for (let [w, h] = [Math.max(1, Math.round(w0 * k)), Math.max(1, Math.round(h0 * k))]; ; [w, h] = [Math.max(1, Math.round(w * 0.75)), Math.max(1, Math.round(h * 0.75))]) {
      for (const as of kinds) {
        const fit = new Bun.Image(data).resize(w, h);
        const out = await (as === "png" ? fit.png() : as === "webp" ? fit.webp({ quality: 85 }) : fit.jpeg({ quality: 85 })).bytes().catch(() => null);
        if (out === null) {
          return null;
        }
        if (k === 1 && w === w0 && kind !== "image/gif" && data.length <= IMAGE) {
          return { text: "[image " + w0 + "x" + h0 + "]", fail: false, imgs: [{ type: kind, data: data.toString("base64") }] };
        }
        if (out.length <= IMAGE || w * h <= 64) {
          const how = w === w0 && h === h0 ? "" : ", scaled from " + w0 + "x" + h0;
          return { text: "[image " + w + "x" + h + how + "]", fail: false, imgs: [{ type: "image/" + as, data: Buffer.from(out).toString("base64") }] };
        }
      }
    }
  }

  export async function video(file: string, input: any, signal: AbortSignal): Promise<Out> {
    const [ffmpeg, ffprobe] = ["ffmpeg", "ffprobe"].map((bin) => Bun.which(bin, { PATH: process.env.PATH ?? "" }));
    if (ffmpeg === null || ffprobe === null) {
      return { text: "view_video needs ffmpeg and ffprobe, which aren't installed on this device. Install ffmpeg (e.g. apt install ffmpeg / brew install ffmpeg / winget install ffmpeg) and try again.", fail: true };
    }
    const shown = "stream=index,codec_name,width,height,sample_aspect_ratio,avg_frame_rate,r_frame_rate,nb_frames,duration:stream_side_data=rotation:format=duration,format_name,start_time";
    const probe = await Machine.exec([ffprobe, "-v", "error", "-select_streams", "V:0", "-show_entries", shown, "-of", "json", file], signal);
    if (probe.code !== 0) {
      return { text: "ffprobe: " + probe.err.trim(), fail: true };
    }
    const json   = JSON.parse(probe.out.toString());
    const stream = json.streams?.[0];
    if (!(stream?.width > 0 && stream.height > 0)) {
      return { text: "No video stream in " + input.path + ".", fail: true };
    }
    const sec    = input.unit === "second";
    const given  = (x: unknown) => x !== undefined && x !== null;
    const [s0, s1] = [given(input.start) ? Number(input.start) : 0, given(input.end) ? Number(input.end) : Infinity];
    const upto   = s1 === Infinity ? [] : ["-read_intervals", sec ? "%+" + (s1 + 1) : "%+#" + (Math.round(s1) + 1 + REORDER)];
    const packs  = await Machine.exec([ffprobe, "-v", "error", "-select_streams", String(stream.index), ...upto, "-show_entries", "packet=pts_time", "-of", "csv=p=0", file], signal);
    const lines  = packs.out.toString().split("\n").filter((l) => l.trim() !== "");
    const zero   = Number(json.format?.start_time) || 0;
    const read   = packs.code === 0 && lines.length > 0 && lines.every((l) => Number.isFinite(parseFloat(l)));
    const sorted = read ? lines.map((l) => parseFloat(l) - zero).sort((a, b) => a - b) : null;
    const whole  = upto.length === 0 || (sec ? sorted !== null && sorted[sorted.length - 1] < s1 + 0.5 : lines.length < Math.round(s1) + 1 + REORDER);
    const times  = sorted === null || whole ? sorted : sec ? sorted.filter((t) => t <= s1 + 0.5) : sorted.slice(0, sorted.length - REORDER);
    const fps    = Machine.rate(stream.avg_frame_rate) || Machine.rate(stream.r_frame_rate);
    const secs   = Number(stream.duration ?? json.format?.duration);
    const nb     = Number(stream.nb_frames) > 0 ? Number(stream.nb_frames) : times !== null && whole ? times.length : 0;
    const total  = nb > 0 ? nb + " frames (0-" + (nb - 1) + ")" : secs > 0 && fps > 0 ? "about " + Math.round(secs * fps) + " frames" : "frame count unknown";
    const turned = Math.abs(Number(stream.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation) || 0) % 180 === 90;
    const [sa, sb] = String(stream.sample_aspect_ratio ?? "").split(":").map(Number);
    const wide   = Number(stream.width) * (sa > 0 && sb > 0 ? sa / sb : 1);
    const [w0, h0] = turned ? [Number(stream.height), wide] : [wide, Number(stream.height)];
    const about  = input.path + ": " + (secs > 0 ? +secs.toFixed(3) + " s, " : "") + +fps.toFixed(3) + " fps, " + total + ", " + Math.round(w0) + "x" + Math.round(h0) + ", " + stream.codec_name;
    if (sec && times === null && !(fps > 0)) {
      return { text: about + "\nIts frame times are unknown: give start and end in frames.", fail: true };
    }
    const frame  = (t: number, last: boolean) => (!sec ? Math.round(t) : times === null ? Math.round(t * fps) : last ? times.filter((x) => x <= t + 1e-6).length - 1 : times.filter((x) => x < t - 1e-6).length);
    const start  = frame(s0, false);
    const most   = nb > 0 ? nb - 1 : times !== null ? times.length - 1 : Infinity;
    const end    = Math.min(given(input.end) ? frame(s1, true) : most === Infinity ? start + 15 * (Number(input.step) || 1) : most, most);
    const step   = given(input.step) ? Math.floor(Number(input.step)) : Math.max(1, Math.ceil((end - start + 1) / 16));
    const why    = !(s0 >= 0) ? "start must be 0 or more" : start > most ? "start is past the last frame" : !(end >= start) ? "end must not be before start" : !(step >= 1) ? "step must be 1 or more" : "";
    if (why !== "") {
      return { text: about + "\n" + why + ".", fail: true };
    }
    const count = Math.floor((end - start) / step) + 1;
    if (count > SHEET) {
      return { text: about + "\n" + count + " frames: at most " + SHEET + " fit one sheet. Raise step, narrow the range, or call again on consecutive ranges.", fail: true };
    }
    const side  = Machine.side(input.max_side);
    const fits  = (c: number) => Math.min((side - GAP * (c + 1)) / (c * w0), (side - GAP * (Math.ceil(count / c) + 1)) / (Math.ceil(count / c) * h0));
    let cols    = 1;
    for (let c = 2; c <= count; c++) {
      cols = fits(c) > fits(cols) ? c : cols;
    }
    const rows  = Math.ceil(count / cols);
    const k     = Math.min(1, fits(cols));
    const [w, h] = [2 * Math.floor((w0 * k) / 2), 2 * Math.floor((h0 * k) / 2)];
    if (Math.min(w, h) < CELL) {
      return { text: about + "\nmax_side " + side + " is too small for " + count + " frames (each under " + CELL + " px): raise max_side or take fewer frames.", fail: true };
    }
    const font  = Math.max(10, Math.round(Math.min(h / 10, w / 8)));
    const label = ":fontsize=" + font + ":fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=2:x=2";
    const seeks = times !== null && INDEXED.test(json.format?.format_name ?? "");
    const at    = (f: number) => (seeks && f > 0 ? (times![f - 1] + times![f]) / 2 : 0);
    const from  = (f: number) => (at(f) > 0 ? ["-ss", at(f).toFixed(6)] : []);
    const hms   = (t: number) => new Date(Math.max(0, t) * 1000).toISOString().slice(11, 23);
    const out   = ["-frames:v", "1", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "3", "pipe:1"];
    const fit   = "scale=" + w + ":" + h + ",setsar=1";
    const grid  = "tile=" + cols + "x" + rows + ":nb_frames=" + count + ":padding=" + GAP + ":margin=" + GAP + ":color=white";
    const takes = Array.from({ length: count }, (_, i) => start + i * step);
    const apart = seeks && count > 1 && (times![takes[count - 1]] - times![start]) / (count - 1) > SPARSE;
    const sheet = async (stamp: boolean) => {
      const marks = (n: string, t: string) => (stamp ? ",drawtext=text='" + n + "'" + label + ":y=2,drawtext=text='" + t + "'" + label + ":y=h-th-4" : "");
      if (apart) {
        const shots: Buffer[] = [];
        for (const f of takes) {
          const one = await Machine.exec([ffmpeg, "-v", "error", ...from(f), "-i", file, "-map", "0:" + stream.index, "-vf", fit + marks(String(f), hms(times![f]).replaceAll(":", "\\:")), ...out], signal);
          if (one.code !== 0 || one.out.length === 0) {
            return one;
          }
          shots.push(one.out);
        }
        return Machine.exec([ffmpeg, "-v", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-i", "pipe:0", "-vf", grid, ...out], signal, Buffer.concat(shots));
      }
      const first = seeks ? 0 : start;
      const which = "select='between(n," + first + "," + (end - start + first) + ")*not(mod(n-" + first + "," + step + "))',";
      const marked = marks("%{eif\\:n*" + step + "+" + start + "\\:d}", "%{pts\\:hms\\:" + at(start) + "}");
      return Machine.exec([ffmpeg, "-v", "error", ...from(start), "-i", file, "-map", "0:" + stream.index, "-vf", which + fit + marked + "," + grid, ...out], signal);
    };
    let made    = await sheet(true);
    let note    = "";
    if (made.code !== 0 && /drawtext|font/i.test(made.err)) {
      made = await sheet(false);
      note = "; this ffmpeg can't draw text, so they are unstamped: " + takes.map((f) => f + (times === null ? "" : " (" + hms(times[f]) + ")")).join(", ");
    }
    if (made.code !== 0 || made.out.length === 0) {
      return { text: about + "\nffmpeg: " + (made.err.trim() || "no frame in that range"), fail: true };
    }
    const range = "frames " + start + "-" + takes[count - 1] + (step > 1 ? " every " + step : "");
    const text  = about + "\nSheet: " + range + ", " + count + " frames in " + cols + "x" + rows + ", row by row" + note + ".";
    return { text, fail: false, imgs: [{ type: "image/jpeg", data: made.out.toString("base64") }] };
  }

  // a frame rate as ffprobe gives it ("30000/1001"); 0 if none
  export function rate(text: unknown): number {
    const [a, b = 1] = String(text).split("/").map(Number);
    return a > 0 && b > 0 ? a / b : 0;
  }

  export async function exec(argv: string[], signal: AbortSignal, stdin?: Buffer): Promise<{ out: Buffer; err: string; code: number }> {
    const proc = Bun.spawn(argv, { stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe", signal });
    const [out, err] = await Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text()]);
    return { out: Buffer.from(out), err, code: await proc.exited };
  }

  export function write(file: string, shown: string, content: string): Out {
    const was = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return { text: text_diff(shown, was, content), fail: false };
  }

  export function edit(cwd: string, edits: unknown): Out {
    const list  = Array.isArray(edits) ? edits : [];
    const files = new Map<string, { shown: string; was: string; text: string }>();
    for (const [k, e] of list.entries()) {
      const file  = path.resolve(cwd, String(e?.path));
      const known = files.get(file);
      const was   = known?.was ?? (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
      const text  = known?.text ?? was ?? "";
      const old   = String(e?.old ?? "");
      const count = old === "" ? 0 : text.split(old).length - 1;
      const why   = was === null ? "no such file" : count === 0 ? "old was not found" : count > 1 && e.all !== true ? "old matches " + count + " times; give more context, or all" : "";
      if (why !== "") {
        return { text: "Edit " + (k + 1) + " (" + e?.path + "): " + why + ". No file was changed.", fail: true };
      }
      files.set(file, { shown: known?.shown ?? String(e.path), was: was!, text: text.split(old).join(String(e.new)) });
    }
    if (files.size === 0) {
      return { text: "edits is empty: give a list of {path, old, new}.", fail: true };
    }
    for (const [file, f] of files) {
      fs.writeFileSync(file, f.text);
    }
    const diffs = [...files.values()].map((f) => text_diff(f.shown, f.was, f.text));
    return { text: diffs.join("\n"), fail: false };
  }

  export function skills(home: string): Skill[] {
    const found = new Map<string, Skill>();
    const root = home + "/.agents/skills";
    let names: string[] = [];
    try {
      names = fs.readdirSync(root).sort();
    } catch {}
    for (const name of names) {
      const file = path.join(root, name, "SKILL.md");
      let head: any = null;
      try {
        head = skill_head(file);
      } catch {}
      const ok = typeof head?.name === "string" && /^[a-z0-9-]{1,64}$/.test(head.name) && typeof head.description === "string" && head.description.trim() !== "";
      if (ok && !found.has(head.name)) {
        found.set(head.name, { name: head.name, description: head.description.trim().slice(0, 1024), dir: path.dirname(file) });
      }
    }
    return [...found.values()];
  }

  export function skill(home: string, name: string): Out {
    const skill = Machine.skills(home).find((s) => s.name === name);
    if (skill === undefined) {
      return { text: "No skill " + name + " here.", fail: true };
    }
    const text = fs.readFileSync(skill.dir + "/SKILL.md", "utf8");
    return { text: "Skill " + name + ", in " + skill.dir + " (its other files are there):\n\n" + text, fail: false };
  }

  export function nap(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((ok) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        ok();
      };
      const timer = setTimeout(done, signal.aborted ? 0 : ms);
      signal.addEventListener("abort", done, { once: true });
    });
  }

}

// a SKILL.md's YAML frontmatter, from its first 64 KB; a regular file only,
// so a FIFO or device can't hang the device
function skill_head(file: string): any {
  if (!fs.statSync(file).isFile()) {
    return null;
  }
  const buf = Buffer.alloc(65536);
  const fd = fs.openSync(file, "r");
  const size = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const text = buf.toString("utf8", 0, size).replace(/^\uFEFF/, "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?(\n|$)/);
  return m === null ? null : Bun.YAML.parse(m[1]);
}

function text_diff(file: string, was: string, now: string): string {
  const [a, b] = [text_lines(was), text_lines(now)];
  const ops = lines_diff(a, b);
  const at  : [number, number][] = [];
  let [i, j] = [0, 0];
  for (const op of ops) {
    at.push([i, j]);
    i += op.s === "+" ? 0 : 1;
    j += op.s === "-" ? 0 : 1;
  }
  const keys  = ops.flatMap((op, k) => (op.s === " " ? [] : [k]));
  const hunks : [number, number][] = [];
  for (const k of keys) {
    const top = hunks[hunks.length - 1];
    if (top !== undefined && k - top[1] <= 2 * CONTEXT) {
      top[1] = k + 1;
    } else {
      hunks.push([k, k + 1]);
    }
  }
  if (hunks.length === 0) {
    return file + " is unchanged.";
  }
  const out = clip();
  out.add("--- " + file + "\n+++ " + file);
  for (const [lo, hi] of hunks) {
    const a    = Math.max(0, lo - CONTEXT);
    const b    = Math.min(ops.length, hi + CONTEXT);
    const run  = ops.slice(a, b);
    const olds = run.filter((op) => op.s !== "+").length;
    const news = run.filter((op) => op.s !== "-").length;
    const head = "@@ -" + (at[a][0] + (olds === 0 ? 0 : 1)) + "," + olds + " +" + (at[a][1] + (news === 0 ? 0 : 1)) + "," + news + " @@";
    out.add("\n" + head + run.map((op) => "\n" + op.s + op.x.replace(/\n$/, "")).join(""));
  }
  return out.text();
}

function lines_diff(a: string[], b: string[]): Op[] {
  const [in_a, in_b] = [new Set(a), new Set(b)];
  const ia    = a.flatMap((x, i) => (in_b.has(x) ? [i] : []));
  const ib    = b.flatMap((x, j) => (in_a.has(x) ? [j] : []));
  const pairs = lines_match(ia.map((i) => a[i]), ib.map((j) => b[j]), [0, ia.length, 0, ib.length], []);
  const ops   : Op[] = [];
  let [i, j] = [0, 0];
  for (const [p, q] of pairs) {
    ops_push(ops, "-", a, i, ia[p]);
    ops_push(ops, "+", b, j, ib[q]);
    ops.push({ s: " ", x: a[ia[p]] });
    [i, j] = [ia[p] + 1, ib[q] + 1];
  }
  ops_push(ops, "-", a, i, a.length);
  return ops_push(ops, "+", b, j, b.length);
}

function ops_push(ops: Op[], s: Op["s"], xs: string[], i: number, j: number): Op[] {
  for (let k = i; k < j; k++) {
    ops.push({ s, x: xs[k] });
  }
  return ops;
}

function lines_match(a: string[], b: string[], box: Box, pairs: [number, number][]): [number, number][] {
  let [a0, a1, b0, b1] = box;
  let tail = 0;
  for (; a0 < a1 && b0 < b1 && a[a0] === b[b0]; a0++, b0++) {
    pairs.push([a0, b0]);
  }
  for (; a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]; a1--, b1--) {
    tail++;
  }
  if (a0 < a1 && b0 < b1) {
    const [x, u, y, v] = box_snake(a, b, [a0, a1, b0, b1]);
    lines_match(a, b, [a0, x, b0, y], pairs);
    for (let k = 0; k < u - x; k++) {
      pairs.push([x + k, y + k]);
    }
    lines_match(a, b, [u, a1, v, b1], pairs);
  }
  for (let k = 0; k < tail; k++) {
    pairs.push([a1 + k, b1 + k]);
  }
  return pairs;
}

function text_lines(text: string): string[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return lines.map((l) => (l.endsWith("\n") ? l : l + "\n\\ No newline at end of file"));
}

function box_snake(a: string[], b: string[], [a0, a1, b0, b1]: Box): Box {
  const [n, m] = [a1 - a0, b1 - b0];
  const delta = n - m;
  const off   = n + m + 1;
  const vf    = new Int32Array(2 * off + 1);
  const vb    = new Int32Array(2 * off + 1);
  for (let d = 0; ; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && vf[off + k - 1] < vf[off + k + 1]) ? vf[off + k + 1] : vf[off + k - 1] + 1;
      const x0 = x;
      while (x < n && x - k < m && a[a0 + x] === b[b0 + x - k]) {
        x++;
      }
      vf[off + k] = x;
      const c = delta - k;
      if (delta % 2 !== 0 && Math.abs(c) < d && x + vb[off + c] >= n) {
        return [a0 + x0, a0 + x, b0 + x0 - k, b0 + x - k];
      }
    }
    for (let c = -d; c <= d; c += 2) {
      let x = c === -d || (c !== d && vb[off + c - 1] < vb[off + c + 1]) ? vb[off + c + 1] : vb[off + c - 1] + 1;
      const x0 = x;
      while (x < n && x - c < m && a[a1 - 1 - x] === b[b1 - 1 - x + c]) {
        x++;
      }
      vb[off + c] = x;
      const k = delta - c;
      if (delta % 2 === 0 && Math.abs(k) <= d && x + vf[off + k] >= n) {
        return [a1 - x, a1 - x0, b1 - x + c, b1 - x0 + c];
      }
    }
  }
}
