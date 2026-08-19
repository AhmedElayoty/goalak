/* THE TEAM FOLLOWS THE ACCOUNT — and the failure rules are the part that can destroy one.
 *
 * The owner built a squad on his PC and found nothing on his phone. Syncing it is easy; syncing
 * it WITHOUT ever eating somebody's team is the job. The WC app's own audit found the same bug
 * in three separate places — "failed" being rendered as "empty" — and this code has exactly
 * that shape: a network read that returns nothing looks identical to a manager with no squad.
 *
 * Every case below is driven through the real functions lifted out of the shipped index.html,
 * with fetch stubbed, so an edit to the merge rules moves this test with it.
 *
 *   node src/modules/cloud.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(HERE, "..", "..", "index.html"), "utf8");
const from = HTML.indexOf("const TDB_READ");
const to = HTML.indexOf("/* AN ACCOUNT IS REQUIRED HERE TOO");
if (from < 0 || to < 0) { console.log("FAIL  cannot find the cloud block in index.html"); process.exit(1); }
const SRC = HTML.slice(from, to);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL  " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", wanted " + JSON.stringify(b) + ")");

const REC = o => Object.assign({ v: 1, at: 1000, squad: ["a", "b"], cap: "a", vice: "b",
  team: "T", form: "", ledger: null, chips: [], ft: null, ob: "1", sk: "" }, o || {});

/* a world with its own storage, its own squad, and a fetch that does whatever the case needs */
function world(o) {
  o = o || {};
  const store = Object.assign({ gk_user: JSON.stringify({ uid: 7, username: "ahmed" }) }, o.store || {});
  const writes = [];
  const ctx = {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    squad: (o.squad || []).slice(),
    captain: o.captain || null,
    vice: o.vice || null,
    chipPlays: (o.chips || []).slice(),
    ftLoad: () => ({ gw: 1, banked: 1, base: [], join: 1 }),
    validateSquad: () => {},
    paintChrome: () => {},
    render: () => {},
    t: k => k,
    $: () => null,
    fetch: async (url, opts) => {
      if (opts && opts.method === "POST") {
        if (o.writeFails) throw new Error("network");
        writes.push(String(opts.body)); return { ok: true, status: 200 };
      }
      if (o.readFails) throw new Error("network");
      return { ok: true, status: 200, text: async () => o.server === undefined ? "" : JSON.stringify(o.server) };
    },
    setTimeout, clearTimeout, Date, JSON, Math, String, Number, Array, Object, encodeURIComponent, Error
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.__store = store; ctx.__writes = writes;
  /* FX_SYNC is a `let`, so it is a lexical binding and never a property of the context —
     reading ctx.FX_SYNC returns undefined and every assertion on it passes vacuously. */
  ctx.__sync = () => vm.runInContext("FX_SYNC", ctx);
  return ctx;
}
const lastWrite = w => {
  if (!w.__writes.length) return null;
  const b = w.__writes[w.__writes.length - 1];
  return JSON.parse(decodeURIComponent(b.split("&value=")[1]));
};

console.log("\n1 · the thing the owner actually hit");
{
  /* built on the PC, opening on a phone that has never seen it */
  const w = world({ squad: [], server: REC({ at: 5000, squad: ["x", "y", "z"], cap: "x" }) });
  await w.cloudPull();
  eq(w.squad.length, 3, "a squad on the server arrives on a device that had none");
  eq(w.captain, "x", "and the armband comes with it");
  eq(w.__store.fx_at, "5000", "the local stamp follows the record, so the next pull compares fairly");
}
{
  /* and the reverse: built here, server empty */
  const w = world({ squad: ["p", "q"], store: { fx_at: "9000" }, server: undefined });
  await w.cloudPull();
  const rec = lastWrite(w);
  ok(rec && rec.squad.length === 2, "an empty server gets OUR team pushed up, not the other way round");
}

console.log("\n2 · the failure rules — where a team gets eaten");
{
  const w = world({ squad: ["p", "q", "r"], store: { fx_at: "1000" }, readFails: true });
  await w.cloudPull();
  eq(w.squad.length, 3, "A FAILED READ IS NOT AN EMPTY TEAM — the local squad stands");
  eq(w.__writes.length, 0, "and nothing is written on the back of a failed read");
  eq(w.__sync(), "offline", "it is reported as offline rather than saved");
}
{
  const w = world({ squad: ["p", "q"], store: { fx_at: "9000" }, server: null });
  await w.cloudPull();
  eq(w.squad.length, 2, "a null record does not wipe a local squad");
}
{
  const w = world({ squad: ["p", "q"], store: { fx_at: "9000" }, server: REC({ at: 100, squad: [] }) });
  await w.cloudPull();
  eq(w.squad.length, 2, "an OLDER empty record does not wipe a newer local squad");
}
{
  const w = world({ squad: ["p"], store: { fx_at: "1" }, server: { v: 99, squad: ["x"] } });
  await w.cloudPull();
  eq(w.squad.length, 1, "a record from a future version is ignored, not half-applied");
  eq(w.squad[0], "p", "and the local squad is the one that survives");
}
{
  const w = world({ squad: ["p"], store: { fx_at: "1" }, server: REC({ squad: "not-an-array" }) });
  await w.cloudPull();
  eq(w.squad[0], "p", "a malformed squad field is refused");
}

console.log("\n3 · whoever is newer wins");
{
  const w = world({ squad: ["old"], store: { fx_at: "5000" }, server: REC({ at: 9000, squad: ["new1", "new2"] }) });
  await w.cloudPull();
  eq(w.squad.join(), "new1,new2", "a newer server record replaces an older local one");
}
{
  const w = world({ squad: ["mine"], store: { fx_at: "9000" }, server: REC({ at: 5000, squad: ["theirs"] }) });
  await w.cloudPull();
  eq(w.squad.join(), "mine", "an older server record does not");
  ok(w.__writes.length === 1, "and ours is pushed up instead");
}
{
  const w = world({ squad: ["mine"], store: { fx_at: "5000" }, server: REC({ at: 5000, squad: ["theirs"] }) });
  await w.cloudPull();
  eq(w.squad.join(), "mine", "an identical stamp is not newer — no pointless overwrite");
}

console.log("\n4 · what actually travels");
{
  const w = world({ squad: ["a", "b"], captain: "a", vice: "b",
    chips: [{ chip: "wildcard", half: 1, gw: 3, state: "active" }],
    store: { fx_at: "1", fx_team: "الفريق", fx_onboarded: "1", fx_tut_skips: "2" } });
  w.cloudPush(true);
  await new Promise(r => setTimeout(r, 30));
  const rec = lastWrite(w);
  ok(!!rec, "a push actually writes something");
  eq(rec.cap, "a", "the captain travels");
  eq(rec.vice, "b", "THE VICE TRAVELS — it is a decision, not a device setting");
  eq(rec.chips.length, 1, "played chips travel — they were not even saved locally before this");
  eq(rec.team, "الفريق", "the team name travels, Arabic intact");
  eq(rec.ob, "1", "onboarding state travels, so a second device does not re-run the tutorial");
  ok(rec.ft && rec.ft.banked === 1, "the transfer ledger travels — it is worth points");
}
{
  /* a full round trip through the two real functions */
  const w = world({ squad: ["a", "b"], captain: "a", vice: "b", store: { fx_at: "1", fx_team: "X" } });
  const snap = w.fxSnapshot();
  const w2 = world({ squad: [] });
  ok(w2.fxApply(snap), "a snapshot from one device applies on another");
  eq(w2.squad.join(), "a,b", "the squad survives the round trip");
  eq(w2.captain, "a", "the captain survives");
  eq(w2.vice, "b", "the vice survives");
  eq(w2.__store.fx_team, "X", "the team name survives");
}

console.log("\n5 · the things that must not happen");
{
  const w = world({ store: { gk_user: "" }, squad: ["a"] });
  await w.cloudPull();
  eq(w.__writes.length, 0, "signed out, nothing is read or written — there is no key to write to");
}
{
  const w = world({ squad: ["a"], store: { fx_at: "1" }, writeFails: true });
  w.cloudPush(true);
  await new Promise(r => setTimeout(r, 30));
  eq(w.__sync(), "offline", "a failed write says offline rather than claiming it saved");
}
{
  const w = world({ squad: ["a"], store: { fx_at: "1" } });
  w.cloudPush(); w.cloudPush(); w.cloudPush();
  await new Promise(r => setTimeout(r, 40));
  eq(w.__writes.length, 0, "three taps in a row do not fire three writes immediately");
  await new Promise(r => setTimeout(r, 1400));
  eq(w.__writes.length, 1, "they settle into exactly one");
}

console.log("\n" + "=".repeat(64));
console.log(fail ? "FAILED  " + fail + " of " + (pass + fail)
                 : "PASSED  " + pass + " assertions, 0 failures");
console.log("=".repeat(64) + "\n");
process.exit(fail ? 1 : 0);
