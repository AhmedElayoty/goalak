/* THE BEST FIFTEEN OF 2025-26 — including a forced pair, if you name one.
 *
 * This is hindsight on purpose. Everywhere else in this repo a strategy is forbidden from
 * reading a result it could not have known; here the whole question is "what WAS the best
 * squad", so the season is allowed to be known. It is a ceiling, not a strategy.
 *
 * TWO NUMBERS, AND THEY ARE NOT THE SAME THING:
 *   perfect   the best eleven and the best captain every round, chosen with hindsight. The
 *             true ceiling of a squad, and nobody will ever score it.
 *   realistic the same fifteen played the way the app actually guides you — start whoever
 *             plays (the round band), captain your strongest available club, no transfers.
 *             This is what a good manager who owned this squad would really have scored.
 *
 * HOW IT SOLVES. The objective is not separable — only eleven of fifteen score, so a club's
 * worth depends on the other fourteen. So: an exact DP over leagues on total season points
 * gives a strong legal start (Pareto-pruned subsets per league, ≤3 each, exact to the 0.1M),
 * then hill-climbing on the TRUE objective until no single swap improves it. Restarted from
 * several different seeds and from random legal squads; if they all land on the same total,
 * that is the optimum for practical purposes.
 *
 *   node scripts-optimum-2526.mjs                  the unconstrained best fifteen
 *   FORCE=83,997 node scripts-optimum-2526.mjs     ...that must contain Barcelona + Trabzonspor
 */
import fs from "node:fs";

const U = f => new URL("./" + f, import.meta.url);
const CAL = JSON.parse(fs.readFileSync(U("calendar.json"), "utf8")).gws;
const DATA = JSON.parse(fs.readFileSync(U("clubs.json"), "utf8"));
const CLUBS = DATA.clubs, LEAGUES = DATA.leagues;
const PRICE = new Map(JSON.parse(fs.readFileSync(U("prices.json"), "utf8")).clubs.map(p => [String(p.id), p]));
const MATCHES = JSON.parse(fs.readFileSync(U("backtest-2526.json"), "utf8"));

const SRC = fs.readFileSync(U("index.html"), "utf8");
const K = (re, d) => { const m = SRC.match(re); return m ? Number(m[1]) : d; };
const START = K(/const START_SIZE = (\d+)/, 11);
const SIZE = START + K(/START_SIZE = \d+, BENCH_SIZE = (\d+)/, 4);
const BUDGET = K(/const BUDGET = ([\d.]+)/, 120);
const MAXLG = K(/MAX_PER_LEAGUE = (\d+)/, 3);

const byId = new Map(CLUBS.map(c => [String(c.id), c]));
const priceOf = id => (PRICE.get(String(id)) || {}).price || 999;
const strOf = id => (PRICE.get(String(id)) || {}).str || 0.4;
const TIERN = { elite: 1, strong: 2, mid: 3, value: 4, budget: 5 };
const tierN = id => TIERN[(PRICE.get(String(id)) || {}).tier] || 5;
const nm = id => (byId.get(String(id)) || {}).short || (byId.get(String(id)) || {}).name || id;
const arOf = id => (byId.get(String(id)) || {}).ar || nm(id);
const lgOf = id => (byId.get(String(id)) || {}).lg;
const lgName = l => (LEAGUES.find(x => x.id === l) || {}).en || l;

/* the same 36 windows every other study here uses, rebuilt from 2025-26's own season */
const DAY = 864e5, ds = ms => new Date(ms).toISOString().slice(0, 10);
const dts = MATCHES.map(m => m.date);
let st = Math.min(...dts.map(d => Date.parse(d + "T00:00:00Z")));
while (new Date(st).getUTCDay() !== 4) st -= DAY;
const last = Math.max(...dts.map(d => Date.parse(d + "T00:00:00Z")));
let w = []; for (let t = st; t <= last + DAY; t += 7 * DAY) w.push([t, t + 7 * DAY]);
const cnt = x => dts.reduce((a, d) => { const t = Date.parse(d + "T00:00:00Z"); return a + (t >= x[0] && t < x[1] ? 1 : 0); }, 0);
while (w.length > CAL.length) { let bi = 0, bn = Infinity;
  for (let i = 0; i < w.length - 1; i++) { const n = cnt(w[i]) + cnt(w[i + 1]); if (n < bn) { bn = n; bi = i; } }
  w = w.slice(0, bi).concat([[w[bi][0], w[bi + 1][1]]]).concat(w.slice(bi + 2)); }
const WIN = w.map(x => [ds(x[0]), ds(x[1])]), GWS = WIN.length;

const perf = new Map();
for (const m of MATCHES) { let g = -1;
  for (let i = 0; i < GWS; i++) if (m.date >= WIN[i][0] && m.date < WIN[i][1]) { g = i + 1; break; }
  if (g < 0) continue;
  const add = (me, opp, gf, ga) => { const k = me + "|" + g; if (!perf.has(k)) perf.set(k, []); perf.get(k).push({ gf, ga, opp }); };
  add(m.h, m.a, m.hg, m.ag); add(m.a, m.h, m.ag, m.hg); }
const POOL = [...new Set([...perf.keys()].map(k => k.split("|")[0]))].filter(id => PRICE.has(id));

function scoreClub(id, gw) {
  const ms = perf.get(id + "|" + gw); if (!ms) return null;
  let p = 0;
  for (const m of ms) { const W = m.gf > m.ga, D = m.gf === m.ga;
    p += (W ? 6 : D ? 2 : 0) + (m.ga === 0 ? 3 : 0) + m.gf * 2 - Math.floor(m.ga / 2)
       + (W ? [0, 6, 3, 0, 0, 0][tierN(m.opp)] : 0); }
  return p;
}
const fc = (id, gw) => (perf.get(id + "|" + gw) || []).length;
const season = new Map(POOL.map(id => {
  let t = 0, n = 0;
  for (let g = 1; g <= GWS; g++) { const s = scoreClub(id, g); if (s !== null) { t += s; n++; } }
  return [id, { pts: t, played: n }];
}));

/* ---------- the two objectives ---------- */
function perfect(sq) {                        /* best XI + best captain, every round */
  let total = 0;
  for (let g = 1; g <= GWS; g++) {
    const ss = sq.map(id => scoreClub(id, g)).filter(s => s !== null).sort((a, b) => b - a);
    const xi = ss.slice(0, START);
    total += xi.reduce((a, b) => a + b, 0) + (xi.length ? xi[0] : 0);   /* captain doubles */
  }
  return total;
}
function realistic(sq) {                      /* as the app guides you: fixtures first, then quality */
  let total = 0;
  for (let g = 1; g <= GWS; g++) {
    const ord = sq.slice().sort((a, b) => (fc(b, g) - fc(a, g)) || (strOf(b) - strOf(a)));
    const xi = ord.slice(0, START), bench = ord.slice(START);
    const cap = xi.filter(id => fc(id, g) > 0).sort((a, b) => strOf(b) - strOf(a))[0] || xi[0];
    const used = {};
    for (const id of xi) {
      let s = scoreClub(id, g);
      if (s === null) { let got = null;
        for (const b of bench) { if (used[b]) continue; const bs = scoreClub(b, g); if (bs === null) continue; used[b] = 1; got = bs; break; }
        s = got === null || got === undefined ? 0 : got; }
      total += s * (id === cap ? 2 : 1);
    }
  }
  return total;
}

/* ---------- legality ---------- */
const cheap = POOL.slice().sort((a, b) => priceOf(a) - priceOf(b));
function legal(sq) {
  if (sq.length !== SIZE) return false;
  if (new Set(sq).size !== sq.length) return false;
  if (sq.reduce((a, id) => a + priceOf(id), 0) > BUDGET + 1e-9) return false;
  const bl = {};
  for (const id of sq) { const l = lgOf(id); bl[l] = (bl[l] || 0) + 1; if (bl[l] > MAXLG) return false; }
  return true;
}

/* ---------- exact DP for a strong legal start: max total season points ----------
   Per league, every subset of size 0..MAXLG, Pareto-pruned on (cost, points); then a DP
   across the seven leagues over (clubs so far, cost so far). Exact for THAT objective. */
const FORCE = (process.env.FORCE || "").split(",").map(s => s.trim()).filter(Boolean);
for (const f of FORCE) if (!POOL.includes(f)) { console.log("forced club " + f + " did not play in 2025-26"); process.exit(1); }
const cents = p => Math.round(p * 10);
const CAP = cents(BUDGET);

function dpBest() {
  const perLg = [];
  for (const lg of LEAGUES.map(l => l.id)) {
    const ids = POOL.filter(id => lgOf(id) === lg).sort((a, b) => season.get(b).pts - season.get(a).pts);
    const forced = FORCE.filter(f => lgOf(f) === lg);
    const subs = [];
    const rec = (start, cur) => {
      if (cur.length <= MAXLG) {
        if (forced.every(f => cur.includes(f))) {
          subs.push({ ids: cur.slice(), cost: cur.reduce((a, id) => a + cents(priceOf(id)), 0),
                      pts: cur.reduce((a, id) => a + season.get(id).pts, 0) });
        }
      }
      if (cur.length === MAXLG) return;
      for (let i = start; i < ids.length; i++) { cur.push(ids[i]); rec(i + 1, cur); cur.pop(); }
    };
    rec(0, []);
    /* Pareto front per size: cheaper AND better wins */
    const front = [];
    for (let k = 0; k <= MAXLG; k++) {
      const same = subs.filter(s => s.ids.length === k).sort((a, b) => a.cost - b.cost || b.pts - a.pts);
      let best = -Infinity;
      for (const s of same) if (s.pts > best) { best = s.pts; front.push(s); }
    }
    perLg.push(front);
  }
  let cur = new Map([["0|0", { pts: 0, pick: [] }]]);
  for (const front of perLg) {
    const nxt = new Map();
    for (const [key, st0] of cur) {
      const [n0, c0] = key.split("|").map(Number);
      for (const s of front) {
        const n = n0 + s.ids.length, c = c0 + s.cost;
        if (n > SIZE || c > CAP) continue;
        const k = n + "|" + c, prev = nxt.get(k);
        if (!prev || prev.pts < st0.pts + s.pts) nxt.set(k, { pts: st0.pts + s.pts, pick: st0.pick.concat(s.ids) });
      }
    }
    cur = nxt;
  }
  let best = null;
  for (const [key, st0] of cur) { const [n] = key.split("|").map(Number);
    if (n === SIZE && (!best || st0.pts > best.pts)) best = st0; }
  return best ? best.pick : null;
}

/* ---------- hill-climb on the TRUE objective ---------- */
function climb(sq, obj) {
  let cur = sq.slice(), curV = obj(cur), moved = true, guard = 0;
  while (moved && guard++ < 60) {
    moved = false;
    for (let i = 0; i < cur.length; i++) {
      for (const inn of POOL) {
        if (cur.includes(inn)) continue;
        const nx = cur.slice(); nx[i] = inn;
        if (FORCE.some(f => !nx.includes(f))) continue;
        if (!legal(nx)) continue;
        const v = obj(nx);
        if (v > curV + 1e-9) { cur = nx; curV = v; moved = true; }
      }
    }
  }
  return { sq: cur, val: curV };
}
function randomLegal() {
  for (let tries = 0; tries < 4000; tries++) {
    const sq = FORCE.slice();
    const pool = POOL.slice().sort(() => Math.random() - 0.5);
    for (const id of pool) { if (sq.length >= SIZE) break; if (sq.includes(id)) continue;
      const nx = sq.concat([id]);
      const bl = {}; let ok = true;
      for (const x of nx) { const l = lgOf(x); bl[l] = (bl[l] || 0) + 1; if (bl[l] > MAXLG) ok = false; }
      if (!ok) continue;
      if (nx.reduce((a, x) => a + priceOf(x), 0) > BUDGET + 1e-9) continue;
      sq.push(id); }
    if (legal(sq)) return sq;
  }
  return null;
}

/* ---------- solve ---------- */
/* SINGLE SWAPS GET STUCK. One club at a time cannot cross a budget wall that only opens if
   you sell two and buy two, so a first pass converged 1 time in 7 and the six near-misses were
   all local maxima. Many restarts, then a PAIR pass on the leader: every (out,out)x(in,in) it
   can afford. That is ~10^6 evaluations of a 36-round objective, which is seconds, and it is
   the difference between "a very good fifteen" and "the best one". */
const seeds = [];
const dp = dpBest(); if (dp) seeds.push(dp);
for (let i = 0; i < 24; i++) { const r = randomLegal(); if (r) seeds.push(r); }
let best = null;
const converged = [];
for (const s of seeds) { const r = climb(s, perfect); converged.push(r.val); if (!best || r.val > best.val) best = r; }
function pairPolish(startSq, obj) {
  let cur = startSq.slice(), curV = obj(cur), moved = true, guard = 0;
  while (moved && guard++ < 12) {
    moved = false;
    for (let i = 0; i < cur.length && !moved; i++) {
      for (let j = i + 1; j < cur.length && !moved; j++) {
        if (FORCE.includes(cur[i]) || FORCE.includes(cur[j])) continue;
        const rest = cur.filter((_, k) => k !== i && k !== j);
        const room = BUDGET - rest.reduce((a, id) => a + priceOf(id), 0);
        const cands = POOL.filter(id => !rest.includes(id) && priceOf(id) <= room);
        for (let a2 = 0; a2 < cands.length && !moved; a2++) {
          for (let b2 = a2 + 1; b2 < cands.length; b2++) {
            const nx = rest.concat([cands[a2], cands[b2]]);
            if (!legal(nx)) continue;
            const v = obj(nx);
            if (v > curV + 1e-9) { cur = nx; curV = v; moved = true; break; }
          }
        }
      }
    }
    if (moved) { const c = climb(cur, obj); cur = c.sq; curV = c.val; }
  }
  return { sq: cur, val: curV };
}
/* Polish the best FIVE basins, not just the leader. A pair pass can lift a mid-table start
   above a good one, so "the leader after single swaps" is not necessarily the right basin —
   and if five independent starts all finish on the same total, that is the evidence. */
const tops = seeds.map(s => climb(s, perfect)).sort((a, b) => b.val - a.val).slice(0, 5);
const polished = tops.map(t => pairPolish(t.sq, perfect));
best = polished.slice().sort((a, b) => b.val - a.val)[0];
const agree = polished.filter(p => p.val === best.val).length;

const sq = best.sq.slice().sort((a, b) => season.get(b).pts - season.get(a).pts);
const spend = sq.reduce((a, id) => a + priceOf(id), 0);
const lgs = {}; sq.forEach(id => lgs[lgOf(id)] = (lgs[lgOf(id)] || 0) + 1);

console.log("=".repeat(78));
console.log("THE BEST FIFTEEN OF 2025-26" + (FORCE.length ? "  ·  forced: " + FORCE.map(nm).join(" + ") : "  ·  unconstrained"));
console.log("=".repeat(78));
console.log(MATCHES.length + " matches · " + POOL.length + " clubs · " + GWS + " rounds · "
  + START + "+" + (SIZE - START) + " · " + BUDGET + "M · max " + MAXLG + " per league\n");
console.log("  #  club                 league            price     season pts   played");
sq.forEach((id, i) => {
  const s = season.get(id);
  console.log("  " + String(i + 1).padStart(2) + "  " + nm(id).padEnd(20) + lgName(lgOf(id)).padEnd(18)
    + (priceOf(id).toFixed(1) + "M").padStart(7) + String(s.pts).padStart(13) + String(s.played).padStart(9)
    + (FORCE.includes(id) ? "   ← forced" : ""));
});
console.log("\n  spend            " + spend.toFixed(1) + "M of " + BUDGET.toFixed(1) + "M   ("
  + (BUDGET - spend).toFixed(1) + "M unspent)");
console.log("  leagues          " + Object.entries(lgs).map(([l, n]) => n + " " + lgName(l)).join(", "));
console.log("  raw club total   " + sq.reduce((a, id) => a + season.get(id).pts, 0) + " pts across all fifteen");
console.log("\n  PERFECT   " + best.val + " pts   best eleven + best captain every round (the ceiling)");
console.log("  REALISTIC " + realistic(sq) + " pts   played the way the app guides you, no transfers");
console.log("\n  search    " + seeds.length + " random starts; the best five basins pair-polished to "
  + [...new Set(polished.map(p => p.val))].sort((a, b) => b - a).join(", ")
  + "   (" + agree + " of 5 agree on " + best.val + ")");
