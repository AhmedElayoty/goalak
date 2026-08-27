/* THE TRANSFER ECONOMY, TESTED AGAINST THE SHIPPED SOURCE.
 *
 * This is the only rule in Goallak that can TAKE POINTS AWAY from a manager, so it is the one
 * rule that must not be wrong. The code lives in index.html rather than a module, so the test
 * lifts the real block out of the shipped file and runs it against stubs — if somebody edits
 * index.html, this test moves with it. A copy of the logic would prove nothing.
 *
 *   node src/modules/transfers.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(HERE, "..", "..", "index.html"), "utf8");

const from = HTML.indexOf("const FT_MAX");
const to = HTML.indexOf("/* THE DEADLINE.");
if (from < 0 || to < 0 || to < from) {
  console.log("FAIL  cannot find the transfer block in index.html");
  process.exit(1);
}
const SRC = HTML.slice(from, to);

/* THE BLOCK STOPPED BEING SELF-CONTAINED, AND THE SUITE WENT SILENT AGAIN.
 * v6.76 taught ftSync the owner's rule - "no full team, no score" - and that pulled three
 * names in from outside this slice: SQUAD_SIZE, hasFullLineup and snapLoad. The harness
 * carried none of them, so the very first ftSync() threw ReferenceError and the file ran
 * ZERO of its assertions across v6.76, v6.77, v6.78 and v6.79 - the SECOND time this test
 * has been silenced in exactly this way (see the note on syncNow below).
 *
 * They are LIFTED from the shipped source, not restated here, for the same reason the
 * transfer block is: a copy would prove nothing and would drift. Both depend only on
 * localStorage, JSON and Array, which this world already holds.
 */
const sizes = HTML.match(/const START_SIZE = (\d+), BENCH_SIZE = (\d+);/);
if (!sizes) {
  console.log("FAIL  cannot read START_SIZE/BENCH_SIZE from index.html");
  process.exit(1);
}
const SQUAD_SIZE = Number(sizes[1]) + Number(sizes[2]);

const depFrom = HTML.indexOf("function hasFullLineup(");
const depTo = HTML.indexOf("function snapTake(");
if (depFrom < 0 || depTo < 0 || depTo < depFrom) {
  console.log("FAIL  cannot find hasFullLineup/snapLoad in index.html");
  process.exit(1);
}
const DEPS = HTML.slice(depFrom, depTo);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL  " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + a + ", wanted " + b + ")");

/* a fresh little world per case: its own storage, its own squad, its own round */
function world(o) {
  o = o || {};
  const store = {};
  const ctx = {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    CURRENT_GW: o.gw != null ? o.gw : 5,
    /* liveGw is the round edits count for; the harness pins it, exactly as it pins CURRENT_GW */
    liveGw: () => (o.gw != null ? o.gw : 5),
    gwCount: () => 36,
    squad: (o.squad || []).slice(),
    /* it is a question now, not a constant frozen at parse: an installed app left open across
       the opening deadline kept answering "pre-season" while every other clock had moved on */
    seasonStarted: () => o.seasonStarted !== false,
    playGw: () => (o.gw != null ? o.gw : 5),
    activeChipFor: () => o.chip || null,
    /* the squad size the shipped file computes, read from the shipped file */
    SQUAD_SIZE,
    /* ftSave publishes to the account since v6.26. Without a stub the whole suite threw on
       its FIRST assertion and ran ZERO of them - which is how the transfer economy, the one
       rule that can take points away, went uncovered while the file reported "pass". */
    syncNow: () => {},
    Math, JSON, String, Number, Array, isFinite
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  /* helpers first: the transfer block calls them */
  vm.runInContext(DEPS, ctx);
  vm.runInContext(SRC, ctx);
  /* a sealed round is the OTHER half of the owner's full-team rule, so a world has to be
     able to hold one: hasFullLineup accepts a complete snapshot as proof a team existed. */
  if (o.snap) ctx.localStorage.setItem("fx_snap", JSON.stringify(o.snap));
  if (o.saved) ctx.localStorage.setItem("fx_ft", JSON.stringify(o.saved));
  return ctx;
}
const S = (n, p) => Array.from({ length: n }, (_, i) => (p || "c") + i);

console.log("\n1 · the manager's own first round is free, whenever he arrives");
{
  /* the owner's rule: somebody who comes in after many rounds should still get to build
     his squad before his next round starts. The free window is HIS, not the season's. */
  const w = world({ gw: 12, squad: S(15) });
  w.ftSync();
  const st = w.transferState();
  ok(st.unlimited, "a manager joining at round 12 gets his first build free");
  eq(st.cost, 0, "and it costs him nothing");
  eq(JSON.parse(w.localStorage.getItem("fx_ft")).join, 12, "his join round is remembered");
}
{
  const w = world({ gw: 1, squad: S(15) });
  w.ftSync();
  ok(w.transferState().unlimited, "and so does a manager who joins at round 1");
}
{
  /* the window closes when HIS first round ends, not before */
  const w = world({ gw: 13, squad: S(15), saved: { gw: 12, banked: 1, base: S(15), join: 12 } });
  w.ftSync();
  ok(!w.transferState().unlimited, "at his second round the charge starts");
}

console.log("\n2 · one free transfer a round");
{
  const base = S(15);
  const w = world({ gw: 13, squad: base.slice(0, 14).concat(["new1"]),
                    saved: { gw: 13, banked: 1, base: base, join: 12 } });
  const st = w.transferState();
  eq(st.made, 1, "one club swapped counts as one transfer");
  eq(st.cost, 0, "and the free one covers it");
}
{
  const base = S(15);
  const w = world({ gw: 13, squad: base.slice(0, 13).concat(["new1", "new2"]),
                    saved: { gw: 13, banked: 1, base: base, join: 12 } });
  const st = w.transferState();
  eq(st.made, 2, "two clubs swapped counts as two");
  eq(st.cost, 4, "the second one costs 4");
}
{
  const base = S(15);
  const w = world({ gw: 13, squad: S(15, "x"), saved: { gw: 13, banked: 1, base: base, join: 12 } });
  const st = w.transferState();
  eq(st.made, 15, "changing the whole team is fifteen transfers");
  eq(st.cost, 56, "and it costs 56 points — which is the point of having a cost at all");
}

console.log("\n3 · banking, capped at five");
{
  const base = S(15);
  const w = world({ gw: 14, squad: base, saved: { gw: 13, banked: 1, base: base, join: 12 } });
  eq(w.ftSync().banked, 2, "a round where he made no transfer banks one");
}
{
  const base = S(15);
  const w = world({ gw: 14, squad: base.slice(0, 14).concat(["n"]),
                    saved: { gw: 13, banked: 3, base: base, join: 12 } });
  eq(w.ftSync().banked, 3, "spending one of three leaves two, plus this round's one");
}
{
  const base = S(15);
  const w = world({ gw: 14, squad: base, saved: { gw: 13, banked: 5, base: base, join: 12 } });
  eq(w.ftSync().banked, 5, "the bank stops at five and does not creep to six");
}
{
  const base = S(15);
  const w = world({ gw: 14, squad: S(15, "x"), saved: { gw: 13, banked: 2, base: base, join: 12 } });
  eq(w.ftSync().banked, 1, "a round spent far past the allowance still leaves next round's one");
}
{
  const base = S(15);
  const w = world({ gw: 13, squad: base.slice(0, 12).concat(["a", "b", "c"]),
                    saved: { gw: 13, banked: 3, base: base, join: 12 } });
  eq(w.transferState().cost, 0, "three banked transfers pay for three changes");
}
{
  /* not opening the app is not an offence. Three rounds go by, three transfers accrue. */
  const base = S(15);
  const w = world({ gw: 16, squad: base, saved: { gw: 13, banked: 1, base: base, join: 12 } });
  eq(w.ftSync().banked, 4, "skipping three rounds banks three, not one");
}
{
  const base = S(15);
  const w = world({ gw: 30, squad: base, saved: { gw: 13, banked: 1, base: base, join: 12 } });
  eq(w.ftSync().banked, 5, "and a very long absence is still capped at five");
}

console.log("\n4 · the chips lift the charge, which is what their copy promises");
for (const chip of ["wildcard-1", "wildcard-2", "freehit-1"]) {
  const base = S(15);
  const w = world({ gw: 13, squad: S(15, "x"), chip: chip,
                    saved: { gw: 13, banked: 1, base: base, join: 12 } });
  const st = w.transferState();
  ok(st.unlimited, chip + " makes the round unlimited");
  eq(st.cost, 0, chip + " charges nothing for a full rebuild");
}
{
  const base = S(15);
  const w = world({ gw: 13, squad: S(15, "x"), chip: "bench-1",
                    saved: { gw: 13, banked: 1, base: base, join: 12 } });
  ok(!w.transferState().unlimited, "a chip that is not a wildcard does NOT lift the charge");
}

console.log("\n5 · before the season opens nothing costs anything");
{
  const w = world({ gw: 3, squad: S(15, "x"), seasonStarted: false,
                    saved: { gw: 3, banked: 1, base: S(15), join: 1 } });
  eq(w.transferState().cost, 0, "pre-season is free");
}

console.log("\n5b · the ledger heals itself and never charges a phantom round");
{
  /* join stamped in the future by the morning the lock sat wrongly at midnight: it quietly
     turned round 1 from the manager's free build round into a charged one */
  const w = world({ gw: 1, squad: S(15), saved: { gw: 1, banked: 1, base: S(15), join: 2 } });
  const v = w.ftSync();
  eq(v.join, 1, "a join round in the future clamps to the live round");
}
{
  /* a -4 booked against a round that has not been played is erased on sight */
  const w = world({ gw: 2, squad: S(15), saved: { gw: 2, banked: 1, base: S(15), join: 1, paid: { "5": 4 } } });
  const v = w.ftSync();
  ok(!v.paid || !v.paid["5"], "a hit on an unplayed round is erased");
}
{
  /* the lock moved EARLIER (a deploy): the stored round is ahead of the live one, so nothing
     closed and nothing may be banked or charged - even with six changes on the baseline */
  const w = world({ gw: 1, squad: S(15), saved: { gw: 2, banked: 3,
    base: S(9).concat(["y1","y2","y3","y4","y5","y6"]), join: 1 } });
  const v = w.ftSync();
  eq(v.gw, 1, "the baseline round resets to the live round");
  ok(!v.paid || Object.keys(v.paid).length === 0, "and no hit is booked for a round that never closed");
}
{
  /* v6.76, THE OWNER'S RULE: no full team, no score. A join stamped by a half-built team
     under the old rule - which took ANY club at all - is erased until the fifteen are real:
     left standing, the backfill would hand the finished team rounds it never entered.
     Nothing asserted this when it shipped; deleting the heal left all 37 assertions green. */
  const w = world({ gw: 13, squad: S(14), saved: { gw: 13, banked: 1, base: S(14), join: 12 } });
  const v = w.ftSync();
  eq(v.join, 0, "a join stamped by a half-built team is erased");
}
{
  /* and it must not touch a real one - erasing every join makes every round a free build */
  const w = world({ gw: 13, squad: S(15), saved: { gw: 13, banked: 1, base: S(15), join: 12 } });
  const v = w.ftSync();
  eq(v.join, 12, "a real fifteen keeps its join round");
}
{
  /* the other half of the rule, as hasFullLineup words it: a SEALED round proving a complete
     team existed counts too, so somebody sitting on fourteen mid-transfer today does not lose
     the round he actually joined in */
  const w = world({ gw: 13, squad: S(14), snap: { "12": { sq: S(15) } },
                    saved: { gw: 13, banked: 1, base: S(14), join: 12 } });
  const v = w.ftSync();
  eq(v.join, 12, "a sealed full round keeps the join while the live squad is short");
}

console.log("\n6 · the things that must never happen");
{
  const base = S(15);
  const w = world({ gw: 13, squad: base, saved: { gw: 13, banked: 1, base: base, join: 12 } });
  eq(w.transferState().made, 0, "an untouched squad is zero transfers, not fifteen");
  eq(w.transferState().cost, 0, "and costs nothing");
}
{
  const base = S(15);
  const w = world({ gw: 13, squad: base.slice().reverse(),
                    saved: { gw: 13, banked: 1, base: base, join: 12 } });
  eq(w.transferState().made, 0, "reordering the same fifteen is not a transfer");
}
{
  const w = world({ gw: 13, squad: [], saved: { gw: 13, banked: 1, base: [], join: 12 } });
  eq(w.transferState().cost, 0, "an empty squad cannot owe points");
}
{
  const w = world({ gw: 13, squad: S(15), saved: { gw: 13, banked: 0, base: S(15), join: 12 } });
  ok(w.transferState().free >= 1, "a corrupt zero bank still grants this round's transfer");
}
{
  const w = world({ gw: 13, squad: S(15), saved: { gw: 13, banked: 99, base: S(15), join: 12 } });
  eq(w.transferState().free, 5, "a corrupt huge bank is clamped to five");
}
{
  const w = world({ gw: 13, squad: S(15) });      /* nothing saved at all */
  eq(w.transferState().cost, 0, "no saved state is not a reason to charge somebody");
}

console.log("\n" + "=".repeat(64));
console.log(fail ? "FAILED  " + fail + " of " + (pass + fail)
                 : "PASSED  " + pass + " assertions, 0 failures");
console.log("=".repeat(64) + "\n");
process.exit(fail ? 1 : 0);
