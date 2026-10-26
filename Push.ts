// Push
// ====
// Each turn's last message to the owner's phones (the iOS app, by APNs)
// and browsers (notify). Web Push (RFC 8030) with no vendor's account: the server's own VAPID
// key pair (RFC 8292), made at its first start and kept beside its config
// (config.DIR/vapid.json; a new pair loses every browser's subscription),
// signs each request, and each message is encrypted to its browser's
// keys (RFC 8291: aes128gcm, RFC 8188, one record), so the push service
// (Google's, Mozilla's, Apple's, as the browser picked) reads nothing.

import type { Database } from "bun:sqlite";
import * as crypto from "node:crypto";
import * as dns from "node:dns";
import * as fs from "node:fs";
import * as http2 from "node:http2";
import * as net from "node:net";
import * as config from "./Config.ts";
import { write_whole } from "./Write.ts";

export type Sub = { endpoint: string; p256dh: string; auth: string };

export type Keys = { jwk: JsonWebKey; public: string };

const FILE   = config.DIR + "/vapid.json";

// a record's size (RFC 8188): one record holds any message sent here
const RS     = 4096;

const TTL    = 24 * 60 * 60;

// how long a request's signature holds (s; RFC 8292 caps it at 24 h)
const AGE    = 12 * 60 * 60;

const ANSWER = 30 * 1000;

// the most an endpoint's URL may be (Chrome's, Firefox's, Apple's are
// under 500)
const URL_MAX = 2048;

const INSIDE = new net.BlockList();
for (const cidr of ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/3", "::/127", "fc00::/7", "fe80::/10", "ff00::/8"]) {
  const [ip, bits] = cidr.split("/");
  INSIDE.addSubnet(ip, Number(bits), net.isIPv6(ip) ? "ipv6" : "ipv4");
}

const GIST = 200;

export const ACTIVE_MS = 60 * 1000;

// the connection to APNs, kept open as Apple asks, and the token its
// requests carry, signed again past 40 minutes (Apple takes 20 to 60)
const PUSH = { link: null as http2.ClientHttp2Session | null, jwt: "", at: 0, by: "" };
const PUSH_AGE = 40 * 60 * 1000;

let KEYS: Keys | null | undefined;

export namespace Push {

  export function notify(db: Database, text: string): void {
    Push.phones(db, text);
    Push.browsers(db, text);
  }

  export function phones(db: Database, text: string): void {
    if (!config.APNS || !config.KEYS.apns) {
      return;
    }
        const phones = db.query("select token from pushes").all() as { token: string }[];
    const body = JSON.stringify({ aps: { alert: { body: Push.gist(text) }, sound: "default" } });
    for (const { token } of phones) {
      const link = Push.apns();
      const head = { ":method": "POST", ":path": "/3/device/" + token, authorization: "bearer " + Push.apns_jwt(), "apns-topic": config.APPLE.replace(/^[^.]*\./, ""), "apns-push-type": "alert" };
      const req = link.request(head);
      let out = "";
      req.setEncoding("utf8");
      req.on("data", (got) => (out += got));
      req.on("error", (err) => console.error("push: " + err.message));
      req.on("end", () => {
        if (/Unregistered|BadDeviceToken/.test(out)) {
          db.query("delete from pushes where token = ?").run(token);
        } else if (out !== "") {
          console.error("push: " + out);
        }
      });
      req.end(body);
    }
  }

  export function gist(text: string): string {
    return text.replace(/\s+/g, " ").slice(0, GIST);
  }

  export function browsers(db: Database, text: string): void {
        const subs = db.query("select endpoint, p256dh, auth from web_pushes").all() as Sub[];
    const body = JSON.stringify({ text: Push.gist(text) });
    for (const sub of subs) {
      Push.send(sub, body).then((status) => {
        if (status === 404 || status === 410) {
          db.query("delete from web_pushes where endpoint = ?").run(sub.endpoint);
        } else if (status !== 0 && (status < 200 || status > 299)) {
          console.error("web push: " + new URL(sub.endpoint).host + ": HTTP " + status);
        }
      });
    }
  }

  export function apns(): http2.ClientHttp2Session {
    if (PUSH.link === null || PUSH.link.closed || PUSH.link.destroyed) {
      const link = (PUSH.link = http2.connect("https://api.push.apple.com"));
      link.on("error", (err) => console.error("push: " + err.message));
      link.on("close", () => PUSH.link === link && (PUSH.link = null));
    }
    return PUSH.link!;
  }

  export function apns_jwt(): string {
    const by = crypto.createHash("sha256").update(config.APNS + "\0" + config.APPLE + "\0" + config.KEYS.apns).digest("hex");
    if (Date.now() - PUSH.at > PUSH_AGE || PUSH.by !== by) {
      const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
      const head = b64({ alg: "ES256", kid: config.APNS }) + "." + b64({ iss: config.APPLE.split(".")[0], iat: Math.floor(Date.now() / 1000) });
      const der = Buffer.from(config.KEYS.apns.replace(/-----[^-]+-----|\s/g, ""), "base64");
      const key = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
      const sig = crypto.sign("sha256", Buffer.from(head), { key, dsaEncoding: "ieee-p1363" });
      PUSH.jwt = head + "." + sig.toString("base64url");
      PUSH.at = Date.now();
      PUSH.by = by;
    }
    return PUSH.jwt;
  }


  export function keys(): Keys | null {
    if (KEYS !== undefined) {
      return KEYS;
    }
    if (!fs.existsSync(FILE)) {
      const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
      write_whole(FILE, JSON.stringify(privateKey.export({ format: "jwk" })) + "\n");
    }
    try {
      const jwk = JSON.parse(fs.readFileSync(FILE, "utf8"));
      crypto.createPrivateKey({ key: jwk, format: "jwk" });
      const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
      KEYS = { jwk, public: point.toString("base64url") };
    } catch (err: any) {
      console.error(FILE + " is not a VAPID key pair, so web push is off: put the right file back, or delete it for a new pair (every browser then turns notifications on again). " + (err?.message ?? err));
      KEYS = null;
    }
    return KEYS;
  }

  export function sub_read(json: any): Sub | null {
    const endpoint = String(json?.endpoint ?? "");
    const p256dh = String(json?.keys?.p256dh ?? "");
    const auth = String(json?.keys?.auth ?? "");
    if (endpoint.length > URL_MAX || !URL.canParse(endpoint) || new URL(endpoint).protocol !== "https:") {
      return null;
    }
    if (Buffer.from(auth, "base64url").length !== 16 || Push.point(p256dh) === null) {
      return null;
    }
    return { endpoint, p256dh, auth };
  }

  export async function inside(endpoint: string): Promise<boolean> {
    const host = new URL(endpoint).hostname.replace(/^\[|\]$/g, "");
    const ips = await dns.promises.lookup(host, { all: true }).catch(() => []);
    return ips.some((ip) => INSIDE.check(ip.address, ip.family === 6 ? "ipv6" : "ipv4"));
  }

  export function point(b64: string): crypto.KeyObject | null {
    const raw = Buffer.from(b64, "base64url");
    if (raw.length !== 65 || raw[0] !== 4) {
      return null;
    }
    try {
      const jwk = { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") };
      return crypto.createPublicKey({ key: jwk, format: "jwk" });
    } catch {
      return null;
    }
  }

  // a message encrypted to a browser (RFC 8291 3.4, RFC 8188 2): the
  // salt, the record size, the sender's one-off public key, then the one
  // record, the message padded by its delimiter (2: the last). The salt
  // and the sender's key are random but in tests
  export function encrypt(sub: Sub, plain: Uint8Array, salt: Buffer = crypto.randomBytes(16), as: crypto.ECDH = Push.ecdh()): Buffer {
    const ua_public = Buffer.from(sub.p256dh, "base64url");
    const as_public = as.getPublicKey();
    const secret = as.computeSecret(ua_public);
    const hmac = (key: Buffer, data: Buffer) => crypto.createHmac("sha256", key).update(data).digest();
    const prk_key = hmac(Buffer.from(sub.auth, "base64url"), secret);
    const key_info = Buffer.concat([Buffer.from("WebPush: info\0"), ua_public, as_public]);
    const ikm = hmac(prk_key, Buffer.concat([key_info, Buffer.from([1])]));
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
    const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
    const record = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
    const rs = Buffer.alloc(4);
    rs.writeUInt32BE(RS);
    return Buffer.concat([salt, rs, Buffer.from([as_public.length]), as_public, record]);
  }

  export function ecdh(): crypto.ECDH {
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();
    return ecdh;
  }

  // a request's Authorization (RFC 8292): a token for the endpoint's
  // origin, signed with the server's key, and that key
  export function vapid(endpoint: string, keys: Keys, now: number = Date.now()): string {
    const key = crypto.createPrivateKey({ key: keys.jwk, format: "jwk" });
    const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + AGE, sub: Push.subject() };
    const head = b64({ typ: "JWT", alg: "ES256" }) + "." + b64(claims);
    const sig = crypto.sign("sha256", Buffer.from(head), { key, dsaEncoding: "ieee-p1363" });
    return "vapid t=" + head + "." + sig.toString("base64url") + ", k=" + keys.public;
  }

  export function subject(): string {
    return config.SITE.startsWith("https:") ? config.SITE : "mailto:noreply@" + new URL(config.SITE).hostname;
  }

  // a message to a browser: the push service's answer's status (201:
  // taken; 404, 410: the subscription is gone), 0 if none came or push is
  // off. The answer's body is never read: the status says all
  export async function send(sub: Sub, text: string): Promise<number> {
    const keys = Push.keys();
    if (keys === null) {
      return 0;
    }
    try {
      // checked again here: a name may resolve elsewhere since it was taken
      if (await Push.inside(sub.endpoint)) {
        throw new Error("inside the server's network, not sent");
      }
      const headers = {
        authorization      : Push.vapid(sub.endpoint, keys),
        "content-encoding" : "aes128gcm",
        "content-type"     : "application/octet-stream",
        ttl                : String(TTL),
        urgency            : "normal",
      };
      const body = new Uint8Array(Push.encrypt(sub, Buffer.from(text)));
      const res = await fetch(sub.endpoint, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(ANSWER) });
      await res.body?.cancel().catch(() => null);
      return res.status;
    } catch (err: any) {
      console.error("web push: " + new URL(sub.endpoint).host + ": " + (err?.message ?? err));
      return 0;
    }
  }

}
