/* IF A CLUB COLLAPSES AND YOU CAN SEE IT BY ROUND TEN, IS MOVING WORTH THE -4?
 *
 * The owner's objection stands on its own: a club turns up every week, but it can stop being
 * good, and holding it costs. Liverpool fell 10.29 -> 7.03 points per match and 124 points
 * across the season. So the availability finding was true and incomplete.
 *
 * This measures the decision that follows. At the round-10 deadline, using ONLY the first ten
 * rounds — which is all a real manager has — sell any club whose form has fallen well short of
 * what its price says it should be, buy the best available replacement on the same evidence,
 * and pay the -4. Then score the remaining 26 rounds both ways.
 *
 * The comparison is deliberately against MY OWN earlier finding that chasing five-round form
 * costs 105 points a season. If ten-round evidence pays where five-round evidence does not,
 * those are two different things and the app is currently showing the wrong one.
 */
import fs from "node:fs";
const H = "C:/Users/User/AppData/Local/Temp/gk-deploy/fantasy/";
const rd = f => JSON.parse(fs.readFileSync(H + f, "utf8"));
const CLUBS = rd("clubs.json").clubs;
const PRICE = new Map(rd("prices.json").clubs.map(p => [String(p.id), p]));
const TIERN = { elite: 1, strong: 2, mid: 3, value: 4, budget: 5 };
const tierN = id => TIERN[(PRICE.get(String(id)) || {}).tier] || 5;
const nm = id => (CLUBS.find(c => String(c.id) === String(id)) || {}).short || id;
const priceOf = id => (PRICE.get(String(id)) || {}).price || 999;
const lgOf = id => (CLUBS.find(c => String(c.id) === String(id)) || {}).lg;
const HIT = 4, MAXLG = 3;

const sc = (gf, ga, opp) => { const w = gf > ga, d = gf === ga;
  return (w ? 6 : d ? 2 : 0) + (ga === 0 ? 3 : 0) + gf * 2 - Math.floor(ga / 2)
       + (w ? [0, 6, 3, 0, 0, 0][tierN(opp)] : 0); };
const rows = rd("backtest-2526.json").slice().sort((a, b) => (a.date < b.date ? -1 : 1));
const byClub = new Map();
for (const m of rows) {
  const add = (me, opp, gf, ga) => { if (!byClub.has(me)) byClub.set(me, []); byClub.get(me).push(sc(gf, ga, opp)); };
  add(m.h, m.a, m.hg, m.ag); add(m.a, m.h, m.ag, m.hg);
}
const POOL = [...byClub.keys()].filter(id => PRICE.has(String(id)) && byClub.get(id).length >= 30);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const first10 = id => mean(byClub.get(id).slice(0, 10));
const rest = id => mean(byClub.get(id).slice(10));
const restN = id => byClub.get(id).slice(10).length;

/* what a club's PRICE says it should be scoring — the only "expected" a manager actually has */
const xs = POOL.map(priceOf), ys = POOL.map(id => mean(byClub.get(id)));
const mx = mean(xs), my = mean(ys);
let sxy = 0, sxx = 0;
for (let i = 0; i < POOL.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
const slope = sxy / sxx, intercept = my - slope * mx;
const expected = id => intercept + slope * priceOf(id);

console.log("=".repeat(74));
console.log("REACTING TO A COLLAPSE AT ROUND 10 — is it worth the -4?");
console.log("=".repeat(74));
console.log(POOL.length + " clubs · a club priced at P is expected to score "
  + intercept.toFixed(2) + " + " + slope.toFixed(2) + "P per match\n");

/* the decision, made on the first ten rounds only */
const SHORTFALL = 1.5;
const flagged = POOL.filter(id => first10(id) < expected(id) - SHORTFALL)
  .sort((a, b) => (first10(a) - expected(a)) - (first10(b) - expected(b)));
console.log("clubs whose first ten rounds fell " + SHORTFALL + "+ short of their price: " + flagged.length);
console.log("\nclub              price   expected   first10    REST    verdict");
let gain = 0, moved = 0, right = 0;
for (const id of flagged.slice(0, 14)) {
  /* the replacement a manager could actually buy: similar money, best first-ten evidence */
  const cand = POOL.filter(c => c !== id && priceOf(c) <= priceOf(id) + 0.5 && lgOf(c) !== lgOf(id))
    .sort((a, b) => first10(b) - first10(a))[0];
  if (!cand) continue;
  const held = rest(id) * restN(id);
  const swapped = rest(cand) * restN(id) - HIT;
  const delta = swapped - held;
  gain += delta; moved++; if (delta > 0) right++;
  console.log("  " + nm(id).padEnd(15) + priceOf(id).toFixed(1).padStart(5) + "M"
    + expected(id).toFixed(2).padStart(10) + first10(id).toFixed(2).padStart(10)
    + rest(id).toFixed(2).padStart(8)
    + ("  -> " + nm(cand) + " " + (delta >= 0 ? "+" : "") + delta.toFixed(0)).padStart(24));
}
console.log("\n" + "-".repeat(74));
console.log("  moves made                " + moved);
console.log("  moves that paid off       " + right + " of " + moved
  + "  (" + (right / moved * 100).toFixed(0) + "%)");
console.log("  total swing over 26 rounds " + (gain >= 0 ? "+" : "") + gain.toFixed(0)
  + " points, after paying " + (moved * HIT) + " in hits");
console.log("  average per move          " + (gain / moved).toFixed(1) + " points");

console.log("\n" + "-".repeat(74));
console.log("AND THE COMPARISON THAT MATTERS");
console.log("-".repeat(74));
/* how well does each window predict what comes next? */
const corr = (a, b) => { const k = a.length, ma = mean(a), mb = mean(b);
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < k; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; sa += x * x; sb += y * y; }
  return s / Math.sqrt(sa * sb); };
for (const w of [3, 5, 10, 15]) {
  const f = POOL.map(id => mean(byClub.get(id).slice(0, w)));
  const r = POOL.map(id => mean(byClub.get(id).slice(w)));
  console.log("  form over the first " + String(w).padStart(2) + " rounds predicts the rest at r = "
    + corr(f, r).toFixed(3));
}
console.log("  price alone predicts the rest at        r = "
  + corr(POOL.map(priceOf), POOL.map(id => mean(byClub.get(id).slice(10)))).toFixed(3));
