/* THE FIELD-LEVEL MERGE, PROVEN ON THE EXACT INCIDENTS THAT DEMANDED IT.
 *
 * Every case below is a thing that actually happened this weekend or a two-device race one
 * step away from it. The function under test is the real exported mergeFxRecord — no copy.
 *
 *   node fxmerge.test.mjs        (from goalak/worker)
 */
import { mergeFxRecord } from "./src/accounts.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL  " + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + "  (got " + JSON.stringify(a) + ", wanted " + JSON.stringify(b) + ")");

const NOW = 1000000000;
const REC = o => Object.assign({ v: 1, at: NOW, squad: ["a","b"], cap: "a", vice: "b",
  team: "T", form: "", ledger: null, chips: [], ft: {gw:2, banked:1, base:[], join:1, paid:{}},
  ob: "1", sk: "", snap: {} }, o || {});

console.log("\n1 · the present belongs to the fresher writer");
{
  const stored = REC({ at: NOW, team: "Barca4ever FC", cap: "x" });
  const stale  = REC({ at: NOW - 5000, team: "Goallak FC", cap: "y" });
  const m = mergeFxRecord(stored, stale, NOW);
  eq(m.team, "Barca4ever FC", "a stale push cannot rename the team back");
  eq(m.cap, "x", "or move the armband");
  eq(m.at, NOW, "and the record keeps the fresher stamp");
}
{
  const stored = REC({ at: NOW - 5000, team: "Old FC" });
  const fresh  = REC({ at: NOW, team: "New FC" });
  eq(mergeFxRecord(stored, fresh, NOW).team, "New FC", "a genuinely newer edit lands normally");
}
{
  /* a wrong clock buys no priority: claiming to be from tomorrow is clamped */
  const stored = REC({ at: NOW + 3600000, team: "Real" });
  const liar   = REC({ at: NOW + 999999999, team: "Liar" });
  eq(mergeFxRecord(stored, liar, NOW).team, "Real", "a client clock hours ahead cannot jump the queue");
}

console.log("\n2 · the ledger: the incident of the returning -28");
{
  const repaired = REC({ at: NOW, ft: {gw:2, banked:5, base:[], join:1, paid:{}} });
  const staleTel = REC({ at: NOW - 60000, ft: {gw:2, banked:1, base:[], join:2, paid:{"1":28}} });
  const m = mergeFxRecord(repaired, staleTel, NOW);
  eq(m.ft.join, 1, "join never increases, whoever writes");
  eq(m.ft.paid, {}, "and a hit on the (now-)join round is a contradiction, dropped");
}
{
  /* a real hit, booked once, survives the OTHER device never having seen it */
  const stored = REC({ at: NOW - 60000, ft: {gw:5, banked:2, base:[], join:1, paid:{"4":8}} });
  const fresh  = REC({ at: NOW, ft: {gw:5, banked:3, base:[], join:1, paid:{}} });
  const m = mergeFxRecord(stored, fresh, NOW);
  eq(m.ft.paid, {"4":8}, "a booked hit is write-once: absence on a device is not an appeal");
  eq(m.ft.banked, 3, "while the working fields follow the fresher writer");
}

{
  /* the push-heal-push fight: the client deletes a hit for a round that has not closed, the
     merge used to resurrect it from the stored copy, and the two stores fought for ever */
  const stored = REC({ at: NOW - 60000, ft: {gw:5, banked:2, base:[], join:1, paid:{"4":8, "5":4, "7":4}} });
  const fresh  = REC({ at: NOW, ft: {gw:5, banked:2, base:[], join:1, paid:{"4":8}} });
  const m = mergeFxRecord(stored, fresh, NOW);
  eq(m.ft.paid, {"4":8}, "a hit at or past the fresher writer's open round is phantom and stays dead");
}

console.log("\n3 · snapshots: history is written once");
{
  const real = {sq:["r1"], cap:"r1"};
  const guess = {sq:["g1"], cap:"g1", bf:1};
  const stored = REC({ at: NOW, snap: {"1": real} });
  const inc    = REC({ at: NOW + 1, snap: {"1": guess, "2": guess} });
  const m = mergeFxRecord(stored, inc, NOW);
  eq(m.snap["1"].sq, ["r1"], "a real sealed lineup is never replaced by an estimate, even a fresher one");
  eq(m.snap["2"].sq, ["g1"], "a round only one side holds arrives whole");
}
{
  const stored = REC({ at: NOW, snap: {"1": {sq:["g1"], cap:"g1", bf:1}} });
  const inc    = REC({ at: NOW - 5000, snap: {"1": {sq:["r1"], cap:"r1"}} });
  eq(mergeFxRecord(stored, inc, NOW).snap["1"].sq, ["r1"],
     "an estimate is upgraded to a real record even by a STALE writer - history outranks recency");
}

console.log("\n4 · chips: a played Triple Captain cannot be erased by a device that never saw it");
{
  const stored = REC({ at: NOW, chips: [{chip:"tripcap", half:1, gw:1, state:"active"}] });
  const stale  = REC({ at: NOW - 60000, chips: [] });
  const m = mergeFxRecord(stored, stale, NOW);
  eq(m.chips.length, 1, "the play survives the stale writer's empty list");
  eq(m.chips[0].chip, "tripcap", "and it is the right play");
}
{
  /* the reverse race: the play lives only on the stale side - it is ADDED, never dropped */
  const stored = REC({ at: NOW, chips: [] });
  const stale  = REC({ at: NOW - 60000, chips: [{chip:"freehit", half:1, gw:3, state:"active"}] });
  eq(mergeFxRecord(stored, stale, NOW).chips.length, 1, "a play only the stale device knows is added");
}
{
  /* a fresher CANCEL stands against a stale device still carrying the play */
  const stored = REC({ at: NOW - 60000, chips: [{chip:"wildcard", half:1, gw:2, state:"active"}] });
  const fresh  = REC({ at: NOW, chips: [{chip:"wildcard", half:1, gw:2, state:"cancelled"}] });
  const m = mergeFxRecord(stored, fresh, NOW);
  eq(m.chips.length, 1, "one entry per family");
  eq(m.chips[0].state, "cancelled", "and the fresher intent wins");
}

console.log("\n6 · a wrong clock buys no priority — and cannot keep it either");
{
  /* THE INCIDENT THIS PREVENTS. The clamp guarded the COMPARISON and then Object.assign
     carried the raw inc.at through, so a phone a year fast wrote a stamp a year into the
     future exactly once. Every honest write afterwards was "older", took the stale branch,
     and was reverted to that phone's squad - for a year. The client stores the server's
     stamp and sends it back, so the poison re-armed itself on every sync. The only escape
     was a wipe, which costs the manager his whole history. */
  const YEAR = 365 * 86400000;
  const stored = REC({ at: NOW - 5000, team: "Honest FC", squad: ["a", "b"] });
  const skewed = REC({ at: NOW + YEAR, team: "Fast Clock FC", squad: ["x", "y"] });
  const m1 = mergeFxRecord(stored, skewed, NOW);
  eq(m1.team, "Fast Clock FC", "the skewed write is still the fresher one, so it lands");
  ok(m1.at <= NOW + 120000, "but the stamp it LEAVES BEHIND is clamped to now+2min");
  ok(m1.at < NOW + YEAR, "not the year-away value the device asked for");

  const honest = REC({ at: NOW + 1000, team: "Honest FC", squad: ["a", "b"] });
  const m2 = mergeFxRecord(m1, honest, NOW + 1000);
  eq(m2.team, "Honest FC", "so the owner's next transfer is NOT reverted");
  eq(m2.squad, ["a", "b"], "and his squad stands");
}
{
  const stored = REC({ at: NOW - 5000 });
  const fresh = REC({ at: NOW });
  eq(mergeFxRecord(stored, fresh, NOW).at, NOW, "an ordinary write still keeps its own stamp");
}

console.log("\n5 · first contact and wipes");
{
  eq(mergeFxRecord(null, REC({team:"First"}), NOW).team, "First", "no stored record: the write lands whole");
}

console.log("\n" + "=".repeat(64));
console.log(fail ? "FAILED  " + fail + " of " + (pass + fail)
                 : "PASSED  " + pass + " assertions, 0 failures");
console.log("=".repeat(64) + "\n");
process.exit(fail ? 1 : 0);
