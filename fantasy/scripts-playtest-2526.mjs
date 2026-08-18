/* THREE MANAGERS PLAY LAST SEASON.
 *
 * Not a simulation — the 2,286 real completed league matches of 2025-26, scored with the
 * rules that are live on goallak.com right now, under the transfer economy that shipped
 * yesterday. League matches only, on the owner's rule.
 *
 * THE ONE DISCIPLINE THAT MAKES THIS WORTH ANYTHING: no decision may read a result that had
 * not happened yet. A manager may use the FIXTURE LIST — who you play, home or away, whether
 * you play twice or not at all — because that is public months in advance and every real
 * player has it. A manager may not use a scoreline from a round that has not been played.
 * Every strategy below is handed a `history` that is truncated at the deadline it is deciding
 * on, and the scoring engine is never reachable from a strategy function.
 *
 *   node scripts-playtest-2526.mjs
 */
import fs from "node:fs";

const U = f => new URL("./" + f, import.meta.url);
const CAL = JSON.parse(fs.readFileSync(U("calendar.json"), "utf8")).gws;
const CLUBS = JSON.parse(fs.readFileSync(U("clubs.json"), "utf8")).clubs;
const LEAGUES = JSON.parse(fs.readFileSync(U("clubs.json"), "utf8")).leagues;
const PRICE = new Map(JSON.parse(fs.readFileSync(U("prices.json"), "utf8")).clubs.map(p => [String(p.id), p]));
const MATCHES = JSON.parse(fs.readFileSync(U("backtest-2526.json"), "utf8"));

/* the live constants, read from the shipped file so this cannot drift from the game */
const SRC = fs.readFileSync(U("index.html"), "utf8");
const K = (re, d) => { const m = SRC.match(re); return m ? Number(m[1]) : d; };
const START_SIZE = K(/const START_SIZE = (\d+)/, 11);
const BENCH_SIZE = K(/START_SIZE = \d+, BENCH_SIZE = (\d+)/, 4);
const SQUAD_SIZE = START_SIZE + BENCH_SIZE;
const BUDGET = K(/const BUDGET = ([\d.]+)/, 120);
const MAX_PER_LEAGUE = K(/MAX_PER_LEAGUE = (\d+)/, 3);
const FT_MAX = K(/const FT_MAX = (\d+)/, 5);
/* overridable so the hit can be sized against a real season rather than argued about:
   HIT=6 node scripts-playtest-2526.mjs */
const HIT_COST = Number(process.env.HIT || K(/FT_MAX = \d+, HIT_COST = (\d+)/, 4));
const FT_BANK  = Number(process.env.BANK || FT_MAX);

const byId = new Map(CLUBS.map(c => [String(c.id), c]));
const priceOf = id => (PRICE.get(String(id)) || {}).price || 999;
const TIERN = { elite: 1, strong: 2, mid: 3, value: 4, budget: 5 };
const tierN = id => TIERN[(PRICE.get(String(id)) || {}).tier] || 5;
const nameOf = id => (byId.get(String(id)) || {}).short || (byId.get(String(id)) || {}).name || id;
const lgOf = id => (byId.get(String(id)) || {}).lg;

/* ---------------------------------------------------------------- the 36 windows
   FIRST ATTEMPT, AND WHY IT WAS THROWN AWAY: shifting the live 2026-27 calendar back 364 days
   keeps the weekdays but not the football. Round 3 landed squarely on a 2025-26 international
   break with ALL 108 clubs idle, and round 6 caught two matchdays at once with all 108 playing
   twice. Every manager scored 0 and then 200. That measures my shift, not their strategies.

   Built from 2025-26's own season instead, the same way a real fantasy calendar is: weeks run
   Thursday to Wednesday so a weekend never splits, and the quietest adjacent pair is merged
   until exactly 36 rounds remain. That is what a fixture compiler does with the winter break
   and the international windows, and it produces round shapes the live season would recognise. */
const DAY = 864e5;
const dstr = ms => new Date(ms).toISOString().slice(0, 10);
function buildWindows(dates, want) {
  const first = Math.min(...dates.map(d => Date.parse(d + "T00:00:00Z")));
  const last  = Math.max(...dates.map(d => Date.parse(d + "T00:00:00Z")));
  /* walk back to the Thursday on or before the first match */
  let start = first;
  while (new Date(start).getUTCDay() !== 4) start -= DAY;
  const edges = [];
  for (let t = start; t <= last + DAY; t += 7 * DAY) edges.push(t);
  edges.push(edges[edges.length - 1] + 7 * DAY);
  let win = [];
  for (let i = 0; i < edges.length - 1; i++) win.push([edges[i], edges[i + 1]]);
  const countIn = w => dates.reduce((a, d) => {
    const t = Date.parse(d + "T00:00:00Z"); return a + (t >= w[0] && t < w[1] ? 1 : 0); }, 0);
  /* merge the quietest neighbouring pair until the round count is right */
  while (win.length > want) {
    let bi = 0, bn = Infinity;
    for (let i = 0; i < win.length - 1; i++) {
      const n = countIn(win[i]) + countIn(win[i + 1]);
      if (n < bn) { bn = n; bi = i; }
    }
    win = win.slice(0, bi).concat([[win[bi][0], win[bi + 1][1]]]).concat(win.slice(bi + 2));
  }
  return win.map(w => [dstr(w[0]), dstr(w[1])]);
}
const WIN = buildWindows(MATCHES.map(m => m.date), CAL.length);

/* ---------------------------------------------------------------- what each club did, per round
   Half-open [from, to), the same window the app uses, so a match on a boundary date is counted
   once and not by both rounds. */
const perf = new Map();              /* "clubId|gw" -> [{gf, ga, oppTier, opp, home}] */
let placed = 0, unplaced = 0;
for (const m of MATCHES) {
  let gw = -1;
  for (let i = 0; i < WIN.length; i++) if (m.date >= WIN[i][0] && m.date < WIN[i][1]) { gw = i + 1; break; }
  if (gw < 0) { unplaced++; continue; }
  placed++;
  const add = (me, opp, gf, ga, home) => {
    const k = me + "|" + gw;
    if (!perf.has(k)) perf.set(k, []);
    perf.get(k).push({ gf, ga, oppTier: tierN(opp), opp, home });
  };
  add(m.h, m.a, m.hg, m.ag, true);
  add(m.a, m.h, m.ag, m.hg, false);
}

/* the pool: a club can only be picked if it actually played top-flight football in 2025-26.
   Eighteen of the 126 were promoted for 2026-27 and have no top-flight season to score. */
const PLAYED = new Set();
for (const k of perf.keys()) PLAYED.add(k.split("|")[0]);
const POOL = CLUBS.map(c => String(c.id)).filter(id => PLAYED.has(id) && PRICE.has(id));

/* ---------------------------------------------------------------- the live scoring rules */
function scoreClub(id, gw) {
  const ms = perf.get(id + "|" + gw);
  if (!ms || !ms.length) return { blank: true, pts: 0, n: 0 };
  let pts = 0, w = 0, d = 0, l = 0, gf = 0, ga = 0;
  for (const m of ms) {
    const win = m.gf > m.ga, draw = m.gf === m.ga;
    const res = win ? 6 : draw ? 2 : 0;
    const clean = m.ga === 0 ? 3 : 0;
    const goals = m.gf * 2;
    const conc = -Math.floor(m.ga / 2);
    const tierBonus = win ? [0, 6, 3, 0, 0, 0][m.oppTier] : 0;
    pts += res + clean + goals + conc + tierBonus;
    if (win) w++; else if (draw) d++; else l++;
    gf += m.gf; ga += m.ga;
  }
  return { blank: false, pts, n: ms.length, w, d, l, gf, ga };
}
/* the live auto-substitution: a blanked starter is covered by the first bench club with a
   match, each sub used once, and the armband follows the shirt */
function resolveSquad(sq, cap, gw) {
  const starters = sq.slice(0, START_SIZE), bench = sq.slice(START_SIZE);
  const used = {};
  let total = 0, covered = 0, uncovered = 0, benchPts = 0;
  for (const id of starters) {
    const m = scoreClub(id, gw);
    let scorer = { id, m };
    if (m.blank) {
      let rep = null;
      for (const b of bench) {
        if (used[b]) continue;
        const bm = scoreClub(b, gw);
        if (bm.blank) continue;
        used[b] = 1; rep = { id: b, m: bm }; break;
      }
      if (rep) { scorer = rep; covered++; } else uncovered++;
    }
    total += scorer.m.pts * (id === cap ? 2 : 1);
  }
  for (const b of bench) if (!used[b]) benchPts += scoreClub(b, gw).pts;
  return { total, covered, uncovered, benchPts };
}

/* ---------------------------------------------------------------- squad legality */
function legal(sq) {
  if (sq.length !== SQUAD_SIZE) return "size " + sq.length;
  if (new Set(sq).size !== sq.length) return "duplicate club";
  const spend = sq.reduce((a, id) => a + priceOf(id), 0);
  if (spend > BUDGET + 1e-9) return "over budget " + spend.toFixed(1);
  const byLg = {};
  for (const id of sq) { const l = lgOf(id); byLg[l] = (byLg[l] || 0) + 1; if (byLg[l] > MAX_PER_LEAGUE) return "4 from " + l; }
  return null;
}
/* the cheapest legal completion, the same question the app's budget bar answers */
function cheapestFill(held, n) {
  if (n <= 0) return 0;
  const byLg = {};
  for (const id of held) byLg[lgOf(id)] = (byLg[lgOf(id)] || 0) + 1;
  const pool = POOL.filter(id => held.indexOf(id) < 0).sort((a, b) => priceOf(a) - priceOf(b));
  let total = 0, taken = 0;
  for (const id of pool) {
    if (taken >= n) break;
    const l = lgOf(id);
    if ((byLg[l] || 0) >= MAX_PER_LEAGUE) continue;
    byLg[l] = (byLg[l] || 0) + 1; total += priceOf(id); taken++;
  }
  return taken < n ? Infinity : total;
}
function canAdd(held, id) {
  if (held.indexOf(id) >= 0) return false;
  const byLg = {};
  for (const h of held) byLg[lgOf(h)] = (byLg[lgOf(h)] || 0) + 1;
  if ((byLg[lgOf(id)] || 0) >= MAX_PER_LEAGUE) return false;
  const spend = held.reduce((a, x) => a + priceOf(x), 0);
  return spend + priceOf(id) + cheapestFill(held.concat([id]), SQUAD_SIZE - held.length - 1) <= BUDGET + 1e-9;
}
/* Build greedily by a ranking function, fill legally, THEN SPEND WHAT IS LEFT.
   The upgrade pass is not decoration. Ranking by points-per-million alone bought fifteen cheap
   clubs and left 29.0M of 120M in the bank - which is not a value strategy, it is an underspend,
   and it cost that manager the comparison. Money you do not spend scores nothing. The pass
   swaps in the best upgrade the leftover can afford until nothing else fits, the same shape as
   the app's own quick build. `worth` is how this manager measures a club. */
function build(rank, worth) {
  const sq = [];
  const ranked = POOL.slice().sort((a, b) => rank(b) - rank(a));
  for (const id of ranked) { if (sq.length >= SQUAD_SIZE) break; if (canAdd(sq, id)) sq.push(id); }
  for (const id of POOL.slice().sort((a, b) => priceOf(a) - priceOf(b))) {
    if (sq.length >= SQUAD_SIZE) break;
    if (canAdd(sq, id)) sq.push(id);
  }
  const val = worth || (id => (PRICE.get(id) || {}).str || 0.4);
  for (let pass = 0; pass < SQUAD_SIZE * 3; pass++) {
    const left = BUDGET - sq.reduce((a, id) => a + priceOf(id), 0);
    if (left < 0.05) break;
    let bo = null, bi = null, bg = 1e-9;
    for (const out of sq) {
      const rest = sq.filter(x => x !== out);
      for (const inn of POOL) {
        if (sq.indexOf(inn) >= 0) continue;
        if (priceOf(inn) > priceOf(out) + left + 1e-9) continue;
        if (!canAdd(rest, inn)) continue;
        const gain = val(inn) - val(out);
        if (gain > bg) { bg = gain; bo = out; bi = inn; }
      }
    }
    if (!bi) break;
    sq.splice(sq.indexOf(bo), 1); sq.push(bi);
  }
  return sq;
}

/* ---------------------------------------------------------------- what a manager may know
   `history` holds only rounds already played. A strategy that reaches past it is cheating,
   and there is no path from here to `scoreClub` for a future round. */
function formOf(hist, id, lastN) {
  const rs = hist.byClub ? (hist.byClub.get(id) || []) : hist.filter(h => h.id === id);
  const take = lastN ? rs.slice(-lastN) : rs;
  if (!take.length) return null;
  return take.reduce((a, r) => a + r, 0) / take.length;
}
/* the fixture list IS public in advance — how many matches a club has in a round, and who
   against. Results are not. */
const fixtureCount = (id, gw) => (perf.get(id + "|" + gw) || []).length;
const oppTierIn = (id, gw) => (perf.get(id + "|" + gw) || []).map(m => m.oppTier);

/* ---------------------------------------------------------------- the three managers */
const MANAGERS = [
  {
    key: "stars", ar: "صيّاد النجوم", en: "The Star Buyer",
    idea: "Buy the biggest clubs the budget allows, fill the rest with the cheapest legal clubs, and never change anything. Captain the most expensive club that plays.",
    /* rank purely on price — the most famous, most expensive squad money can buy */
    initial: () => build(id => priceOf(id), id => priceOf(id)),
    rebuild: () => build(id => priceOf(id), id => priceOf(id)),
    /* set and forget: no transfers, ever */
    transfers: () => ({ out: [], in: [] }),
    captain: (sq, gw) => sq.slice(0, START_SIZE)
      .filter(id => fixtureCount(id, gw) > 0)
      .sort((a, b) => priceOf(b) - priceOf(a))[0] || sq[0],
    chips: { tc: "captainDouble", bb: "maxCoverage", wc1: null, wc2: null, fh: null }
  },
  {
    key: "value", ar: "صائد القيمة", en: "The Value Hunter",
    idea: "Buy points per million, not names. Use the one free transfer each round to move the worst club on to the best available. Never take a hit.",
    /* str is the app's own published strength, derived from price — public, no hindsight */
    /* ranks on value, but upgrades on POINTS - otherwise "value" means "cheap" and the
       leftover money is never spent on anything that scores */
    initial: () => build(id => ((PRICE.get(id) || {}).str || 0.4) / priceOf(id),
                         id => (PRICE.get(id) || {}).str || 0.4),
    rebuild: hist => {
      const pts = id => { const f = formOf(hist, id, 8);
        return f == null ? ((PRICE.get(id) || {}).str || .4) * 12 : f; };
      return build(id => pts(id) / priceOf(id), pts);
    },
    transfers: (sq, gw, hist, ft) => {
      if (ft.free < 1) return { out: [], in: [] };
      const score = id => {
        const f = formOf(hist, id, 6);
        const base = f == null ? ((PRICE.get(id) || {}).str || 0.4) * 12 : f;
        return base / priceOf(id);                       /* value, always value */
      };
      const owned = sq.slice().sort((a, b) => score(a) - score(b));
      for (const out of owned) {
        const rest = sq.filter(x => x !== out);
        const cands = POOL.filter(id => sq.indexOf(id) < 0 && canAdd(rest, id))
          .sort((a, b) => score(b) - score(a));
        for (const inn of cands) {
          if (score(inn) > score(out) * 1.15) return { out: [out], in: [inn] };
          break;
        }
      }
      return { out: [], in: [] };
    },
    captain: (sq, gw, hist) => {
      const playing = sq.slice(0, START_SIZE).filter(id => fixtureCount(id, gw) > 0);
      const pick = (playing.length ? playing : sq.slice(0, START_SIZE))
        .sort((a, b) => (fixtureCount(b, gw) - fixtureCount(a, gw))
          || ((formOf(hist, b, 6) || 0) - (formOf(hist, a, 6) || 0)))[0];
      return pick || sq[0];
    },
    chips: { tc: "captainDouble", bb: "maxCoverage", wc1: 19, wc2: null, fh: "worstBlank" }
  },
  {
    key: "chaser", ar: "مطارد الفورمة", en: "The Form Chaser",
    idea: "Whoever is hot, buy them. Rebuild every round around the last five rounds' form and take the -4 whenever the upgrade looks worth it.",
    initial: () => build(id => ((PRICE.get(id) || {}).str || 0.4)),
    rebuild: hist => {
      const pts = id => { const f = formOf(hist, id, 5);
        return f == null ? ((PRICE.get(id) || {}).str || .4) * 12 : f; };
      return build(pts, pts);
    },
    transfers: (sq, gw, hist, ft) => {
      const form = id => { const f = formOf(hist, id, 5); return f == null ? ((PRICE.get(id) || {}).str || .4) * 12 : f; };
      const out = [], inn = [];
      let work = sq.slice();
      /* up to four moves a round: the free one plus three hits, taken whenever the gap looks
         bigger than the -4 — which is exactly the trap the transfer economy is meant to set */
      for (let step = 0; step < 4; step++) {
        const worst = work.slice().sort((a, b) => form(a) - form(b))[0];
        const rest = work.filter(x => x !== worst);
        const best = POOL.filter(id => work.indexOf(id) < 0 && inn.indexOf(id) < 0 && canAdd(rest, id))
          .sort((a, b) => form(b) - form(a))[0];
        if (!best) break;
        const gain = form(best) - form(worst);
        const free = step < ft.free;
        /* he is not a careful man. A free move needs any edge at all; a -4 needs to look like
           it pays for itself on form alone, which is precisely the reasoning the hit exists
           to punish - form over five rounds is mostly noise. */
        if (gain <= 0.3) break;
        if (!free && gain < HIT_COST) break;
        work = rest.concat([best]); out.push(worst); inn.push(best);
      }
      return { out, in: inn };
    },
    captain: (sq, gw, hist) => {
      const playing = sq.slice(0, START_SIZE).filter(id => fixtureCount(id, gw) > 0);
      return (playing.length ? playing : sq.slice(0, START_SIZE))
        .sort((a, b) => ((formOf(hist, b, 5) || 0) - (formOf(hist, a, 5) || 0)))[0] || sq[0];
    },
    chips: { tc: "captainDouble", bb: "maxCoverage", wc1: 6, wc2: 24, fh: "worstBlank" }
  }
];

/* ---------------------------------------------------------------- fixture facts, known upfront */
const coverage = [];
for (let gw = 1; gw <= WIN.length; gw++) {
  let playing = 0, doubles = 0;
  for (const id of POOL) { const n = fixtureCount(id, gw); if (n) playing++; if (n > 1) doubles++; }
  coverage.push({ gw, playing, doubles, blank: POOL.length - playing });
}
const BB_ROUND = coverage.slice().sort((a, b) => (b.playing + b.doubles) - (a.playing + a.doubles))[0].gw;
const FH_ROUND = coverage.slice().sort((a, b) => b.blank - a.blank)[0].gw;

/* ---------------------------------------------------------------- play the season */
function play(man) {
  let sq = man.initial();
  const openingSquad = sq.slice();
  const bad = legal(sq);
  if (bad) return { error: man.key + " could not build a legal squad: " + bad };
  let cap = null;
  /* the only past a manager may read. An index by club, because it is asked hundreds of
     times a round and a linear scan of 3,800 rows would dominate everything else here. */
  const hist = [];
  hist.byClub = new Map();
  hist.push = function (o) { const a = this.byClub.get(o.id) || []; a.push(o.pts); this.byClub.set(o.id, a); };
  let banked = 1, joined = 1;
  let total = 0, hitsTotal = 0, transfersTotal = 0;
  const log = [];
  const chipsUsed = {};
  let freeHitRevert = null;

  for (let gw = 1; gw <= WIN.length; gw++) {
    /* ---- chips are declared at the deadline, from the fixture list only ---- */
    /* ONE CHIP A ROUND, and a wildcard is a chip too - the live game does not let two run at
       once, and letting the backtest stack them would flatter every manager who owns more. */
    let chip = null, wildcard = false;
    const capPre = man.captain(sq, gw, hist);
    if (man.chips.wc1 === gw && !chipsUsed.wc1) { chipsUsed.wc1 = gw; wildcard = true; }
    else if (man.chips.wc2 === gw && !chipsUsed.wc2) { chipsUsed.wc2 = gw; wildcard = true; }
    else if (!chipsUsed.bb && gw === BB_ROUND) { chip = "bb"; chipsUsed.bb = gw; }
    else if (!chipsUsed.fh && man.chips.fh && gw === FH_ROUND) { chip = "fh"; chipsUsed.fh = gw; }
    else if (!chipsUsed.tc && gw > 1 && fixtureCount(capPre, gw) > 1) { chip = "tc"; chipsUsed.tc = gw; }

    /* ---- transfers ---- */
    const firstRound = gw === joined;
    const unlimited = firstRound || !!wildcard || chip === "fh";
    const ft = { free: unlimited ? 99 : Math.max(1, Math.min(FT_BANK, banked)) };
    let made = 0;
    if (freeHitRevert) { sq = freeHitRevert; freeHitRevert = null; }
    if (!firstRound) {
      if (wildcard || chip === "fh") {
        if (chip === "fh") freeHitRevert = sq.slice();
        const rebuilt = man.rebuild ? man.rebuild(hist) : sq;
        made = rebuilt.filter(id => sq.indexOf(id) < 0).length;
        if (!legal(rebuilt)) sq = rebuilt;
      } else {
        const mv = man.transfers(sq, gw, hist, ft);
        for (let i = 0; i < mv.out.length; i++) {
          const next = sq.filter(x => x !== mv.out[i]).concat([mv.in[i]]);
          if (!legal(next)) { sq = next; made++; }
        }
      }
    }
    const hits = unlimited ? 0 : Math.max(0, made - ft.free);
    const cost = hits * HIT_COST;
    banked = unlimited ? 1 : Math.min(FT_BANK, Math.max(0, ft.free - made) + 1);
    transfersTotal += made; hitsTotal += cost;

    /* ---- order the XI: the eleven most likely to play go on the pitch ---- */
    sq.sort((a, b) => (fixtureCount(b, gw) - fixtureCount(a, gw))
      || (((formOf(hist, b, 6) || (PRICE.get(b) || {}).str * 12 || 0)) - ((formOf(hist, a, 6) || (PRICE.get(a) || {}).str * 12 || 0))));
    cap = man.captain(sq, gw, hist);

    /* ---- and only now is the round played ---- */
    const r = resolveSquad(sq, cap, gw);
    let pts = r.total;
    if (chip === "tc") pts += scoreClub(cap, gw).pts;          /* x2 becomes x3 */
    if (chip === "bb") pts += r.benchPts;
    pts -= cost;
    total += pts;
    log.push({ gw, pts, cost, made, chip: chip || (wildcard ? "wc" : null), cap, covered: r.covered, uncovered: r.uncovered });
    /* EVERY CLUB'S POINTS GO INTO HISTORY, not just the ones he owns. Recording only the
       owned squad meant an unowned club had no form at all, so a form chaser could never
       see anybody to chase - he was choosing between his own fifteen and a table of
       fallbacks. In the real game every club's score is public the moment it is played. */
    for (const id of POOL) { const s = scoreClub(id, gw); if (!s.blank) hist.push({ gw, id, pts: s.pts }); }
  }
  return { man, total, log, transfersTotal, hitsTotal, chipsUsed, finalSquad: sq, openingSquad };
}

/* ---------------------------------------------------------------- run and report */
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log("=".repeat(78));
console.log("THREE MANAGERS PLAY 2025-26  ·  real results, live rules, league matches only");
console.log("=".repeat(78));
console.log("matches loaded          " + MATCHES.length);
console.log("placed in a round       " + placed + "   (outside every window: " + unplaced + ")");
console.log("clubs eligible          " + POOL.length + " of " + CLUBS.length
  + "   (" + (CLUBS.length - POOL.length) + " were promoted for 2026-27 and have no top-flight season)");
console.log("rules in force          " + START_SIZE + "+" + BENCH_SIZE + " · " + BUDGET
  + "M · max " + MAX_PER_LEAGUE + "/league · 1 free transfer, bank " + FT_MAX + ", -" + HIT_COST + " a hit");
console.log("bench boost round " + BB_ROUND + " (most matches) · free hit round " + FH_ROUND + " (most blanks)");

const runs = MANAGERS.map(play);
for (const r of runs) if (r.error) { console.log("\nERROR  " + r.error); process.exit(1); }

console.log("\n" + "-".repeat(78));
console.log("FINAL TABLE");
console.log("-".repeat(78));
const ranked = runs.slice().sort((a, b) => b.total - a.total);
console.log(pad("", 4) + pad("manager", 20) + num("points", 8) + num("transfers", 12)
  + num("hits", 8) + num("best round", 14) + num("worst round", 14));
ranked.forEach((r, i) => {
  const best = r.log.slice().sort((a, b) => b.pts - a.pts)[0];
  const worst = r.log.slice().sort((a, b) => a.pts - b.pts)[0];
  console.log(pad(" " + (i + 1) + ".", 4) + pad(r.man.en, 20) + num(r.total, 8)
    + num(r.transfersTotal, 12) + num(r.hitsTotal ? "-" + r.hitsTotal : "0", 8)
    + num(best.pts + " (r" + best.gw + ")", 14) + num(worst.pts + " (r" + worst.gw + ")", 14));
});

console.log("\n" + "-".repeat(78));
console.log("HOW EACH ONE PLAYED");
console.log("-".repeat(78));
for (const r of ranked) {
  console.log("\n" + r.man.en + "  ·  " + r.man.ar);
  console.log("  plan      " + r.man.idea);
  console.log("  finished  " + r.total + " points   ("
    + (r.transfersTotal ? r.transfersTotal + " transfers, " + (r.hitsTotal ? r.hitsTotal + " points paid in hits" : "not one hit taken")
                        : "never transferred") + ")");
  const chips = Object.entries(r.chipsUsed).map(([k, v]) => k + "@gw" + v).join(", ");
  console.log("  chips     " + (chips || "none"));
  const capCount = {};
  for (const l of r.log) capCount[l.cap] = (capCount[l.cap] || 0) + 1;
  const topCaps = Object.entries(capCount).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id, n]) => nameOf(id) + " x" + n).join(", ");
  console.log("  armband   " + topCaps);
  const cov = r.log.reduce((a, l) => a + l.covered, 0), unc = r.log.reduce((a, l) => a + l.uncovered, 0);
  console.log("  bench     covered " + cov + " blanks, " + unc + " went uncovered");
}

console.log("\n" + "-".repeat(78));
console.log("ROUND BY ROUND");
console.log("-".repeat(78));
console.log(pad("gw", 4) + ranked.map(r => num(r.man.en.split(" ")[1], 14)).join("") + "    notes");
for (let i = 0; i < WIN.length; i++) {
  const cells = ranked.map(r => {
    const l = r.log[i];
    return num(l.pts + (l.cost ? "(-" + l.cost + ")" : "") + (l.chip ? " " + l.chip.toUpperCase() : ""), 14);
  }).join("");
  const c = coverage[i];
  console.log(pad(i + 1, 4) + cells + "    " + c.blank + " blank, " + c.doubles + " double");
}

console.log("\n" + "-".repeat(78));
console.log("THE SQUAD EACH ONE STARTED WITH");
console.log("-".repeat(78));
for (const r of ranked) {
  const spend = r.openingSquad.reduce((a, id) => a + priceOf(id), 0);
  console.log("\n" + r.man.en + "   spent " + spend.toFixed(1) + "M of " + BUDGET + "M");
  console.log("  " + r.openingSquad.map(id => nameOf(id) + " " + priceOf(id).toFixed(1)).join(" · "));
}

console.log("\n" + "-".repeat(78));
console.log("THE SQUAD EACH ONE FINISHED WITH");
console.log("-".repeat(78));
for (const r of ranked) {
  console.log("\n" + r.man.en + "   " + r.finalSquad.reduce((a, id) => a + priceOf(id), 0).toFixed(1) + "M");
  console.log("  XI    " + r.finalSquad.slice(0, START_SIZE).map(id => nameOf(id)).join(", "));
  console.log("  bench " + r.finalSquad.slice(START_SIZE).map(id => nameOf(id)).join(", "));
}

/* THE CONTROL THAT MATTERS: where do these three sit against somebody who did not think?
   A game whose strategies all land inside the noise of random legal squads is not a game, it
   is a lottery with a leaderboard. 400 random squads, each one legal, each one left alone for
   the season, captaining its most expensive club — the least effort a player could make. */
const rnd = (seed => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(20260818);
const baseline = [];
for (let n = 0; n < 400; n++) {
  const sq = [];
  const shuffled = POOL.slice().sort(() => rnd() - 0.5);
  for (const id of shuffled) { if (sq.length >= SQUAD_SIZE) break; if (canAdd(sq, id)) sq.push(id); }
  if (sq.length < SQUAD_SIZE || legal(sq)) continue;
  let tot = 0;
  for (let gw = 1; gw <= WIN.length; gw++) {
    const order = sq.slice().sort((a, b) => fixtureCount(b, gw) - fixtureCount(a, gw));
    const cap = order.slice(0, START_SIZE).filter(id => fixtureCount(id, gw) > 0)
      .sort((a, b) => priceOf(b) - priceOf(a))[0] || order[0];
    tot += resolveSquad(order, cap, gw).total;
  }
  baseline.push(tot);
}
baseline.sort((a, b) => a - b);
const pct = v => (baseline.filter(x => x < v).length / baseline.length * 100).toFixed(1);
const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
const sd = Math.sqrt(baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length);

console.log("\n" + "-".repeat(78));
console.log("CONTROLS");
console.log("-".repeat(78));
console.log(baseline.length + " random legal squads, set and forgotten:");
console.log("  mean " + Math.round(mean) + "   sd " + Math.round(sd)
  + "   worst " + baseline[0] + "   best " + baseline[baseline.length - 1]);
for (const r of ranked)
  console.log("  " + pad(r.man.en, 20) + num(r.total, 6) + "   beats " + pct(r.total)
    + "% of them   (" + ((r.total - mean) / sd).toFixed(2) + " sd)");
const spread = ranked[0].total - ranked[ranked.length - 1].total;
console.log("first to last            " + spread + " points ("
  + (spread / ranked[0].total * 100).toFixed(1) + "% of the winner's total)");
const chaser = runs.find(r => r.man.key === "chaser");
console.log("the chaser's hits        " + chaser.hitsTotal + " points, "
  + (chaser.hitsTotal / (chaser.total + chaser.hitsTotal) * 100).toFixed(1) + "% of what he would have had");
console.log("without them he'd score  " + (chaser.total + chaser.hitsTotal)
  + "  → " + (chaser.total + chaser.hitsTotal > ranked[0].total ? "FIRST" : "still " + (ranked.findIndex(r => r.man.key === "chaser") + 1) + (chaser.total + chaser.hitsTotal > ranked[1].total ? " but ahead of 2nd" : "")));
