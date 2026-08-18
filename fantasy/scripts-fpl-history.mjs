/* What happened to FPL assets last season, measured rather than asserted.
   bootstrap-static has rolled over to 2026-27 with nothing played, so per-gameweek history for
   2025-26 is gone from the live API. element-summary still carries `history_past`: one row per
   past season per player, with minutes and points. Minutes are the number that matters here —
   they say how often your asset actually turned up, which is the whole reason FPL managers
   transfer. */
import fs from "node:fs";
const j = JSON.parse(fs.readFileSync("fpl.json", "utf8"));
const POS = Object.fromEntries(j.element_types.map(t => [t.id, t.singular_name_short]));
const els = j.elements;
const out = [];
let done = 0;
const q = els.slice();
async function work() {
  while (q.length) {
    const e = q.pop();
    const s = await fetch(`https://fantasy.premierleague.com/api/element-summary/${e.id}/`,
      { headers: { "User-Agent": "Mozilla/5.0" } }).then(r => r.json()).catch(() => null);
    const past = (s?.history_past || []).find(h => h.season_name === "2025/26");
    if (past) out.push({ id: e.id, name: e.web_name, pos: POS[e.element_type],
                         cost: past.start_cost / 10, endCost: past.end_cost / 10,
                         pts: past.total_points, mins: past.minutes });
    if (++done % 50 === 0) process.stderr.write(`\r${done}/${els.length}`);
  }
}
await Promise.all(Array.from({ length: 16 }, work));
process.stderr.write("\n");
fs.writeFileSync("fpl-2526.json", JSON.stringify(out));
console.log(out.length + " players with a 2025-26 Premier League season");
