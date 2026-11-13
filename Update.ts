import * as crypto from "node:crypto";
import KEY from "./release/unii.pub" with { type: "text" };

export const VERSION = "40.rc5";

// a release candidate (N.rcM, a pre-release on the rc branch) is only ever
// installed by hand, with its own release's install line: `unii update`
// never moves to or from one
export const RC = /\.rc[0-9]+$/.test(VERSION);

export const BASE = "https://github.com/arteeh/uniichat/releases/" + (RC ? "download/" + VERSION : "latest/download");

// a release candidate's own install line, else the latest release's
export function install_cmd(win: boolean): string {
  return win ? "irm " + BASE + "/install.ps1 | iex" : "curl -fsSL " + BASE + "/install.sh | sh";
}

// release files are signed with `ssh-keygen -Y sign -n unii-release`
// (PROTOCOL.sshsig) by the key in release/unii.pub
const NAMESPACE = "unii-release";
const ED = "ssh-ed25519";

function strings(b: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let at = 0; at < b.length;) {
    const n = at + 4 <= b.length ? new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0) : Infinity;
    if (at + 4 + n > b.length) {
      throw new Error("cut short");
    }
    out.push(b.subarray(at + 4, at + 4 + n));
    at += 4 + n;
  }
  return out;
}

function string(b: Uint8Array | string): Buffer {
  const s = Buffer.from(b);
  const n = Buffer.alloc(4);
  n.writeUInt32BE(s.length);
  return Buffer.concat([n, s]);
}

// why `data` isn't signed by the release key (`key`, an ssh-ed25519 line),
// or null if it is
export function unsigned(data: Uint8Array, sig: string, key = KEY): string | null {
  const [type, b64] = key.trim().split(/\s+/);
  const pub = Buffer.from(b64 ?? "", "base64");
  let raw: Uint8Array[];
  try {
    raw = strings(pub);
  } catch {
    raw = [];
  }
  if (type !== ED || raw.length !== 2 || Buffer.from(raw[0]).toString() !== ED || raw[1].length !== 32) {
    return "this unii has no release key built in";
  }
  const armor = /-----BEGIN SSH SIGNATURE-----([^-]*)-----END SSH SIGNATURE-----/.exec(sig);
  if (armor === null) {
    return "no SSH signature";
  }
  const blob = Buffer.from(armor[1].replace(/\s/g, ""), "base64");
  if (blob.subarray(0, 6).toString() !== "SSHSIG" || blob.length < 10 || blob.readUInt32BE(6) !== 1) {
    return "not an SSH signature";
  }
  let parts: Uint8Array[];
  let inner: Uint8Array[];
  try {
    parts = strings(blob.subarray(10));
    inner = parts.length === 5 ? strings(parts[4]) : [];
  } catch {
    return "the signature is cut short";
  }
  if (inner.length !== 2 || Buffer.from(inner[0]).toString() !== ED) {
    return "not an ssh-ed25519 signature";
  }
  const [signer, space, reserved, hash] = parts;
  if (!pub.equals(signer)) {
    return "signed by another key";
  }
  if (Buffer.from(space).toString() !== NAMESPACE) {
    return "not signed as a unii release";
  }
  const algo = Buffer.from(hash).toString();
  if (algo !== "sha512" && algo !== "sha256") {
    return "unknown hash " + algo;
  }
  const signed = Buffer.concat([Buffer.from("SSHSIG"), string(space), string(reserved), string(hash), string(crypto.createHash(algo).update(data).digest())]);
  const verifier = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw[1]).toString("base64url") }, format: "jwk" });
  return crypto.verify(null, signed, verifier, inner[1]) ? null : "the signature doesn't match";
}
