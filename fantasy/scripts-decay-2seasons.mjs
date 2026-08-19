/* A CLUB TURNS UP — BUT DOES IT STAY GOOD?
 *
 * The owner's objection to the availability finding, and it is the right one: a club cannot be
 * injured, but it can collapse. If it does and you never open the app, you hold a club that has
 * stopped scoring for thirty-six rounds. Liverpool is his example.
 *
 * Measured across two full seasons — 2024-25 and 2025-26 — with the scoring live on
 * goallak.com. Per match, so a 34-game league and a 38-game league compare honestly.
 *
 * THE QUESTION THAT DECIDES WHETHER IT MATTERS is not "do clubs collapse" — they plainly do.
 * It is WHEN YOU COULD HAVE KNOWN. A collapse visible by round ten is a decision the game can
 * reward. One that only shows up in May is a tax nobody could have avoided.
 */
import fs from "node:fs";

const H = "C:/Users/User/AppData/Local/Temp/gk-deploy/fantasy/";
const rd = f => JSON.parse(fs.readFileSync(H + f, "utf8"));
const CLUBS = rd("clubs.json").clubs;
const PRICE = new Map(rd("prices.json").clubs.map(p => [String(p.id), p]));
const TIERN = { elite: 1, strong: 2, mid: 3, value: 4, budget: 5 };
const tierN = id => TIERN[(PRICE.get(String(id)) || {}).tier] || 5;
const nm = id => (CLUBS.find(c => String(c.id) === String(id)) || {}).short
              || (CLUBS.find(c => String(c.id) === String(id)) || {}).name || id;
const lgOf = id => (CLUBS.find(c => String(c.id) === String(id)) || {}).lg;

function score(gf, ga, opp) {
  const w = gf > ga, d = gf === ga;
  return (w ? 6 : d ? 2 : 0) + (ga === 0 ? 3 : 0) + gf * 2 - Math.floor(ga / 2)
       + (w ? [0, 6, 3, 0, 0, 0][tierN(opp)] : 0);
}
/* per club: every match in date order, so "the first ten" means the first ten they played */
function seasonOf(file) {
  const rows = rd(file).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const byClub = new Map();
  const add = (me, opp, gf, ga) => {
    if (!byClub.has(me)) byClub.set(me, []);
    byClub.get(me).push(score(gf, ga, opp));
  };
  for (const m of rows) { add(m.h, m.a, m.hg, m.ag); add(m.a, m.h, m.ag, m.hg); }
  return byClub;
}
const A = seasonOf("backtest-2425.json");     /* 2024-25 */
const B = seasonOf("backtest-2526.json");     /* 2025-26 */
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const both = [...A.keys()].filter(id => B.has(id) && PRICE.has(String(id)));

const rows = both.map(id => {
  const a = A.get(id), b = B.get(id);
  return { id, name: nm(id), lg: lgOf(id), price: PRICE.get(String(id)).price,
           was: mean(a), now: mean(b), first10: mean(b.slice(0, 10)), rest: mean(b.slice(10)),
           n: b.length };
}).map(r => ({ ...r, drop: r.now - r.was }));

const show = r => r.name.padEnd(16) + r.was.toFixed(2).padStart(7) + r.now.toFixed(2).padStart(8)
  + (r.drop >= 0 ? "+" : "") + r.drop.toFixed(2).padStart(7)
  + r.first10.toFixed(2).padStart(9) + r.rest.toFixed(2).padStart(8)
  + ("  " + r.price.toFixed(1) + "M").padStart(9);

console.log("=".repeat(78));
console.log("DOES A CLUB STAY GOOD?  points per match, 2024-25 -> 2025-26");
console.log("=".repeat(78));
console.log(both.length + " clubs played both seasons\n");
console.log("club                 24-25   25-26   change   first10    rest    price now");

const lfc = rows.find(r => /liverpool/i.test(r.name));
if (lfc) {
  console.log("\nTHE OWNER'S EXAMPLE");
  console.log("  " + show(lfc));
  const rank = (arr, key) => arr.slice().sort((x, y) => y[key] - x[key]).findIndex(x => x.id === lfc.id) + 1;
  console.log("  rank by points per match:  " + rank(rows, "was") + " of " + rows.length
    + " in 2024-25   ->   " + rank(rows, "now") + " of " + rows.length + " in 2025-26");
  const seasonCost = (lfc.was - lfc.now) * lfc.n;
  console.log("  holding him all of 2025-26 cost " + seasonCost.toFixed(0)
    + " points against his own previous level");
  console.log("  and the warning: first ten rounds " + lfc.first10.toFixed(2)
    + " vs " + lfc.rest.toFixed(2) + " after — " +
    (lfc.first10 < lfc.was - 0.5 ? "IT WAS ALREADY VISIBLE" : "it was NOT yet visible"));
}

console.log("\nTHE TEN BIGGEST COLLAPSES");
for (const r of rows.slice().sort((a, b) => a.drop - b.drop).slice(0, 10)) console.log("  " + show(r));
console.log("\nTHE TEN BIGGEST RISES");
for (const r of rows.slice().sort((a, b) => b.drop - a.drop).slice(0, 10)) console.log("  " + show(r));

/* HOW EARLY COULD YOU TELL? For the clubs that fell hardest, was the first tenth of the season
   already showing it — or did it only appear later, when nothing could be done? */
const fallers = rows.slice().sort((a, b) => a.drop - b.drop).slice(0, 20);
const early = fallers.filter(r => r.first10 < r.was - 0.5).length;
console.log("\n" + "-".repeat(78));
console.log("COULD YOU HAVE KNOWN IN TIME?");
console.log("-".repeat(78));
console.log("  of the 20 biggest collapses, already below their old level after ten rounds: "
  + early + " of 20");
console.log("  mean first-10 vs old level   " + mean(fallers.map(r => r.first10)).toFixed(2)
  + " vs " + mean(fallers.map(r => r.was)).toFixed(2));
console.log("  mean rest-of-season          " + mean(fallers.map(r => r.rest)).toFixed(2));

/* AND IS THE PRICE ALREADY CARRYING IT? Goallak reprices from last season, so a club that
   collapsed in 2025-26 should be cheaper for 2026-27 than one that did not. */
const cor = (xs, ys) => { const k = xs.length, mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < k; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy); };
console.log("\n  price for 2026-27 vs 2025-26 output   r = "
  + cor(rows.map(r => r.price), rows.map(r => r.now)).toFixed(3));
console.log("  price for 2026-27 vs 2024-25 output   r = "
  + cor(rows.map(r => r.price), rows.map(r => r.was)).toFixed(3));
