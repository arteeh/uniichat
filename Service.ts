// Service
// =======
// `unii serve -d [port]`, `unii device -d [url]`: the part as a user
// service of the OS, which starts it at login and again if it crashes:
// a systemd user unit (Linux), a Scheduled Task at logon, as the user,
// no admin (Windows), a LaunchAgent (macOS), each named unii-<part>. Run
// again, the OS's service manager restarts it (so it works from a shell
// of the very unii it restarts); `stop` stops and removes it; `logs`
// shows its output: the journal on Linux, else LOGS/<part>.log, which
// the service writes, capped (`supervise`). Each holds MARK: one by its
// name without it is someone else's, never changed. The installers
// (install.sh, install.ps1, not in the repo) find the ones made here by
// the same names and MARK, and restart them on the new unii.
// -d returns once the part is up (`ready`: a device linked to its
// server, a server listening), or says it isn't after UP; -d and `stop`
// time each step in the part's log on Windows and macOS (the file `logs`
// shows: `clock`), so a slow machine shows where the time went.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Types
// =====

export type Part = "serve" | "device";

// Constants
// =========

const WIN  = process.platform === "win32";
const MAC  = process.platform === "darwin";
const HOME = os.homedir();

// what marks a service as unii's (the installers look for it too)
export const MARK = "unii-made";

const DATA  = (process.env.UNII_DIR ?? "~/.unii").replace(/^~(?=[\\/]|$)/, HOME);
const LOGS  = DATA + "/logs";
const UNITS = (process.env.XDG_CONFIG_HOME || HOME + "/.config") + "/systemd/user";
const PLIST = HOME + "/Library/LaunchAgents";

// a log file's most bytes: past it, it becomes <part>.log.1 (the one
// before that dropped) and starts anew; a line's most characters (past
// them, cut)
const CAP   = 2 ** 20;
const LINE  = 16384;

// what `logs` shows before it follows
const LINES = 200;

// on Windows the service restarts itself, a minute apart, 3 times at
// most in a row (a run of RAN resets the count); launchd and systemd
// restart theirs
const RESTARTS = WIN ? 3 : 0;
const AFTER    = 60000;
const RAN      = 600000;

// how long `stop` gives a service asked to quit (Windows: watch) before
// it ends it
const BYE      = 5000;

// how long -d waits for the part to be up (ready)
const UP       = 20000;

// the part this process runs as its service's (served), which tells -d
// it is up (ready)
let SERVED: Part | null = null;

// the dirs the service sees as the shell that ran -d did, resolved: on
// Linux and macOS in its environment, with PATH (their service managers
// give a bare one); on Windows, whose task has no environment of the
// shell's, as --env=<name>=<dir> arguments (Cli.ts sets them)
export const DIRS = ["UNII_DIR", "XDG_CONFIG_HOME"];

const ABOUT: Record<Part, string> = { serve: "UniiChat server (unii serve)", device: "UniiChat device (unii device)" };

// Service
// =======

export function name(part: Part): string {
  return "unii-" + part;
}

// this unii, as a command: its executable (from source: bun and Cli.ts)
export function command(): string[] {
  const bun = /^bun(\.exe)?$/i.test(path.basename(process.execPath));
  return bun ? [process.execPath, path.resolve(process.argv[1])] : [process.execPath];
}

// -d: the service made (or made again) and (re)started by the OS, its
// status told
export async function start(part: Part, args: string[]): Promise<void> {
  const dirs = Object.fromEntries(DIRS.flatMap((k) => (process.env[k] ? [[k, path.resolve(k === "UNII_DIR" ? DATA : process.env[k]!)]] : [])));
  if (part === "device") {
    alone();
  }
  if (WIN) {
    return win_start(part, [...Object.entries(dirs).map(([k, v]) => "--env=" + k + "=" + v), ...args]);
  }
  const env = { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), ...dirs };
  return MAC ? mac_start(part, args, env) : linux_start(part, args, env);
}

// `stop`: the service stopped and removed
export async function stop(part: Part): Promise<void> {
  if (WIN) {
    return win_stop(part);
  }
  return MAC ? mac_stop(part) : linux_stop(part);
}

// `logs [-f]`: its output, the last LINES lines, then followed
export async function logs(part: Part, follow: boolean): Promise<void> {
  if (WIN || MAC) {
    return file_logs(part, follow);
  }
  const cmd = ["journalctl", "--user", "-u", name(part) + ".service", "-n", String(LINES), "--no-pager", ...(follow ? ["-f"] : [])];
  if (Bun.which("journalctl") === null) {
    fail("journalctl isn't here: unii " + part + " -d runs it under systemd, whose journal holds its output.");
  }
  process.exitCode = await Bun.spawn(cmd, { stdio: ["inherit", "inherit", "inherit"] }).exited;
}

// where the service unii made runs now; null: it doesn't
export function running(part: Part): string | null {
  if (WIN || MAC) {
    return ours(part, pids(part).slice(0, 1)).length > 0 ? (WIN ? "the Scheduled Task " : "the LaunchAgent ") + name(part) : null;
  }
  const file = unit(part);
  if (!read(file)?.includes(MARK) || Bun.which("systemctl") === null) {
    return null;
  }
  const state = run(["systemctl", "--user", "is-active", name(part)]).out;
  return ["active", "activating", "reloading"].includes(state) ? "the systemd user service " + name(part) : null;
}

// this process runs `part` as its service's (UNII_SERVICE: Cli.ts)
export function served(part: Part): void {
  SERVED = part;
}

// the part is up (a device linked to its server, a server listening):
// run as its service's, it says so in LOGS/<part>.up (its pid, the
// time), which -d waits for (up), once (an old one linking again as a
// new one starts never reads as the new one up)
export function ready(part: Part): void {
  if (SERVED !== part) {
    return;
  }
  SERVED = null;
  try {
    fs.mkdirSync(LOGS, { recursive: true, mode: 0o700 });
    fs.writeFileSync(LOGS + "/" + part + ".up", process.pid + " " + Date.now() + "\n");
  } catch {}
}

// plain `unii serve` / `unii device`: in the foreground, said so; if
// the background one runs, that's said and nothing more runs
export function foreground(part: Part): void {
  const where = running(part);
  if (where !== null) {
    console.error("unii " + part + " already runs in the background (" + where + "): `unii " + part + " logs -f` follows it, `unii " + part + " stop` stops it.");
    process.exit(1);
  }
  console.log("Running in the foreground. `unii " + part + " -d` runs it as a background service.");
}

// a service's own unii (Windows: under `supervise`), which ends once
// its supervisor does (Windows ends a task's process alone, not those
// it started). Its `part` ends then as a signal ends it: its handlers
// run (a device says goodbye: Device.ts), else it exits; on Windows it
// also ends so as `stop` asks it to (Windows sends no signal: a file,
// <part>.stop, naming its supervisor, read every 500 ms). A supervisor
// (`me`: its own pid, `parent` its conhost) exits as its conhost ends or
// the file names it, its part then ending as it sees it gone
export function watch(parent: number, part?: Part, me = parent): void {
  const stop = part === undefined || !WIN ? null : LOGS + "/" + part + ".stop";
  let quit = false;
  setInterval(() => {
    if (quit || (alive(parent) && (stop === null || read(stop)?.trim() !== String(me)))) {
      return;
    }
    quit = true;
    if (part === undefined || me !== parent || process.listenerCount("SIGTERM") === 0) {
      process.exit(0);
    }
    process.emit("SIGTERM");
  }, stop === null ? 2000 : 500).unref();
}

// Linux
// -----

function unit(part: Part): string {
  return UNITS + "/" + name(part) + ".service";
}

async function linux_start(part: Part, args: string[], env: Record<string, string>): Promise<void> {
  const n = name(part);
  linux_check(part);
  const was = read(LOGS + "/" + part + ".up");
  // systemd's quoting: a value in "", \ and " escaped, a line break as
  // \n, % doubled (and in a command $ too)
  const q = (s: string) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/%/g, "%%") + '"';
  const text = [
    "# " + MARK + ": `unii " + part + " -d` wrote this unit, and writes it again; `unii " + part + " stop` removes it.",
    "[Unit]",
    "Description=" + ABOUT[part],
    "StartLimitIntervalSec=300",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "ExecStart=" + [...command(), part, ...args].map((a) => q(a).replace(/\$/g, "$$$$")).join(" "),
    ...Object.entries({ ...env, UNII_SERVICE: part }).map(([k, v]) => "Environment=" + q(k + "=" + v)),
    "Restart=on-failure",
    "RestartSec=10",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
  fs.mkdirSync(UNITS, { recursive: true });
  fs.writeFileSync(unit(part), text);
  systemctl("daemon-reload");
  systemctl("enable", "--quiet", n);
  // a restart asked for, never refused for the crash restarts' limit
  run(["systemctl", "--user", "reset-failed", n]);
  systemctl("restart", "--no-block", n);
  const state = () => run(["systemctl", "--user", "is-active", n]).out;
  say(part, await up(part, was, () => state() === "failed", () => state() === "active"), "the systemd user service " + n + ", started at login");
  const user = os.userInfo().username;
  if (Bun.which("loginctl") !== null && run(["loginctl", "show-user", user, "--property=Linger", "--value"]).out === "no") {
    console.log("Lingering is off, so it runs only while you're logged in: `loginctl enable-linger` starts it at boot and keeps it up after you log out.");
  }
}

async function linux_stop(part: Part): Promise<void> {
  const n = name(part);
  linux_check(part);
  if (!fs.existsSync(unit(part))) {
    console.log("unii " + part + " isn't set up as a background service here: nothing to stop.");
    return;
  }
  // its files first: run from the service's own shell, the stop ends this
  systemctl("disable", "--quiet", n);
  fs.rmSync(unit(part));
  systemctl("daemon-reload");
  systemctl("stop", n);
  console.log("unii " + part + " stopped: its background service " + n + " is removed.");
}

// systemd's user manager up, and no unit by the service's name but
// unii's: else why not, and nothing changes
function linux_check(part: Part): void {
  const n = name(part);
  if (Bun.which("systemctl") === null || run(["systemctl", "--user", "show", "--property=Version", "--value"]).code !== 0) {
    fail("unii " + part + " -d runs it under systemd's user manager (systemctl --user), which isn't reachable here. Run `unii " + part + "` in the foreground, or under a service manager of your own.");
  }
  const file = unit(part);
  const mine = read(file);
  const from = run(["systemctl", "--user", "show", "--property=FragmentPath", "--value", n + ".service"]).out;
  const theirs = mine !== null && !mine.includes(MARK) ? file : from !== "" && !same(from, file) ? from : null;
  if (theirs !== null) {
    fail(n + " isn't unii's: " + theirs + " is a unit unii didn't make, so unii leaves it as it is. To use unii " + part + " -d, remove it (systemctl --user disable --now " + n + ", then the file); or keep using it.");
  }
}

function systemctl(...args: string[]): void {
  const out = run(["systemctl", "--user", ...args]);
  if (out.code !== 0) {
    fail("systemctl --user " + args.join(" ") + " failed: " + (out.err || "exit " + out.code));
  }
}

// macOS
// -----

function plist(part: Part): string {
  return PLIST + "/" + name(part) + ".plist";
}

async function mac_start(part: Part, args: string[], env: Record<string, string>): Promise<void> {
  const n = name(part);
  const job = "gui/" + process.getuid!() + "/" + n;
  const file = plist(part);
  const was = read(file);
  const loaded = run(["launchctl", "print", job]).code === 0;
  if ((was !== null && !was.includes(MARK)) || (was === null && loaded)) {
    fail(n + " isn't unii's: " + (was === null ? "a launchd job by that name" : file) + " isn't one unii made, so unii leaves it as it is. To use unii " + part + " -d, remove it (launchctl bootout " + job + ", then its plist); or keep using it.");
  }
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const strings = (list: string[]) => list.map((a) => "<string>" + x(a) + "</string>").join("");
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${MARK}: \`unii ${part} -d\` wrote this, and writes it again; \`unii ${part} stop\` removes it. -->
<plist version="1.0">
<dict>
  <key>Label</key><string>${n}</string>
  <key>ProgramArguments</key><array>${strings([...command(), part, "--service", ...args])}</array>
  <key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => "<key>" + x(k) + "</key><string>" + x(v) + "</string>").join("")}</dict>
  <key>WorkingDirectory</key><string>${x(HOME)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
`;
  const step = clock(part, "-d");
  fs.mkdirSync(PLIST, { recursive: true });
  fs.writeFileSync(file, text);
  const pid = read(LOGS + "/" + part + ".pid");
  const ready = read(LOGS + "/" + part + ".up");
  step("LaunchAgent written");
  run(["launchctl", "enable", job]);
  if (loaded && was === text) {
    run(["launchctl", "kickstart", "-k", job]);
  } else {
    // as a session of its own: run from the service's own shell, the
    // bootout ends this
    const again = (loaded ? "launchctl bootout '" + job + "' 2>/dev/null; " : "") + "launchctl bootstrap gui/" + process.getuid!() + " '" + file.replace(/'/g, "'\\''") + "'";
    await Bun.spawn(["/bin/sh", "-c", again], { detached: true, stdio: ["ignore", "inherit", "inherit"] }).exited;
  }
  step("LaunchAgent started");
  const now = await up(part, ready, () => supervised(part, pid) === false, () => supervised(part, pid) === true);
  step(now === "up" ? "up" : "not up");
  say(part, now, "the LaunchAgent " + n + ", started at login");
}

async function mac_stop(part: Part): Promise<void> {
  const n = name(part);
  const file = plist(part);
  const was = read(file);
  if (was === null) {
    console.log("unii " + part + " isn't set up as a background service here: nothing to stop.");
    return;
  }
  if (!was.includes(MARK)) {
    fail(n + " isn't unii's: " + file + " isn't one unii made, so unii leaves it as it is.");
  }
  const step = clock(part, "stop");
  fs.rmSync(file);
  fs.rmSync(LOGS + "/" + part + ".up", { force: true });
  run(["launchctl", "bootout", "gui/" + process.getuid!() + "/" + n]);
  step("LaunchAgent removed");
  console.log("unii " + part + " stopped: its background service " + n + " is removed.");
}

// Windows
// -------
// The task runs conhost --headless (no window) on `unii <part> --service`
// (supervise), at the user's logon, as the user (InteractiveToken,
// LeastPrivilege: no admin, no UAC prompt); a run asked for while one
// runs stops it first (MultipleInstancesPolicy StopExisting), so Task
// Scheduler does a restart. It is made and read by schtasks.exe from
// its XML (TASK): the ScheduledTasks cmdlets take PowerShell and their
// module ~0.7 s to load, schtasks a few ms

async function win_start(part: Part, args: string[]): Promise<void> {
  const n = name(part);
  const step = clock(part, "-d");
  const pid = read(LOGS + "/" + part + ".pid");
  const was = read(LOGS + "/" + part + ".up");
  const had = win_task(n);
  step("task looked up");
  if (had !== null && !had.includes(MARK)) {
    fail(n + " isn't unii's: that Scheduled Task isn't one unii made, so unii leaves it as it is. To use unii " + part + " -d, remove it (schtasks /delete /tn " + n + "); or keep using it.");
  }
  const line = ["--headless", ...command(), part, "--service", ...args].map(winq).join(" ");
  const about = MARK + ": `unii " + part + " -d` made this task, and makes it again; `unii " + part + " stop` removes it.";
  const file = path.join(os.tmpdir(), n + "-" + process.pid + ".xml");
  // UTF-16, as schtasks reads a task's XML
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(TASK(about, user(), line, HOME), "utf16le")]));
  try {
    schtasks("/create", "/tn", "\\" + n, "/xml", file, "/f");
  } finally {
    fs.rmSync(file, { force: true });
  }
  step("task registered");
  schtasks("/run", "/tn", "\\" + n);
  step("task started");
  const now = await up(part, was, () => supervised(part, pid) === false, () => supervised(part, pid) === true);
  step(now === "up" ? "up" : "not up");
  say(part, now, "the Scheduled Task " + n + ", started at logon");
}

async function win_stop(part: Part): Promise<void> {
  const n = name(part);
  const step = clock(part, "stop");
  // what the task ran, and what that started (Windows ends only the
  // task's own process), if still unii; its file gone first, and the
  // task removed before its unii is asked to quit: run from the
  // service's own shell (a device's job), the quit ends this. With none
  // of its unii known (no pid file, or a pid not unii's now) while the
  // task runs, the task is stopped, as the last resort: its supervisor
  // ends as its task does, and its part as that one does (watch), a
  // device saying goodbye still
  const all = pids(part);
  const mine = ours(part, all);
  step("processes looked up");
  const had = win_task(n);
  step("task looked up");
  if (had === null) {
    console.log("unii " + part + " isn't set up as a background service here: nothing to stop.");
    return;
  }
  if (!had.includes(MARK)) {
    fail(n + " isn't unii's: that Scheduled Task isn't one unii made, so unii leaves it as it is.");
  }
  fs.rmSync(LOGS + "/" + part + ".pid", { force: true });
  fs.rmSync(LOGS + "/" + part + ".up", { force: true });
  if (mine.length === 0 && /"Running"/.test(run(["schtasks", "/query", "/tn", "\\" + n, "/fo", "csv", "/nh"]).out)) {
    run(["schtasks", "/end", "/tn", "\\" + n]);
    step("task ended");
  }
  schtasks("/delete", "/tn", "\\" + n, "/f");
  step("task removed");
  await win_quit(part, all[0], mine);
  step("its unii ended");
  console.log("unii " + part + " stopped: its background service " + n + " is removed.");
}

// a task's XML: the task -d makes (the cmdlets' defaults for the rest)
function TASK(about: string, who: string, line: string, dir: string): string {
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>${x(about)}</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${x(who)}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${x(who)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>StopExisting</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>${RESTARTS}</Count></RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>conhost.exe</Command><Arguments>${x(line)}</Arguments><WorkingDirectory>${x(dir)}</WorkingDirectory></Exec></Actions>
</Task>
`;
}

// the user, as a task names it (DOMAIN\user)
function user(): string {
  const name = process.env.USERNAME ?? os.userInfo().username;
  return process.env.USERDOMAIN ? process.env.USERDOMAIN + "\\" + name : name;
}

// a task's XML, as schtasks shows it; null: no task of that name
function win_task(n: string): string | null {
  const out = run(["schtasks", "/query", "/tn", "\\" + n, "/xml"]);
  return out.code === 0 ? out.out : null;
}

function schtasks(...args: string[]): void {
  const out = run(["schtasks", ...args]);
  if (out.code !== 0) {
    fail("schtasks " + args[0] + " failed: " + (out.err || out.out || "exit " + out.code));
  }
}

// a service's supervisor and part (`mine`) asked to quit by the file
// its part watches (watch), naming the supervisor; given BYE, so a
// device says goodbye (QUIT) and the server lets it go at once; then, as
// a last resort, ended
async function win_quit(part: Part, supervisor: number | undefined, mine: number[]): Promise<void> {
  const stop = LOGS + "/" + part + ".stop";
  if (supervisor !== undefined && mine.length > 0) {
    fs.writeFileSync(stop, String(supervisor));
    for (const until = Date.now() + BYE; mine.some(alive) && Date.now() < until; ) {
      await Bun.sleep(100);
    }
  }
  for (const pid of mine.filter(alive)) {
    run(["taskkill", "/T", "/F", "/PID", String(pid)]);
  }
  fs.rmSync(stop, { force: true });
}

// Windows and macOS: the service's supervisor
// -------------------------------------------
// `unii <part> --service [arg]`, as the task or LaunchAgent runs it: it
// runs `unii <part> [arg]` (UNII_SERVICE set: no foreground note), its
// output to LOGS/<part>.log, each line timed, capped (CAP). Its pid and
// the part's are in LOGS/<part>.pid; those left by a supervisor before it
// (a restart: Windows ended that one's conhost alone) end before its part
// starts, so the new part finds its port free: if still unii's (`ours`; a
// file left by a crash or a sign-out may name pids reused since). On
// Windows they are asked to quit at once (win_quit: a device says
// goodbye), ended after BYE; elsewhere waited for, then ended. On Windows a
// part that failed starts again (RESTARTS). Stopped (a signal), it ends
// with 0, so launchd leaves it stopped.

export async function supervise(part: Part, args: string[]): Promise<never> {
  if (WIN) {
    // the task's conhost, which Windows ends alone
    watch(process.ppid, part, process.pid);
  }
  fs.mkdirSync(LOGS, { recursive: true, mode: 0o700 });
  fs.rmSync(LOGS + "/" + part + ".stop", { force: true });
  const file = LOGS + "/" + part + ".pid";
  const before = pids(part);
  const old = ours(part, before.filter((pid) => pid !== process.pid));
  if (WIN) {
    await win_quit(part, before[0], old);
  }
  for (const pid of WIN ? [] : old) {
    for (let k = 0; k < 40 && alive(pid); k++) {
      await Bun.sleep(250);
    }
    try {
      process.kill(pid);
    } catch {}
  }
  const log = logger(LOGS + "/" + part + ".log");
  let child: ReturnType<typeof Bun.spawn> | null = null;
  let stopping = false;
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(sig, () => {
      stopping = true;
      child?.kill();
    });
  }
  let [tries, code] = [0, 0];
  while (true) {
    const began = Date.now();
    const env = { ...process.env, UNII_SERVICE: part, UNII_SUPERVISOR: String(process.pid) };
    child = Bun.spawn([...command(), part, ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
    fs.writeFileSync(file, process.pid + " " + child.pid + "\n");
    await Promise.all([lines(child.stdout as ReadableStream<Uint8Array>, log), lines(child.stderr as ReadableStream<Uint8Array>, log), child.exited]);
    code = child.exitCode ?? 1;
    log("unii " + part + " ended (exit " + code + ")");
    tries = Date.now() - began > RAN ? 1 : tries + 1;
    if (code === 0 || stopping || tries > RESTARTS) {
      break;
    }
    log("starting it again in a minute (" + tries + " of " + RESTARTS + ")");
    await Bun.sleep(AFTER);
  }
  fs.rmSync(file, { force: true });
  process.exit(stopping ? 0 : code);
}

// a log's writer: each line timed; past CAP the file goes to .1
function logger(file: string): (text: string) => void {
  let size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  return (text) => {
    const stamp = new Date().toISOString() + " ";
    const cut = (line: string) => (line.length > LINE ? line.slice(0, LINE) + " [cut: " + (line.length - LINE) + " more characters]" : line);
    const out = text.split("\n").map((line) => stamp + cut(line) + "\n").join("");
    if (size > 0 && size + Buffer.byteLength(out) > CAP) {
      try {
        fs.renameSync(file, file + ".1");
      } catch {
        fs.writeFileSync(file, "");
      }
      size = 0;
    }
    fs.appendFileSync(file, out);
    size += Buffer.byteLength(out);
  };
}

// a stream's lines, each to `put` as it ends (one past LINE as it gets
// there: never held whole)
async function lines(stream: ReadableStream<Uint8Array>, put: (line: string) => void): Promise<void> {
  const dec = new TextDecoder();
  let rest = "";
  const reader = stream.getReader();
  for (let got = await reader.read(); !got.done; got = await reader.read()) {
    const all = (rest + dec.decode(got.value, { stream: true })).split(/\r?\n/);
    rest = all.pop()!;
    all.forEach(put);
    if (rest.length > LINE) {
      put(rest);
      rest = "";
    }
  }
  if (rest !== "") {
    put(rest);
  }
}

async function file_logs(part: Part, follow: boolean): Promise<void> {
  const file = LOGS + "/" + part + ".log";
  if (!fs.existsSync(file)) {
    fail("no log at " + file + " yet: it's written by unii " + part + " -d's background service.");
  }
  let at = fs.statSync(file).size;
  const text = fs.readFileSync(file, "utf8");
  process.stdout.write(text.split("\n").slice(-LINES - 1).join("\n"));
  while (follow) {
    await Bun.sleep(500);
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    // a new file: it was capped (.1)
    at = size < at ? 0 : at;
    if (size > at) {
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(size - at);
      fs.readSync(fd, buf, 0, buf.length, at);
      fs.closeSync(fd);
      process.stdout.write(buf);
      at = size;
    }
  }
}

// Bits
// ----

// -d waiting for its part to be up (ready: its .up file written anew,
// `was` as before), UP at most: up; or not: down, its service failed
// (`failed`, seen early), else late: it runs (`runs`), not up yet
async function up(part: Part, was: string | null, failed: () => boolean, runs: () => boolean): Promise<"up" | "late" | "down"> {
  for (const until = Date.now() + UP; Date.now() < until; ) {
    const now = read(LOGS + "/" + part + ".up");
    if (now !== null && now !== was && alive(Number(now.split(" ")[0]))) {
      return "up";
    }
    if (failed()) {
      return "down";
    }
    await Bun.sleep(100);
  }
  return runs() ? "late" : "down";
}

// whether a service's supervisor and part run (Windows, macOS: by their
// pid file, once written anew, `was` as before); null: not written yet
function supervised(part: Part, was: string | null): boolean | null {
  const now = read(LOGS + "/" + part + ".pid");
  return now === null || now === was ? null : pids(part).every(alive);
}

// -d's one line: where it runs, or that it doesn't (yet)
function say(part: Part, up: "up" | "late" | "down", where: string): void {
  const logs = "`unii " + part + " logs` shows why.";
  if (up === "up") {
    console.log("unii " + part + " runs in the background, as " + where + ": `unii " + part + " logs -f` follows it, `unii " + part + " stop` removes it.");
  } else if (up === "late") {
    console.log("unii " + part + " runs as " + where + ", but " + (part === "device" ? "hasn't linked to its server" : "isn't listening yet") + " after " + UP / 1000 + " s: " + logs);
  } else {
    console.log("unii " + part + " is set up as " + where + ", but isn't running: " + logs);
  }
}

// a step of -d's or stop's (`verb`) as its time since the last, in the
// part's log on Windows and macOS (Linux's is the journal: none there)
function clock(part: Part, verb: string): (what: string) => void {
  let last = performance.now();
  return (what) => {
    const now = performance.now();
    if (WIN || MAC) {
      try {
        fs.mkdirSync(LOGS, { recursive: true, mode: 0o700 });
        fs.appendFileSync(LOGS + "/" + part + ".log", new Date().toISOString() + " unii " + part + " " + verb + ": " + what + " in " + ((now - last) / 1000).toFixed(2) + " s\n");
      } catch {}
    }
    last = now;
  };
}

// the supervisor's pid and its part's (none: [])
function pids(part: Part): number[] {
  return (read(LOGS + "/" + part + ".pid") ?? "").trim().split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

// of `list`, the pids still of this unii running `part`, by their command
// lines (Windows: one it won't show isn't)
export function ours(part: Part, list: number[]): number[] {
  const live = list.filter(alive);
  if (live.length === 0) {
    return [];
  }
  const got = procs(live.map((pid) => "ProcessId=" + pid).join(" OR "));
  return live.filter((pid) => got.some(([p, line]) => p === pid && runs(line, part)));
}

// -d's for a device: a warning if a device runs here in the foreground
// (`unii device`, not the service's), as two with one device.json take
// turns as one device
function alone(): void {
  const service = WIN || MAC ? pids("device") : [];
  const theirs = (pid: number) => (WIN || MAC ? service.includes(pid) : (read("/proc/" + pid + "/cgroup") ?? "").includes("/" + name("device") + ".service"));
  const found = procs("CommandLine LIKE '%device%'").filter(([pid, line]) => pid !== process.pid && runs(line, "device", '(\\s+"?https?://[^\\s"]*"?)?\\s*$') && !theirs(pid));
  if (found.length > 0) {
    console.error("unii: warning: a unii device runs here in the foreground already (pid " + found.map(([pid]) => pid).join(", ") + "). With the same sign-in (device.json) the two take turns as one device: stop it.");
  }
}

// whether a command line is this unii's (its executable's name) running
// `part`, then `then`
function runs(line: string, part: Part, then = "(\\s|$)"): boolean {
  const exe = path.basename(command().at(-1)!).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp('(^|[\\\\/\\s"])' + exe + '"?\\s+"?' + part + '"?' + then, "i").test(line);
}

// the processes here, [pid, command line]; on Windows those `wql` picks
// (a CIM filter)
function procs(wql: string): Array<[number, string]> {
  const out = WIN
    ? run([pwsh(), "-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process -Filter $env:UNII_WQL | ForEach-Object { [string]$_.ProcessId + ' ' + $_.CommandLine }"], { UNII_WQL: wql }).out
    : run(["ps", "-A", "-ww", "-o", "pid=,args="]).out;
  return out.split(/\r?\n/).flatMap((line): Array<[number, string]> => {
    const m = line.trim().match(/^(\d+)\s*(.*)$/);
    return m === null ? [] : [[Number(m[1]), m[2]]];
  });
}

function pwsh(): string {
  return Bun.which("pwsh") ?? "powershell.exe";
}

// an argument as Windows reads it back from a command line
// (CommandLineToArgvW): quoted if need be, a backslash run before a quote
// or the end doubled
export function winq(a: string): string {
  if (a !== "" && !/[\s"]/.test(a)) {
    return a;
  }
  return '"' + a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1") + '"';
}

function alive(pid: number | undefined): boolean {
  if (pid === undefined) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

function same(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return a === b;
  }
}

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// a command's exit code and output (trimmed), with `env` added
function run(cmd: string[], env: Record<string, string> = {}): { code: number; out: string; err: string } {
  const p = Bun.spawnSync(cmd, { env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
  return { code: p.exitCode ?? 1, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
}

function fail(why: string): never {
  console.error("unii: " + why);
  process.exit(1);
}
