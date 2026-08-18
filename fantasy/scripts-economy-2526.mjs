/* Three squads that isolate the ECONOMY from the strategy: no transfers, no chips, the same
   lineup rule for all. If the cheapest legal fifteen beats the dearest legal fifteen, the
   budget is not a constraint the player has to solve - it is a trap with one right answer. */
import fs from "node:fs";
const H = "C:/Users/User/AppData/Local/Temp/gk-deploy/fantasy/";
const rd = f => JSON.parse(fs.readFileSync(H + f, "utf8"));
const CLUBS = rd("clubs.json").clubs, CAL = rd("calendar.json").gws, M = rd("backtest-2526.json");
const PRICE = new Map(rd("prices.json").clubs.map(p => [String(p.id), p]));
const TIERN = { elite: 1, strong: 2, mid: 3, value: 4, budget: 5 };
const tierN = id => TIERN[(PRICE.get(String(id)) || {}).tier] || 5;
const priceOf = id => (PRICE.get(String(id)) || {}).price || 999;
const lgOf = id => (CLUBS.find(c => String(c.id) === String(id)) || {}).lg;
const nm = id => (CLUBS.find(c => String(c.id) === String(id)) || {}).short || id;
const START = 11, SIZE = 15, BUDGET = 120, CAP = 3;

const DAY = 864e5, ds = ms => new Date(ms).toISOString().slice(0, 10);
const dates = M.map(m => m.date);
let start = Math.min(...dates.map(d => Date.parse(d + "T00:00:00Z")));
while (new Date(start).getUTCDay() !== 4) start -= DAY;
const last = Math.max(...dates.map(d => Date.parse(d + "T00:00:00Z")));
let win = []; for (let t = start; t <= last + DAY; t += 7 * DAY) win.push([t, t + 7 * DAY]);
const cnt = w => dates.reduce((a, d) => { const t = Date.parse(d + "T00:00:00Z"); return a + (t >= w[0] && t < w[1] ? 1 : 0); }, 0);
while (win.length > CAL.length) { let bi = 0, bn = 1e9;
  for (let i = 0; i < win.length - 1; i++) { const n = cnt(win[i]) + cnt(win[i + 1]); if (n < bn) { bn = n; bi = i; } }
  win = win.slice(0, bi).concat([[win[bi][0], win[bi + 1][1]]]).concat(win.slice(bi + 2)); }
const WIN = win.map(w => [ds(w[0]), ds(w[1])]);

const perf = new Map();
for (const m of M) { let gw = -1;
  for (let i = 0; i < WIN.length; i++) if (m.date >= WIN[i][0] && m.date < WIN[i][1]) { gw = i + 1; break; }
  if (gw < 0) continue;
  const add = (me, opp, gf, ga) => { const k = me + "|" + gw; if (!perf.has(k)) perf.set(k, []); perf.get(k).push({ gf, ga, opp }); };
  add(m.h, m.a, m.hg, m.ag); add(m.a, m.h, m.ag, m.hg); }
const POOL = [...new Set([...perf.keys()].map(k => k.split("|")[0]))].filter(id => PRICE.has(id));
function sc(id, gw) { const ms = perf.get(id + "|" + gw); if (!ms) return null; let p = 0;
  for (const m of ms) { const w = m.gf > m.ga, d = m.gf === m.ga;
    p += (w ? 6 : d ? 2 : 0) + (m.ga === 0 ? 3 : 0) + m.gf * 2 - Math.floor(m.ga / 2) + (w ? [0,6,3,0,0,0][tierN(m.opp)] : 0); }
  return p; }
const fc = (id, gw) => (perf.get(id + "|" + gw) || []).length;
function season(sq) { let t = 0;
  for (let gw = 1; gw <= WIN.length; gw++) {
    const order = sq.slice().sort((a, b) => fc(b, gw) - fc(a, gw));
    const cap = order.slice(0, START).filter(id => fc(id, gw)).sort((a, b) => priceOf(b) - priceOf(a))[0] || order[0];
    const used = {}; let bench = order.slice(START);
    for (const id of order.slice(0, START)) { let s = sc(id, gw), who = id;
      if (s === null) { for (const b of bench) { if (used[b]) continue; const bs = sc(b, gw); if (bs === null) continue; used[b] = 1; s = bs; who = b; break; } }
      t += (s || 0) * (id === cap ? 2 : 1); } }
  return t; }
function fill(rank) { const sq = []; const cheapest = POOL.slice().sort((a, b) => priceOf(a) - priceOf(b));
  const ok = (held, id) => { if (held.includes(id)) return false;
    const bl = {}; held.forEach(h => bl[lgOf(h)] = (bl[lgOf(h)] || 0) + 1);
    if ((bl[lgOf(id)] || 0) >= CAP) return false;
    const spend = held.reduce((a, x) => a + priceOf(x), 0);
    const need = SIZE - held.length - 1; const bl2 = { ...bl }; bl2[lgOf(id)] = (bl2[lgOf(id)] || 0) + 1;
    let f = 0, k = 0; for (const c of cheapest) { if (k >= need) break; if (held.includes(c) || c === id) continue;
      if ((bl2[lgOf(c)] || 0) >= CAP) continue; bl2[lgOf(c)] = (bl2[lgOf(c)] || 0) + 1; f += priceOf(c); k++; }
    if (k < need) return false; return spend + priceOf(id) + f <= BUDGET + 1e-9; };
  for (const id of POOL.slice().sort((a, b) => rank(b) - rank(a))) { if (sq.length >= SIZE) break; if (ok(sq, id)) sq.push(id); }
  for (const id of cheapest) { if (sq.length >= SIZE) break; if (ok(sq, id)) sq.push(id); }
  return sq; }

const total = new Map();
for (const id of POOL) { let t = 0; for (let g = 1; g <= WIN.length; g++) t += sc(id, g) || 0; total.set(id, t); }

const tests = [
  ["dearest legal fifteen", fill(id => priceOf(id))],
  ["cheapest legal fifteen", fill(id => -priceOf(id))],
  ["best points per million (hindsight)", fill(id => total.get(id) / priceOf(id))],
  ["most real points (hindsight, perfect)", fill(id => total.get(id))]
];
console.log("no transfers, no chips, same lineup rule — the economy on its own\n");
for (const [label, sq] of tests) {
  const spend = sq.reduce((a, id) => a + priceOf(id), 0);
  console.log(String(season(sq)).padStart(5) + "   " + spend.toFixed(1).padStart(6) + "M   " + label);
  console.log("        " + sq.map(nm).join(", "));
}
