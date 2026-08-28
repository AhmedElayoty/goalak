/* THE SUBSCRIPTION DOOR, tested against the SHIPPED worker source.
 *
 * /api/push/subscribe takes no session — it cannot, because a signed-out visitor is
 * allowed to turn match alerts on. Everything that keeps it safe therefore lives in the
 * shape check, so the shape check is worth pinning.
 *
 * What it used to accept: {"endpoint":"https://aaa","keys":{"p256dh":"x","auth":"y"}}.
 * That was a valid subscriber. The send path lists the store by key — the endpoint — in
 * lexicographic order and keeps the first 5000, so a few thousand records beginning
 * "https://aaa…" sort ahead of every real fcm.googleapis.com and web.push.apple.com
 * endpoint and push the entire real audience off the end. Notifications stop for everybody
 * and /health stays green, because the match feed was never the problem.
 *
 *   node pushsub.test.mjs        (from goalak/worker)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, "src", "index.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL  " + m); } };

/* lift the real validator + sanitiser out of the shipped file, so an edit there fails here */
function lift(re, what) {
  const m = src.match(re);
  if (!m) throw new Error("could not find " + what + " in src/index.js");
  return m[0];
}
const { sanitizeSubRec, b64urlBytes } = new Function(
  lift(/const B64URL = [\s\S]*?\n\}/, "b64urlBytes") + "\n" +
  lift(/function sanitizeSubRec\(b\)[\s\S]*?\n\}/, "sanitizeSubRec") + "\n" +
  "return { sanitizeSubRec, b64urlBytes };"
)();

const b64url = b => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
/* an uncompressed P-256 point is 65 bytes and starts 0x04; auth is 16 bytes (RFC 8291) */
const realP256 = () => b64url(Buffer.concat([Buffer.from([4]), crypto.randomBytes(64)]));
const realAuth = () => b64url(crypto.randomBytes(16));
const sub = over => Object.assign({
  endpoint: "https://fcm.googleapis.com/fcm/send/" + crypto.randomBytes(16).toString("hex"),
  keys: { p256dh: realP256(), auth: realAuth() },
  lgs: [], teams: [], lang: "ar"
}, over || {});

console.log("\n1 · a real subscription is never turned away");
ok(sanitizeSubRec(sub()) !== null, "a Chrome/FCM subscription is accepted");
ok(sanitizeSubRec(sub({ endpoint: "https://web.push.apple.com/QA" + "x".repeat(40) })) !== null,
   "an Apple endpoint is accepted");
ok(sanitizeSubRec(sub({ endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc" })) !== null,
   "a Firefox endpoint is accepted");
/* browsers differ on whether they pad; both are the same bytes and both must pass */
{
  const s = sub();
  s.keys.p256dh = s.keys.p256dh.replace(/=+$/, "");
  s.keys.auth = s.keys.auth.replace(/=+$/, "");
  ok(sanitizeSubRec(s) !== null, "unpadded base64url is accepted — padding is not the contract");
}
ok(b64urlBytes(realP256()) === 65, "a real p256dh measures 65 bytes");
ok(b64urlBytes(realAuth()) === 16, "a real auth measures 16 bytes");

console.log("\n2 · the flood record is refused");
ok(sanitizeSubRec({ endpoint: "https://aaa0000001", keys: { p256dh: "x", auth: "y" } }) === null,
   "the exact junk record that would have displaced the real audience");
ok(sanitizeSubRec(sub({ keys: { p256dh: "x", auth: realAuth() } })) === null, "a one-character p256dh");
ok(sanitizeSubRec(sub({ keys: { p256dh: realP256(), auth: "y" } })) === null, "a one-character auth");
ok(sanitizeSubRec(sub({ keys: { p256dh: b64url(crypto.randomBytes(32)), auth: realAuth() } })) === null,
   "a 32-byte p256dh — right charset, wrong curve point size");
ok(sanitizeSubRec(sub({ keys: { p256dh: realP256(), auth: b64url(crypto.randomBytes(8)) } })) === null,
   "an 8-byte auth");
ok(sanitizeSubRec(sub({ keys: { p256dh: "aaa+bbb/ccc=", auth: realAuth() } })) === null,
   "standard base64 (+ and /) is not base64url");

console.log("\n3 · the older guards still hold");
ok(sanitizeSubRec(null) === null, "no body");
ok(sanitizeSubRec({ endpoint: "http://insecure.example", keys: { p256dh: realP256(), auth: realAuth() } }) === null,
   "a non-https endpoint");
ok(sanitizeSubRec(sub({ endpoint: "https://" + "e".repeat(2000) })) === null, "an over-long endpoint");
{
  const s = sanitizeSubRec(sub({ teams: Array.from({ length: 40 }, (_, i) => "t" + i),
                                 events: Array.from({ length: 90 }, (_, i) => "e" + i) }));
  ok(s && s.teams.length === 10, "followed teams are still capped at ten");
  ok(s && s.events.length === 30, "belled matches are still capped at thirty");
}

console.log("\n4 · the store cannot be filled without bound");
ok(/const SUB_CAP = \d+;/.test(src), "a cap on stored subscriptions exists");
ok(/if \(!existing\) \{[\s\S]*?if \(all\.size >= SUB_CAP\) return json\(\{ ok: false, error: "sub-cap" \}, 507\);/.test(src),
   "and it applies only to endpoints the store has never seen");
ok(/const existing = await this\.state\.storage\.get\(key\);/.test(src),
   "an endpoint already in the store can always re-subscribe — nobody is locked out of their own record");

console.log("\n" + "=".repeat(64));
console.log(fail ? "FAILED  " + fail + " of " + (pass + fail)
                 : "PASSED  " + pass + " assertions, 0 failures");
console.log("=".repeat(64) + "\n");
process.exit(fail ? 1 : 0);
