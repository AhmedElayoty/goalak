/* REAL RESULTS, NOT A HASH.
 *
 * On the season's first morning Barcelona showed +8 for a match it plays two days later. The
 * scoring engine was still the pre-season simulator — a deterministic hash — and the flag that
 * kept it off the live screens had been armed by the calendar with nothing real behind it. This
 * suite drives the REAL engine lifted out of the shipped index.html: the arithmetic of every
 * scoring rule, the pending/blank/unloaded distinctions, and the one invariant that matters most:
 * a started round is NEVER fed by the hash.
 *
 *   node src/modules/real.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(HERE, "..", "..", "index.html"), "utf8");

/* lift REST + realMatch + simMatch in one slice so the gate is the real gate */
const from = HTML.indexOf("let REST = {};");
const to = HTML.indexOf("/* Built once, on first use");
if (from < 0 || to < 0) { console.log("FAIL  cannot find the scoring block"); process.exit(1); }
const SRC = HTML.slice(from, to);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL  " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", wanted " + JSON.stringify(b) + ")");

function world(o) {
  o = o || {};
  const loads = [];
  const ctx = {
    CLUBS: o.clubs || [{ id: "100", lg: "epl", code: "AAA" }, { id: "200", lg: "epl", code: "BBB" }],
    PRICES: o.prices || {},
    tierOf: id => (o.tiers || {})[String(id)] || "mid",
    seasonStarted: () => o.started !== false,
    playGw: () => (o.play != null ? o.play : 1),
    gwCount: () => 36,
    clubHasFixture: () => null,
    gwCoverage: () => 10 / 11,
    leagueMate: () => null,
    loadFixtures: g => loads.push(g),
    hash: s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; },
    Math, JSON, String, Number, Array, Object, Date, Map,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.__loads = loads;
  if (o.rest) {
    for (const [gw, entries] of Object.entries(o.rest)) {
      vm.runInContext("REST[" + gw + "] = new Map(" + JSON.stringify(entries) + ")", ctx);
    }
  }
  return ctx;
}
const M = (over) => Object.assign({ fin: 1, live: 0, gf: 0, ga: 0, opp: "200", home: true, ko: 1 }, over);

console.log("\n1 · the arithmetic of every rule, on real numbers");
{
  /* 2-0 win over an ELITE opponent: 6 (win) + 4 (two goals) + 3 (clean) + 6 (tier bonus) = 19 */
  const w = world({ tiers: { "200": "elite" }, rest: { 1: [["100", [M({ gf: 2, ga: 0 })]]] } });
  const m = w.realMatch("100", 1);
  eq(m.pts, 19, "a 2-0 win over an elite club pays 6+4+3+6");
  eq(m.win, true, "and is a win");
  ok(m.opp && m.opp.id === "200", "the opponent comes back as a club object, the shape the card reads");
}
{
  /* 1-3 loss: 0 (loss) + 2 (one goal) - 1 (three conceded, floor 3/2) = 1 */
  const w = world({ rest: { 1: [["100", [M({ gf: 1, ga: 3 })]]] } });
  eq(w.realMatch("100", 1).pts, 1, "a 1-3 loss pays 2 for the goal minus 1 for conceding");
}
{
  /* 0-0 draw: 2 (draw) + 3 (clean) = 5 */
  const w = world({ rest: { 1: [["100", [M({ gf: 0, ga: 0 })]]] } });
  eq(w.realMatch("100", 1).pts, 5, "a goalless draw pays the draw and the clean sheet");
}
{
  /* beating a STRONG (tier 2) club pays +3, not +6; beating a MID one pays nothing extra */
  const w2 = world({ tiers: { "200": "strong" }, rest: { 1: [["100", [M({ gf: 1, ga: 0 })]]] } });
  eq(w2.realMatch("100", 1).tierBonus, 3, "beating a strong club is +3");
  const w3 = world({ tiers: { "200": "mid" }, rest: { 1: [["100", [M({ gf: 1, ga: 0 })]]] } });
  eq(w3.realMatch("100", 1).tierBonus, 0, "beating a mid club carries no bonus");
}

console.log("\n2 · a double round is paid for BOTH matches — the simulator never was");
{
  const w = world({ rest: { 1: [["100", [M({ gf: 2, ga: 0 }), M({ gf: 1, ga: 1, opp: "200" })]]] } });
  const m = w.realMatch("100", 1);
  /* 2-0 win: 6+4+3=13; 1-1 draw: 2+2=4 -> 17 */
  eq(m.pts, 17, "two finished matches sum");
  eq(m.fin, 2, "and the card can say both were played");
}

console.log("\n3 · the three absences are three different answers");
{
  const w = world({ rest: { 1: [["100", [M({ fin: 0, gf: 0, ga: 0 })]]] } });
  const m = w.realMatch("100", 1);
  eq(m.pending, true, "a match still to come is PENDING");
  eq(m.pts, 0, "and pays nothing until it is played");
  eq(m.blank, false, "but is NOT blank - no auto-sub may take this club's place");
}
{
  const w = world({ rest: { 1: [["999", [M({})]]] } });   /* round loaded, club absent */
  const m = w.realMatch("100", 1);
  eq(m.blank, true, "a loaded round with no entry for the club is genuinely blank");
}
{
  const w = world({});                                     /* round not loaded at all */
  eq(w.realMatch("100", 1), null, "an unloaded round is null - the caller's job, not a guess");
}

console.log("\n4 · THE INVARIANT: a started round is never fed by the hash");
{
  const w = world({});                                     /* nothing loaded, round started */
  const m = w.simMatch("100", 1);
  eq(m.pending, true, "simMatch on a started, unloaded round answers PENDING");
  eq(m.pts, 0, "with zero points - nothing is invented");
  ok(w.__loads.includes(1), "and it kicks the loader for that round");
}
{
  /* the same call for a FUTURE round still simulates - the demo and the picker need it */
  const w = world({ play: 1 });
  const m = w.simMatch("100", 5);
  ok(m.pts !== undefined && !m.pending, "a future round still gets the simulator's estimate");
}
{
  /* and a loaded started round returns the REAL result even when the hash disagrees */
  const w = world({ rest: { 1: [["100", [M({ gf: 0, ga: 2 })]]] } });
  const m = w.simMatch("100", 1);
  eq(m.pts, -1, "a 0-2 loss pays -1, whatever the hash would have said");
}

console.log("\n" + "=".repeat(64));
console.log(fail ? "FAILED  " + fail + " of " + (pass + fail)
                 : "PASSED  " + pass + " assertions, 0 failures");
console.log("=".repeat(64) + "\n");
process.exit(fail ? 1 : 0);
