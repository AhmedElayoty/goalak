/* FIVE MANAGERS, FIVE WAYS OF BEING A PERSON, ONE REAL SEASON.
 *
 * The 2,286 completed league matches of 2025-26, the scoring live on goallak.com, the transfer
 * economy from v6.9 and the onboarding from v6.14. League matches only, on the owner's rule.
 *
 * WHAT THIS RUN FIXES ABOUT THE LAST ONE. The three-manager playtest sorted every squad by who
 * actually plays, every round, for everybody — so all three had flawless team selection handed
 * to them free, the auto-substitute never once fired, and the bench and the blanks could not
 * matter. That is not five different people, it is one person with five shopping lists.
 *
 * Here, HOW YOU MANAGE is part of who you are. The optimiser reads the fixture list. The
 * loyalist picks by badge. The casual only opens the app every fourth round and whatever XI he
 * left behind is the XI that plays. That is where blanks, the bench and the round band stop
 * being decoration and start costing points.
 *
 * THE RULE THAT MAKES IT WORTH ANYTHING, unchanged: no decision may read a result that had not
 * happened yet. The fixture list is fair game — it is public months ahead and every real player
 * has it. A scoreline from an unplayed round is not.
 *
 *   node scripts-playtest5-2526.mjs
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
const START_SIZE = K(/const START_SIZE = (\d+)/, 11);
const SQUAD_SIZE = START_SIZE + K(/START_SIZE = \d+, BENCH_SIZE = (\d+)/, 4);
const BUDGET = K(/const BUDGET = ([\d.]+)/, 120);
const MAX_PER_LEAGUE = K(/MAX_PER_LEAGUE = (\d+)/, 3);
const FT_MAX = K(/const FT_MAX = (\d+)/, 5);
const HIT_COST = K(/FT_MAX = \d+, HIT_COST = (\d+)/, 4);

const byId = new Map(CLUBS.map(c => [String(c.id), c]));
const priceOf = id => (PRICE.get(String(id)) || {}).price || 999;
const strOf = id => (PRICE.get(String(id)) || {}).str || 0.4;
const TIERN = { elite: 1, strong: 2, mid: 3, value: 4, budget: 5 };
const tierN = id => TIERN[(PRICE.get(String(id)) || {}).tier] || 5;
const nameOf = id => (byId.get(String(id)) || {}).short || (byId.get(String(id)) || {}).name || id;
const lgOf = id => (byId.get(String(id)) || {}).lg;
const lgName = l => (LEAGUES.find(x => x.id === l) || {}).en || l;

/* ---------------------------------------------------------------- the 36 windows
   Built from 2025-26's own season, not by shifting the live calendar — that put round 3 on an
   international break with all 108 clubs idle. Thursday-to-Wednesday weeks so a weekend never
   splits; quietest adjacent pair merged until 36 remain. */
const DAY = 864e5, ds = ms => new Date(ms).toISOString().slice(0, 10);
const dates = MATCHES.map(m => m.date);
let st0 = Math.min(...dates.map(d => Date.parse(d + "T00:00:00Z")));
while (new Date(st0).getUTCDay() !== 4) st0 -= DAY;
const lastD = Math.max(...dates.map(d => Date.parse(d + "T00:00:00Z")));
let win = []; for (let t = st0; t <= lastD + DAY; t += 7 * DAY) win.push([t, t + 7 * DAY]);
const cnt = w => dates.reduce((a, d) => { const t = Date.parse(d + "T00:00:00Z"); return a + (t >= w[0] && t < w[1] ? 1 : 0); }, 0);
while (win.length > CAL.length) {
  let bi = 0, bn = Infinity;
  for (let i = 0; i < win.length - 1; i++) { const n = cnt(win[i]) + cnt(win[i + 1]); if (n < bn) { bn = n; bi = i; } }
  win = win.slice(0, bi).concat([[win[bi][0], win[bi + 1][1]]]).concat(win.slice(bi + 2));
}
const WIN = win.map(w => [ds(w[0]), ds(w[1])]);
const GWS = WIN.length;

const perf = new Map();
for (const m of MATCHES) {
  let g = -1;
  for (let i = 0; i < GWS; i++) if (m.date >= WIN[i][0] && m.date < WIN[i][1]) { g = i + 1; break; }
  if (g < 0) continue;
  const add = (me, opp, gf, ga) => { const k = me + "|" + g; if (!perf.has(k)) perf.set(k, []); perf.get(k).push({ gf, ga, opp }); };
  add(m.h, m.a, m.hg, m.ag); add(m.a, m.h, m.ag, m.hg);
}
const POOL = [...new Set([...perf.keys()].map(k => k.split("|")[0]))].filter(id => PRICE.has(id));

/* ---------------------------------------------------------------- the live scoring rules */
function scoreClub(id, gw) {
  const ms = perf.get(id + "|" + gw);
  if (!ms || !ms.length) return null;                 /* null = blank, distinct from zero */
  let pts = 0;
  for (const m of ms) {
    const w = m.gf > m.ga, d = m.gf === m.ga;
    pts += (w ? 6 : d ? 2 : 0) + (m.ga === 0 ? 3 : 0) + m.gf * 2 - Math.floor(m.ga / 2)
         + (w ? [0, 6, 3, 0, 0, 0][tierN(m.opp)] : 0);
  }
  return pts;
}
const fc = (id, gw) => (perf.get(id + "|" + gw) || []).length;

/* THE LIVE AUTO-SUB, and it finally has something to do. A blanked starter is covered by the
   first bench club with a match; each sub is used once; the armband follows the shirt. */
function resolveSquad(sq, cap, gw) {
  const starters = sq.slice(0, START_SIZE), bench = sq.slice(START_SIZE);
  const used = {};
  let total = 0, covered = 0, uncovered = 0, benchPts = 0, capBlank = false, capPts = 0;
  for (const id of starters) {
    let s = scoreClub(id, gw), who = id;
    if (s === null) {
      let got = null;
      for (const b of bench) {
        if (used[b]) continue;
        const bs = scoreClub(b, gw);
        if (bs === null) continue;
        used[b] = 1; got = { b, bs }; break;
      }
      if (got) { s = got.bs; who = got.b; covered++; } else { s = 0; uncovered++; }
      if (id === cap) capBlank = true;
    }
    const isCap = id === cap;
    total += s * (isCap ? 2 : 1);
    if (isCap) capPts = s * 2;
  }
  for (const b of bench) if (!used[b]) { const bs = scoreClub(b, gw); if (bs !== null) benchPts += bs; }
  return { total, covered, uncovered, benchPts, capBlank, capPts };
}

/* ---------------------------------------------------------------- squad legality */
const cheapest = POOL.slice().sort((a, b) => priceOf(a) - priceOf(b));
function canAdd(held, id) {
  if (held.indexOf(id) >= 0) return false;
  const bl = {}; held.forEach(h => bl[lgOf(h)] = (bl[lgOf(h)] || 0) + 1);
  if ((bl[lgOf(id)] || 0) >= MAX_PER_LEAGUE) return false;
  const spend = held.reduce((a, x) => a + priceOf(x), 0);
  const need = SQUAD_SIZE - held.length - 1;
  const bl2 = { ...bl }; bl2[lgOf(id)] = (bl2[lgOf(id)] || 0) + 1;
  let fillCost = 0, k = 0;
  for (const c of cheapest) {
    if (k >= need) break;
    if (held.indexOf(c) >= 0 || c === id) continue;
    if ((bl2[lgOf(c)] || 0) >= MAX_PER_LEAGUE) continue;
    bl2[lgOf(c)] = (bl2[lgOf(c)] || 0) + 1; fillCost += priceOf(c); k++;
  }
  if (k < need) return false;
  return spend + priceOf(id) + fillCost <= BUDGET + 1e-9;
}
function legal(sq) {
  if (sq.length !== SQUAD_SIZE) return "size " + sq.length;
  if (new Set(sq).size !== sq.length) return "duplicate";
  if (sq.reduce((a, id) => a + priceOf(id), 0) > BUDGET + 1e-9) return "over budget";
  const bl = {};
  for (const id of sq) { const l = lgOf(id); bl[l] = (bl[l] || 0) + 1; if (bl[l] > MAX_PER_LEAGUE) return "4 from " + l; }
  return null;
}
/* build by a ranking, fill legally, then SPEND WHAT IS LEFT — money in the bank scores nothing */
function build(rank, worth, seed) {
  const sq = (seed || []).filter((id, i, a) => a.indexOf(id) === i && POOL.indexOf(id) >= 0).slice(0, SQUAD_SIZE);
  const keep = new Set(sq);
  for (const id of POOL.slice().sort((a, b) => rank(b) - rank(a))) { if (sq.length >= SQUAD_SIZE) break; if (canAdd(sq, id)) sq.push(id); }
  for (const id of cheapest) { if (sq.length >= SQUAD_SIZE) break; if (canAdd(sq, id)) sq.push(id); }
  const val = worth || (id => strOf(id));
  for (let pass = 0; pass < SQUAD_SIZE * 3; pass++) {
    const left = BUDGET - sq.reduce((a, id) => a + priceOf(id), 0);
    if (left < 0.05) break;
    let bo = null, bi = null, bg = 1e-9;
    for (const out of sq) {
      if (keep.has(out)) continue;
      const rest = sq.filter(x => x !== out);
      for (const inn of POOL) {
        if (sq.indexOf(inn) >= 0) continue;
        if (priceOf(inn) > priceOf(out) + left + 1e-9) continue;
        if (!canAdd(rest, inn)) continue;
        const g = val(inn) - val(out);
        if (g > bg) { bg = g; bo = out; bi = inn; }
      }
    }
    if (!bi) break;
    sq.splice(sq.indexOf(bo), 1); sq.push(bi);
  }
  return sq;
}

/* ---------------------------------------------------------------- what a manager may know */
function formOf(hist, id, lastN) {
  const rs = hist.byClub.get(id) || [];
  const take = lastN ? rs.slice(-lastN) : rs;
  if (!take.length) return null;
  return take.reduce((a, b) => a + b, 0) / take.length;
}
const formOr = (hist, id, n) => { const f = formOf(hist, id, n); return f == null ? strOf(id) * 12 : f; };

/* ---------------------------------------------------------------- the five
   `order` is the manager's team selection — the part the last run handed everybody for free.
   `logsIn` is how often he opens the app at all. */
const MANAGERS = [
  {
    key: "loyal", ar: "الجماهيري", en: "The Loyalist",
    who: "Picks with his heart. Three from his league, the biggest badges he can afford, and he is not selling Bayern because of one bad week.",
    /* WHOM he loves is the whole of his season, and he did not choose it on merit. Swept, so
       "loyalty wins" is not really "loving Bayern wins": FAVS=id,id node ... */
    seed: () => (process.env.FAVS || "132,359").split(",").filter(Boolean),
    initial(h) { return build(id => strOf(id) * (lgOf(id) === "liga" ? 1.6 : 1), null, this.seed()); },
    rebuild(h) { return this.initial(h); },
    logsIn: () => true,
    /* he picks his XI by reputation, not by the fixture list */
    order: (sq) => sq.slice().sort((a, b) => priceOf(b) - priceOf(a)),
    captain: (sq) => sq.slice(0, START_SIZE).sort((a, b) => priceOf(b) - priceOf(a))[0],
    transfers: (sq, gw, hist, ft) => {
      if (ft.free < 1 || gw < 4) return { out: [], in: [] };
      /* only moves on a club that has been bad for a long time — loyalty has a limit */
      const cold = sq.filter(id => (formOf(hist, id, 8) || 99) < 3.5)
        .sort((a, b) => (formOf(hist, a, 8) || 0) - (formOf(hist, b, 8) || 0))[0];
      if (!cold) return { out: [], in: [] };
      const rest = sq.filter(x => x !== cold);
      const inn = POOL.filter(id => sq.indexOf(id) < 0 && canAdd(rest, id))
        .sort((a, b) => strOf(b) - strOf(a))[0];
      return inn ? { out: [cold], in: [inn] } : { out: [], in: [] };
    },
    chips: { wc: [20], early: false }
  },
  {
    key: "thrifty", ar: "الحسبة", en: "The Bargain Hunter",
    who: "Will not pay for a name. Spreads across all seven leagues, buys the cheap clubs that keep winning, and thinks the superclubs are a tax.",
    initial: () => build(id => strOf(id) / priceOf(id), id => strOf(id)),
    rebuild: h => build(id => formOr(h, id, 8) / priceOf(id), id => formOr(h, id, 8)),
    logsIn: () => true,
    order: (sq, gw, hist) => sq.slice().sort((a, b) => formOr(hist, b, 6) - formOr(hist, a, 6)),
    captain: (sq, gw, hist) => sq.slice(0, START_SIZE).sort((a, b) => formOr(hist, b, 6) - formOr(hist, a, 6))[0],
    transfers: (sq, gw, hist, ft) => {
      if (ft.free < 1) return { out: [], in: [] };
      const v = id => formOr(hist, id, 6) / priceOf(id);
      const out = sq.slice().sort((a, b) => v(a) - v(b))[0];
      const rest = sq.filter(x => x !== out);
      const inn = POOL.filter(id => sq.indexOf(id) < 0 && canAdd(rest, id)).sort((a, b) => v(b) - v(a))[0];
      return inn && v(inn) > v(out) * 1.2 ? { out: [out], in: [inn] } : { out: [], in: [] };
    },
    chips: { wc: [19], early: false }
  },
  {
    key: "planner", ar: "المخطّط", en: "The Fixture Planner",
    who: "Reads the calendar before he reads the table. Benches anyone who blanks, starts anyone who plays twice, and captains the double.",
    initial: () => build(id => strOf(id), id => strOf(id)),
    rebuild: h => build(id => formOr(h, id, 6), id => formOr(h, id, 6)),
    logsIn: () => true,
    /* THE ONE WHO USES THE ROUND BAND: fixtures first, quality second */
    order: (sq, gw, hist) => sq.slice().sort((a, b) =>
      (fc(b, gw) - fc(a, gw)) || (formOr(hist, b, 6) - formOr(hist, a, 6))),
    captain: (sq, gw, hist) => {
      const xi = sq.slice(0, START_SIZE).filter(id => fc(id, gw) > 0);
      return (xi.length ? xi : sq.slice(0, START_SIZE))
        .sort((a, b) => (fc(b, gw) - fc(a, gw)) || (formOr(hist, b, 6) - formOr(hist, a, 6)))[0];
    },
    transfers: (sq, gw, hist, ft) => {
      if (ft.free < 1) return { out: [], in: [] };
      /* he moves on the NEXT round's fixture, which is public — never on a result */
      const nxt = Math.min(GWS, gw + 1);
      /* how hard he weights the calendar. Swept, because "fixture planning loses" and "MY
         fixture planner is badly tuned" are different claims and only one of them is a
         finding: BLANKPEN=0.2 node ... */
      const pen = Number(process.env.BLANKPEN || 0.2);
      const val = id => formOr(hist, id, 6) * (fc(id, nxt) > 1 ? 1.6 : fc(id, nxt) === 0 ? pen : 1);
      const out = sq.slice().sort((a, b) => val(a) - val(b))[0];
      const rest = sq.filter(x => x !== out);
      const inn = POOL.filter(id => sq.indexOf(id) < 0 && canAdd(rest, id)).sort((a, b) => val(b) - val(a))[0];
      return inn && val(inn) > val(out) * 1.25 ? { out: [out], in: [inn] } : { out: [], in: [] };
    },
    chips: { wc: [9, 25], early: true }
  },
  {
    key: "casual", ar: "العادي", en: "The Casual",
    who: "Has a life. Opens the app once a month, makes one transfer if something is obviously wrong, and whatever eleven he left behind is the eleven that plays.",
    initial: () => build(id => strOf(id), id => strOf(id)),
    rebuild: h => build(id => formOr(h, id, 6), id => formOr(h, id, 6)),
    /* THE POINT OF THIS ONE. He opens it every fourth round. In between, no team selection,
       no captain change, no transfer — the auto-sub is the only thing working for him. */
    logsIn: gw => gw === 1 || gw % 4 === 0,
    order: (sq, gw, hist) => sq.slice().sort((a, b) => strOf(b) - strOf(a)),
    captain: (sq) => sq.slice(0, START_SIZE).sort((a, b) => strOf(b) - strOf(a))[0],
    transfers: (sq, gw, hist, ft) => {
      if (ft.free < 1) return { out: [], in: [] };
      const out = sq.slice().sort((a, b) => formOr(hist, a, 8) - formOr(hist, b, 8))[0];
      const rest = sq.filter(x => x !== out);
      const inn = POOL.filter(id => sq.indexOf(id) < 0 && canAdd(rest, id))
        .sort((a, b) => formOr(hist, b, 8) - formOr(hist, a, 8))[0];
      return inn ? { out: [out], in: [inn] } : { out: [], in: [] };
    },
    chips: { wc: [], early: false }
  },
  {
    key: "gambler", ar: "المقامر", en: "The Gambler",
    who: "Wants the big score. Captains whoever is hottest, takes the -4 without blinking, and burns his chips early because waiting is boring.",
    initial: () => build(id => strOf(id), id => strOf(id)),
    rebuild: h => build(id => formOr(h, id, 4), id => formOr(h, id, 4)),
    logsIn: () => true,
    order: (sq, gw, hist) => sq.slice().sort((a, b) => formOr(hist, b, 4) - formOr(hist, a, 4)),
    captain: (sq, gw, hist) => sq.slice(0, START_SIZE).sort((a, b) => formOr(hist, b, 4) - formOr(hist, a, 4))[0],
    transfers: (sq, gw, hist, ft) => {
      const f = id => formOr(hist, id, 4);
      const out = [], inn = [];
      let work = sq.slice();
      for (let step = 0; step < 3; step++) {
        const worst = work.slice().sort((a, b) => f(a) - f(b))[0];
        const rest = work.filter(x => x !== worst);
        const best = POOL.filter(id => work.indexOf(id) < 0 && inn.indexOf(id) < 0 && canAdd(rest, id))
          .sort((a, b) => f(b) - f(a))[0];
        if (!best) break;
        const gain = f(best) - f(worst);
        if (gain <= 0.5) break;
        if (step >= ft.free && gain < HIT_COST * 0.6) break;      /* he under-rates the -4 */
        work = rest.concat([best]); out.push(worst); inn.push(best);
      }
      return { out, in: inn };
    },
    chips: { wc: [4, 22], early: true }
  }
];

/* ---------------------------------------------------------------- fixture facts, known upfront */
const coverage = [];
for (let gw = 1; gw <= GWS; gw++) {
  let playing = 0, doubles = 0;
  for (const id of POOL) { const n = fc(id, gw); if (n) playing++; if (n > 1) doubles++; }
  coverage.push({ gw, playing, doubles, blank: POOL.length - playing });
}
const BB_GW = coverage.slice().sort((a, b) => (b.playing + b.doubles) - (a.playing + a.doubles))[0].gw;
const FH_GW = coverage.slice().sort((a, b) => b.blank - a.blank)[0].gw;

/* ---------------------------------------------------------------- play */
function play(man) {
  let sq = man.initial({ byClub: new Map() });
  const bad = legal(sq);
  if (bad) return { error: man.en + ": illegal opening squad — " + bad };
  const opening = sq.slice();
  let cap = man.captain(man.order(sq, 1, { byClub: new Map() }), 1, { byClub: new Map() });
  const hist = []; hist.byClub = new Map();
  hist.push = function (o) { const a = this.byClub.get(o.id) || []; a.push(o.pts); this.byClub.set(o.id, a); };

  let banked = 1, total = 0, hits = 0, moves = 0, logins = 0;
  let blanksStarted = 0, subsFired = 0, subsFailed = 0, capBlanks = 0, benchLeft = 0;
  const log = [], chipsUsed = {};
  let fhRevert = null;

  for (let gw = 1; gw <= GWS; gw++) {
    const open = gw === 1 || man.logsIn(gw);
    if (open) logins++;
    let chip = null, wild = false;
    if (open) {
      if ((man.chips.wc || []).indexOf(gw) >= 0 && !chipsUsed["wc" + gw]) { chipsUsed["wc" + gw] = gw; wild = true; }
      else if (!chipsUsed.bb && gw === BB_GW) { chip = "bb"; chipsUsed.bb = gw; }
      else if (!chipsUsed.fh && gw === FH_GW) { chip = "fh"; chipsUsed.fh = gw; }
      else if (!chipsUsed.tc && gw > 1 && fc(cap, gw) > 1) { chip = "tc"; chipsUsed.tc = gw; }
    }
    if (fhRevert) { sq = fhRevert; fhRevert = null; }

    const first = gw === 1;
    const unlimited = first || wild || chip === "fh";
    const free = unlimited ? 99 : Math.max(1, Math.min(FT_MAX, banked));
    let made = 0;
    if (open && !first) {
      if (wild || chip === "fh") {
        if (chip === "fh") fhRevert = sq.slice();
        const nu = man.rebuild(hist);
        if (!legal(nu)) { made = nu.filter(id => sq.indexOf(id) < 0).length; sq = nu; }
      } else {
        const mv = man.transfers(sq, gw, hist, { free });
        for (let i = 0; i < mv.out.length; i++) {
          const nx = sq.filter(x => x !== mv.out[i]).concat([mv.in[i]]);
          if (!legal(nx)) { sq = nx; made++; }
        }
      }
    }
    const cost = unlimited ? 0 : Math.max(0, made - free) * HIT_COST;
    banked = unlimited ? 1 : Math.min(FT_MAX, Math.max(0, free - made) + 1);
    hits += cost; moves += made;

    /* TEAM SELECTION IS A CHOICE, AND ONLY A MANAGER WHO OPENED THE APP MADE IT.
       BAND=1 overrides every manager's ordering with the one the round-status band pushes you
       toward - start whoever plays, bench whoever blanks - so the difference between the two
       runs IS what that band is worth. Nothing else changes. */
    if (open) {
      sq = process.env.BAND === "1"
        ? sq.slice().sort((a, b) => (fc(b, gw) - fc(a, gw)) || (strOf(b) - strOf(a)))
        : man.order(sq, gw, hist);
      cap = process.env.BAND === "1"
        ? (sq.slice(0, START_SIZE).filter(id => fc(id, gw) > 0)
             .sort((a, b) => (fc(b, gw) - fc(a, gw)) || (strOf(b) - strOf(a)))[0] || sq[0])
        : man.captain(sq, gw, hist);
    }

    const r = resolveSquad(sq, cap, gw);
    let pts = r.total;
    if (chip === "tc") pts += scoreClub(cap, gw) || 0;
    if (chip === "bb") pts += r.benchPts;
    pts -= cost;
    total += pts;

    blanksStarted += r.covered + r.uncovered;
    subsFired += r.covered; subsFailed += r.uncovered;
    if (r.capBlank) capBlanks++;
    benchLeft += r.benchPts;
    log.push({ gw, pts, cost, made, open, chip: chip || (wild ? "wc" : null), cap,
               covered: r.covered, uncovered: r.uncovered, capBlank: r.capBlank });
    for (const id of POOL) { const s = scoreClub(id, gw); if (s !== null) hist.push({ id, pts: s }); }
  }
  return { man, total, log, moves, hits, logins, opening, final: sq, chipsUsed,
           blanksStarted, subsFired, subsFailed, capBlanks, benchLeft };
}

/* ---------------------------------------------------------------- report */
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
const runs = MANAGERS.map(play);
for (const r of runs) if (r.error) { console.log("ERROR  " + r.error); process.exit(1); }
const ranked = runs.slice().sort((a, b) => b.total - a.total);

console.log("=".repeat(84));
console.log("FIVE MANAGERS PLAY 2025-26  ·  real results, live rules, league matches only");
console.log("=".repeat(84));
console.log(MATCHES.length + " matches · " + POOL.length + " clubs eligible · " + GWS + " rounds · "
  + START_SIZE + "+" + (SQUAD_SIZE - START_SIZE) + " · " + BUDGET + "M · 1 free transfer, bank "
  + FT_MAX + ", -" + HIT_COST);
console.log("bench boost round " + BB_GW + " · free hit round " + FH_GW);

console.log("\n" + "-".repeat(84));
console.log("FINAL TABLE");
console.log("-".repeat(84));
console.log(pad("", 4) + pad("manager", 22) + num("points", 8) + num("opened", 8) + num("moves", 7)
  + num("hits", 7) + num("blanks", 8) + num("subbed", 8) + num("cap out", 9));
ranked.forEach((r, i) => {
  console.log(pad(" " + (i + 1) + ".", 4) + pad(r.man.en, 22) + num(r.total, 8)
    + num(r.logins + "/" + GWS, 8) + num(r.moves, 7) + num(r.hits ? "-" + r.hits : "0", 7)
    + num(r.blanksStarted, 8) + num(r.subsFired, 8) + num(r.capBlanks, 9));
});

console.log("\n" + "-".repeat(84));
console.log("EACH ONE'S SEASON");
console.log("-".repeat(84));
for (const r of ranked) {
  const best = r.log.slice().sort((a, b) => b.pts - a.pts)[0];
  const worst = r.log.slice().sort((a, b) => a.pts - b.pts)[0];
  const spend = r.opening.reduce((a, id) => a + priceOf(id), 0);
  const lgs = {}; r.opening.forEach(id => lgs[lgOf(id)] = (lgs[lgOf(id)] || 0) + 1);
  const caps = {}; r.log.forEach(l => caps[l.cap] = (caps[l.cap] || 0) + 1);
  console.log("\n" + r.man.en + "  ·  " + r.man.ar + "   " + r.total + " pts");
  console.log("  " + r.man.who);
  console.log("  opening squad  " + spend.toFixed(1) + "M · "
    + Object.entries(lgs).map(([l, n]) => n + " " + lgName(l)).join(", "));
  console.log("                 " + r.opening.slice(0, START_SIZE).map(nameOf).join(", "));
  console.log("  bench          " + r.opening.slice(START_SIZE).map(nameOf).join(", "));
  console.log("  armband        " + Object.entries(caps).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id, n]) => nameOf(id) + " x" + n).join(", "));
  console.log("  best / worst   " + best.pts + " (r" + best.gw + ")  /  " + worst.pts + " (r" + worst.gw + ")");
  console.log("  blanks started " + r.blanksStarted + ", of which the bench covered " + r.subsFired
    + " and " + r.subsFailed + " scored nothing");
  console.log("  captain blank  " + r.capBlanks + " rounds" + (r.capBlanks ? "  ← the armband paid zero" : ""));
  console.log("  left on bench  " + r.benchLeft + " points");
  console.log("  chips          " + (Object.entries(r.chipsUsed).map(([k, v]) => k + "@r" + v).join(", ") || "none used"));
}

console.log("\n" + "-".repeat(84));
console.log("ROUND BY ROUND   (· = did not open the app)");
console.log("-".repeat(84));
console.log(pad("r", 3) + ranked.map(r => num(r.man.en.split(" ")[1].slice(0, 8), 13)).join("") + "   fixtures");
for (let i = 0; i < GWS; i++) {
  const cells = ranked.map(r => {
    const l = r.log[i];
    return num((l.open ? "" : "·") + l.pts + (l.cost ? "(-" + l.cost + ")" : "")
      + (l.chip ? " " + l.chip.toUpperCase() : ""), 13);
  }).join("");
  console.log(pad(i + 1, 3) + cells + "   " + coverage[i].blank + "b " + coverage[i].doubles + "d");
}

console.log("\n" + "-".repeat(84));
console.log("WHAT THE GAME DID TO THEM");
console.log("-".repeat(84));
const spread = ranked[0].total - ranked[ranked.length - 1].total;
console.log("first to last            " + spread + " points (" + (spread / ranked[0].total * 100).toFixed(1) + "%)");
const planner = runs.find(r => r.man.key === "planner"), casual = runs.find(r => r.man.key === "casual");
console.log("the planner vs the casual " + (planner.total - casual.total) + " points — "
  + "what reading the fixture list every week is worth against opening the app monthly");
console.log("the casual's uncovered    " + casual.subsFailed + " blanks nobody covered, "
  + casual.capBlanks + " rounds with a blank captain");
console.log("the gambler's hits        " + runs.find(r => r.man.key === "gambler").hits + " points");
console.log("bench points left behind  "
  + ranked.map(r => r.man.en.split(" ")[1] + " " + r.benchLeft).join(" · "));
