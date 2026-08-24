/* THE PORTED KNOCKOUT SCORER, EXERCISED ON THE CASES THAT DEFINE IT.
   The function is extracted verbatim from the deployed index.html so the thing tested is the
   thing shipped. Rules under test are the World Cup app's, which carried a full tournament. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.html"), "utf-8");
const m = html.match(/function scorePredGk\(pred, e\)\{[\s\S]*?\n\}/);
if (!m) { console.log("FAILED  could not extract scorePredGk"); process.exit(1); }
const scorePredGk = new Function("return " + m[0])();

const ev = (h, a, sh, sa) => ({ competitions: [{ competitors: [
  { homeAway: "home", score: String(h), shootoutScore: sh },
  { homeAway: "away", score: String(a), shootoutScore: sa }
]}]});

let pass = 0, fail = 0;
const eq = (got, want, msg) => { if (got === want) pass++; else { fail++; console.log("  FAIL  " + msg + "  (got " + got + ", wanted " + want + ")"); } };

/* league phase - unchanged behaviour */
eq(scorePredGk({h:2,a:1}, ev(2,1)), 3, "exact score pays 3");
eq(scorePredGk({h:3,a:0}, ev(2,1)), 1, "right outcome pays 1");
eq(scorePredGk({h:1,a:1}, ev(2,2)), 1, "a predicted draw on a real draw pays 1");
eq(scorePredGk({h:0,a:2}, ev(2,1)), 0, "wrong outcome pays 0");
eq(scorePredGk({h:2,a:1}, ev("", "")), 0, "no score yet pays nothing");

/* knockout - the WC rules */
eq(scorePredGk({h:1,a:1}, ev(1,1,4,2)), 0, "exact DENIED when it went to pens - the pick did not predict that");
eq(scorePredGk({h:2,a:1}, ev(1,1,4,2)), 1, "pens: home won the shootout, home pick pays the outcome point");
eq(scorePredGk({h:0,a:1}, ev(1,1,2,4)), 1, "pens: away won the shootout, away pick pays");
eq(scorePredGk({h:2,a:1}, ev(1,1,2,4)), 0, "pens: away won, home pick pays nothing");
eq(scorePredGk({h:1,a:1}, ev(1,1)), 3, "a first-leg draw with NO shootout is still exact");
eq(scorePredGk({h:2,a:2}, ev(1,1)), 1, "and a different draw pick still pays the outcome");
eq(scorePredGk({h:2,a:1}, ev(2,1,0,0)), 3, "zero-zero shootout fields mean no shootout (ESPN quirk)");

console.log(fail ? "FAILED  " + fail + " of " + (pass + fail) : "PASSED  " + pass + " assertions, 0 failures");
process.exit(fail ? 1 : 0);
