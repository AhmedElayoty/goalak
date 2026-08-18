/* Pull every 2025-26 league match for the seven leagues Goallak plays, and cache it.
 * League matches only — the owner's rule, so the backtest obeys it too.
 *   node scripts-fetch-2526.mjs
 */
import fs from "node:fs";

const OUT = new URL("./backtest-2526.json", import.meta.url);
const LEAGUES = JSON.parse(fs.readFileSync(new URL("./clubs.json", import.meta.url), "utf8")).leagues;
const B = "https://site.api.espn.com/apis/site/v2/sports/soccer/";

/* month by month: a whole-season range silently truncates at limit=300 for a busy league */
const months = [];
for (let y = 2025, m = 7; !(y === 2026 && m > 7); m++) {
  if (m > 12) { m = 1; y++; }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const p = String(m).padStart(2, "0");
  months.push(`${y}${p}01-${y}${p}${last}`);
}

const rows = [];
const seen = new Set();
for (const lg of LEAGUES) {
  for (const range of months) {
    const j = await fetch(`${B}${lg.slug}/scoreboard?dates=${range}&limit=300`)
      .then(r => r.json()).catch(() => null);
    for (const e of (j?.events || [])) {
      if (seen.has(e.id)) continue;
      const c = e.competitions?.[0];
      if (!c || c.status?.type?.completed !== true) continue;   /* only played matches */
      const cs = c.competitors || [];
      if (cs.length !== 2) continue;
      const home = cs.find(x => x.homeAway === "home"), away = cs.find(x => x.homeAway === "away");
      if (!home || !away) continue;
      seen.add(e.id);
      rows.push({
        id: e.id, date: String(e.date).slice(0, 10), lg: lg.id,
        h: String(home.id), a: String(away.id),
        hg: Number(home.score), ag: Number(away.score)
      });
    }
    process.stderr.write(`\r${lg.slug} ${range}  ${rows.length} matches`);
  }
}
process.stderr.write("\n");
fs.writeFileSync(OUT, JSON.stringify(rows));
const byLg = {};
for (const r of rows) byLg[r.lg] = (byLg[r.lg] || 0) + 1;
console.log(rows.length + " completed 2025-26 league matches cached");
for (const [k, v] of Object.entries(byLg)) console.log("  " + k.padEnd(8), v);
