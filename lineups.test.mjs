/* A PUBLISHED XI IS ELEVEN NAMES, TESTED AGAINST THE SHIPPED SOURCE.
 *
 * ESPN answers a pre-match summary with a stub roster - one name per side - well before the
 * real team sheet drops. Three places in this app read "the roster array is not empty" and
 * concluded the line-ups had arrived, and the worst of the three was the cache: pending went
 * false on the stub, so the stub was cached and never re-checked, and nothing a reader can do
 * inside a pre-match sheet dislodges it. Barcelona v Rayo, thirty-nine minutes before
 * kick-off, showed one goalkeeper per side under a heading reading "Starting XI" while La
 * Liga had published both elevens twenty minutes earlier.
 *
 * The three now share one answer, and this is the file that refuses a fourth place that does
 * not. The functions are lifted out of the shipped index.html rather than restated, for the
 * same reason transfers.test.mjs lifts the transfer block.
 *
 *   node lineups.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(HERE, "index.html"), "utf8");

function liftFn(name) {
  const i = HTML.indexOf("function " + name + "(");
  if (i < 0) { console.log("FAIL  cannot find " + name + "() in index.html"); process.exit(1); }
  let depth = 0;
  for (let k = HTML.indexOf("{", i); k < HTML.length; k++) {
    if (HTML[k] === "{") depth++;
    else if (HTML[k] === "}") { depth--; if (!depth) return HTML.slice(i, k + 1); }
  }
  console.log("FAIL  " + name + "() has unbalanced braces");
  process.exit(1);
}
const ctx = { String, Number, Array, Boolean, isFinite };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(["isStarter", "startersOf", "hasFullXI"].map(liftFn).join("\n"), ctx);
const { isStarter, startersOf, hasFullXI } = ctx;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL  " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", wanted " + JSON.stringify(b) + ")");

const P = place => ({ formationPlace: String(place), athlete: { id: "x" } });
const XI = n => ({ roster: Array.from({ length: n }, (_, i) => P(i + 1)) });
const withBench = (starters, bench) => ({
  roster: Array.from({ length: starters }, (_, i) => P(i + 1))
    .concat(Array.from({ length: bench }, () => P(0)))
});
const sum = (a, b) => ({ rosters: b === undefined ? [a] : [a, b] });

console.log("\n1 · who counts as a starter");
{
  eq(isStarter({ starter: true }), true, "an explicit starter flag counts");
  eq(isStarter(P(1)), true, "formationPlace 1 counts");
  eq(isStarter(P(11)), true, "formationPlace 11 counts");
  eq(isStarter(P(0)), false, "formationPlace 0 is the bench");
  eq(isStarter({}), false, "no flag and no place is not a starter");
  eq(isStarter(null), false, "null is not a starter");
  eq(isStarter({ starter: false, formationPlace: "0" }), false, "an explicit non-starter is not one");
}

console.log("\n2 · counting them");
{
  eq(startersOf(XI(11)).length, 11, "eleven starters count as eleven");
  eq(startersOf(withBench(11, 9)).length, 11, "a named bench does not inflate the count");
  eq(startersOf({ roster: [] }).length, 0, "an empty roster has no starters");
  eq(startersOf(null).length, 0, "a missing roster has no starters");
  eq(startersOf({}).length, 0, "a roster-less object has no starters");
}

console.log("\n3 · THE ONE THAT WAS WRONG: is the team sheet actually out");
{
  /* the exact shape ESPN served for Barcelona v Rayo at T-39 */
  const stub = sum(XI(1), XI(1));
  eq(hasFullXI(stub), false, "one keeper per side is NOT a published XI");
  /* and the test it replaced would have said yes, which is the whole bug */
  const oldTest = j => !!((j.rosters || []).some(r => (r.roster || []).length));
  eq(oldTest(stub), true, "the old roster-is-not-empty test accepted that stub (documented, not desired)");
}
{
  eq(hasFullXI(sum(XI(11), XI(11))), true, "eleven a side is a published XI");
  eq(hasFullXI(sum(withBench(11, 9), withBench(11, 12))), true, "and a full sheet with benches still is");
}
{
  eq(hasFullXI(sum(XI(11), XI(1))), false, "one side short is not a published XI");
  eq(hasFullXI(sum(XI(1), XI(11))), false, "either side short, in either order");
  eq(hasFullXI(sum(XI(10), XI(11))), false, "ten is not eleven");
}
{
  eq(hasFullXI(sum(XI(11))), false, "one roster alone is never both teams");
  eq(hasFullXI({ rosters: [] }), false, "no rosters is not a published XI");
  eq(hasFullXI({}), false, "no rosters key at all");
  eq(hasFullXI(null), false, "no summary at all");
}
{
  /* a squad list with nobody flagged: names present, none of them starting */
  eq(hasFullXI(sum(withBench(0, 20), withBench(0, 20))), false,
    "twenty names apiece with no starter among them is not a team sheet");
}

console.log("\n4 · what the cache does with each of those");
{
  /* ensureSummary's rule, in one line: a PRE match keeps re-checking until the XI is real */
  const pending = (state, j) => state === "pre" && !hasFullXI(j);
  eq(pending("pre", sum(XI(1), XI(1))), true, "a stub keeps the pre-match re-check alive");
  eq(pending("pre", sum(XI(11), XI(11))), false, "a real sheet settles it");
  eq(pending("in", sum(XI(1), XI(1))), false, "a live match is governed by its own staleness rule");
  eq(pending("post", sum(XI(1), XI(1))), false, "and so is a finished one");
}

console.log("\n" + "=".repeat(64));
console.log(fail ? "FAILED  " + fail + " of " + (pass + fail)
                 : "PASSED  " + pass + " assertions, 0 failures");
console.log("=".repeat(64) + "\n");
process.exit(fail ? 1 : 0);
