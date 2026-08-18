/* EVERY SLUG THE APP ASKS FOR MUST BE A REAL FEED.
 * A slug that does not exist is not harmless: it 400s on every round, for every user, and
 * fills the console with errors that hide real ones. `tur.cup` was invented from the pattern
 * of the other cup slugs and shipped as far as the browser before this caught it.
 * Needs the network, so it is not part of the pre-commit gate. Run it whenever the list changes:
 *   node scripts-verify-feeds.mjs
 */
import fs from "node:fs";
const all = JSON.parse(fs.readFileSync(new URL("./clubs.json", import.meta.url), "utf8"))
  .leagues.map(l => l.slug);
const B = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
const bad = [];
for (const sl of all) {
  const r = await fetch(`${B}${sl}/scoreboard?dates=20251201-20251231&limit=10`).catch(() => null);
  if (!r || !r.ok) bad.push(sl + " → " + (r ? r.status : "unreachable"));
}
console.log(`${all.length} feeds checked · ${all.length - bad.length} live`);
if (bad.length) { bad.forEach(b => console.log("  DEAD  " + b)); process.exit(1); }
console.log("every slug the app asks for is a real feed");
