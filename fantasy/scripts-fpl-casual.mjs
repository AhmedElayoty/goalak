/* IS "SET AND FORGET" AS HARMLESS IN FPL AS IT IS IN GOALLAK?
 *
 * In Goallak, a manager who opened the app ten times in thirty-six rounds finished seven points
 * off the win. The owner asked whether FPL is the same.
 *
 * WHAT CAN AND CANNOT BE MEASURED, up front. bootstrap-static has rolled over to 2026-27 with
 * nothing played, so per-gameweek 2025-26 history is gone from the live API — no auto-subs, no
 * captaincy, no week-by-week simulation. What survives is element-summary -> history_past: one
 * row per player per season with points, minutes and price.
 *
 * That is enough for the question that actually decides it. A manager who never opens the app
 * cannot transfer. So the whole question is: DOES THE SQUAD YOU PICKED IN AUGUST STILL EXIST IN
 * MAY? In Goallak it does — a club cannot pull a hamstring. In FPL that is exactly what breaks.
 *
 * The squad is built with NO HINDSIGHT: 2024-25 points only, at the price FPL actually charged
 * in August 2025, under the real 2-5-5-3 / 100.0m rules. Then it is scored on what happened.
 */
import fs from "node:fs";

const T = "C:/Users/User/AppData/Local/Temp/";
const cur = JSON.parse(fs.readFileSync(T + "fpl-2526.json", "utf8"));
const hist = new Map(JSON.parse(fs.readFileSync(T + "fpl-full-history.json", "utf8")).map(p => [p.id, p]));
const P = cur.map(p => ({ ...p, prev: (hist.get(p.id) || {}).a, prevMins: (hist.get(p.id) || {}).aMins }))
             .filter(p => p.prev != null && p.prevMins != null);

const NEED = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
const BUDGET = 100.0;
const MAXMIN = 38 * 90;

/* the squad an ordinary manager builds in August: best prior season per pound, filled by
   position, then the leftover money spent upgrading. No knowledge of 2025-26 anywhere. */
function pick() {
  const squad = [];
  const have = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  const spend = () => squad.reduce((a, p) => a + p.cost, 0);
  const pool = P.slice().sort((a, b) => (b.prev / b.cost) - (a.prev / a.cost));
  for (const p of pool) {
    if (have[p.pos] >= NEED[p.pos]) continue;
    const left = 15 - squad.length - 1;
    if (spend() + p.cost + left * 4.0 > BUDGET) continue;
    squad.push(p); have[p.pos]++;
    if (squad.length === 15) break;
  }
  /* spend what is left on the best prior-season upgrades — money in the bank scores nothing */
  for (let pass = 0; pass < 60; pass++) {
    const left = BUDGET - spend();
    let best = null;
    for (const out of squad) {
      for (const inn of P) {
        if (squad.includes(inn) || inn.pos !== out.pos) continue;
        if (inn.cost > out.cost + left + 1e-9) continue;
        const gain = inn.prev - out.prev;
        if (gain > 0 && (!best || gain > best.gain)) best = { out, inn, gain };
      }
    }
    if (!best) break;
    squad[squad.indexOf(best.out)] = best.inn;
  }
  return squad;
}

const squad = pick();
const spend = squad.reduce((a, p) => a + p.cost, 0);
const pct = n => (n * 100).toFixed(0) + "%";

console.log("=".repeat(76));
console.log("THE FPL SQUAD YOU WOULD HAVE PICKED IN AUGUST 2025 — and what became of it");
console.log("=".repeat(76));
console.log(P.length + " players with both seasons · " + spend.toFixed(1) + "m of " + BUDGET.toFixed(1) + "m\n");
console.log("  pos  player            price   24-25 pts   25-26 pts    minutes played");
for (const p of squad.slice().sort((a, b) => b.prev - a.prev)) {
  const share = p.mins / MAXMIN;
  console.log("  " + p.pos.padEnd(4) + " " + p.name.padEnd(18) + (p.cost.toFixed(1) + "m").padStart(6)
    + String(p.prev).padStart(11) + String(p.pts).padStart(12)
    + ("  " + pct(share)).padStart(16) + (share < 0.5 ? "   <-- gone" : ""));
}

const dead = squad.filter(p => p.mins < MAXMIN * 0.5);
const halfDead = squad.filter(p => p.mins < MAXMIN * 0.75);
const totalPrev = squad.reduce((a, p) => a + p.prev, 0);
const totalNow = squad.reduce((a, p) => a + p.pts, 0);

console.log("\n" + "-".repeat(76));
console.log("WHAT A MANAGER WHO NEVER OPENED THE APP WAS LEFT HOLDING");
console.log("-".repeat(76));
console.log("  the squad scored the season before   " + totalPrev + " pts");
console.log("  the same fifteen, the season after   " + totalNow + " pts   ("
  + ((totalNow / totalPrev - 1) * 100).toFixed(1) + "%)");
console.log("  played under HALF the minutes        " + dead.length + " of 15   "
  + dead.map(p => p.name).join(", "));
console.log("  played under three quarters          " + halfDead.length + " of 15");
console.log("  mean share of available minutes      "
  + pct(squad.reduce((a, p) => a + p.mins / MAXMIN, 0) / 15));

/* the Goallak comparison, on the same measure: does an asset you bought still turn out? */
const G = JSON.parse(fs.readFileSync(T + "gk-deploy/fantasy/backtest-2526.json", "utf8"));
const played = new Map();
for (const m of G) { played.set(m.h, (played.get(m.h) || 0) + 1); played.set(m.a, (played.get(m.a) || 0) + 1); }
const clubs = [...played.values()];
const meanClub = clubs.reduce((a, b) => a + b, 0) / clubs.length;
console.log("\n" + "-".repeat(76));
console.log("THE SAME QUESTION, ASKED OF A GOALLAK CLUB");
console.log("-".repeat(76));
console.log("  clubs measured                       " + clubs.length);
console.log("  mean league matches played           " + meanClub.toFixed(1));
console.log("  clubs that played under half a season " + clubs.filter(n => n < meanClub * 0.5).length);
console.log("\n  An FPL asset is a person who can be dropped, injured or sold.");
console.log("  A Goallak asset is a club, and a club turns up every week whatever happens.");
