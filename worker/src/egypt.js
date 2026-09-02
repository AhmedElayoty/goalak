/* ============ THE EGYPTIAN PREMIER LEAGUE, ON A HUNDRED CALLS A DAY ============
   ESPN does not carry it (checked against its whole catalogue, 2026-09-02). API-Football does,
   on a free plan of 100 requests per UTC day and 10 per minute. Everything in this file exists
   to make that ration behave like a real feed, under two promises the owner asked for by name:
   the league must never go dark because the quota ran out, and a score must never be shown
   fresher than it is.

   HOW THE RATION IS SPENT
   - Phones never call the provider. Only the cron tick does, and every phone reads what the
     tick stored. Audience size therefore costs nothing.
   - At most ONE provider call per tick, chosen by priority: today's schedule, then a noon
     refresh (postponements announced before the 17:00 Cairo slot), then final results per slot,
     then line-ups just before kick-off, then the live poll, then the table after the last
     whistle. The order is "what a wrong or missing answer would cost".
   - The live poll's interval is not fixed. Each tick divides the calls still affordable by the
     live minutes still ahead today and polls at that pace - about every 1.4 minutes on a
     one-slot day, about every 2.7 on the usual two-slot day (measured: the league uses exactly
     two kick-off times, 14:00 and 17:00 UTC, never a third). Nothing is polled outside a live
     window, and the dead hour between the two slots is free.
   - RESERVE calls are never spent. The provider's own remaining-count header is believed over
     our counter whenever it is present; a 200 carrying `errors.requests` means "quota gone"
     and is treated as such - it is NOT an error to retry.
   - Without env.APIFOOTBALL_KEY every function here is inert: no calls, no storage, routes
     answer configured:false. The shell hides the league until that flips.

   WHAT COMES OUT
   ESPN-shaped events, summaries and standings, stamped _gkSrc:"af", so the shell, the push
   filter, the goal-hold queue and the live card treat an Egyptian match exactly like any other.
   Every stored object carries `at` (when the provider was last asked) so the client can print
   the real age instead of a clock that pretends to run. */

export const AF_LEAGUE = 233;                 /* API-Football's id for Egypt - Premier League; verified on first live call */
export const AF_HOST = "https://v3.football.api-sports.io";
export const DAILY_LIMIT = 100;
export const RESERVE = 8;                     /* never spent: retries, a late kick-off change, tomorrow's first call */
export const LIVE_WINDOW_BEFORE = 2 * 60000;  /* start watching two minutes before kick-off */
export const LIVE_WINDOW_AFTER = 115 * 60000; /* 90 + stoppage + half-time; a match past this is finals-swept instead */
export const FINALS_AT = 112 * 60000;         /* first final-results sweep for a slot */
export const LINEUP_AT = [26 * 60000, 10 * 60000];   /* two attempts: T-26 and T-10 (provider publishes 20-40 min out) */

const K = {
  budget: "egy:budget", sched: "egy:sched", fixtures: "egy:fixtures",
  live: "egy:live", lineups: "egy:lineups", standings: "egy:standings", detail: "egy:detail"
};

export function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
/* API-Football names a season by its starting year: 2026-27 is 2026. Egypt kicks off in August. */
export function seasonFor(ms) { const d = new Date(ms); return d.getUTCMonth() + 1 >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; }

/* ---------------- the ration ----------------
   budget = { day, used, remaining, exhausted }. `remaining` is the provider's header when we
   have seen one today, else DAILY_LIMIT - used. A new UTC day resets it. */
export function freshBudget(now) { return { day: utcDay(now), used: 0, remaining: DAILY_LIMIT, exhausted: false }; }
export function budgetFor(stored, now) {
  if (!stored || stored.day !== utcDay(now)) return freshBudget(now);
  return stored;
}
export function affordable(b) { return Math.max(0, (b.remaining != null ? b.remaining : DAILY_LIMIT - b.used) - RESERVE); }
/* fold a response's headers/body into the budget - the ONLY place the count moves */
export function chargeBudget(b, headers, body) {
  const out = Object.assign({}, b, { used: (b.used || 0) + 1 });
  const rem = headers && headers.get ? Number(headers.get("x-ratelimit-requests-remaining")) : NaN;
  if (Number.isFinite(rem)) out.remaining = rem; else out.remaining = Math.max(0, (b.remaining != null ? b.remaining : DAILY_LIMIT) - 1);
  const errs = body && body.errors && typeof body.errors === "object" ? body.errors : null;
  if (errs && (errs.requests || errs.rateLimit || errs.plan)) { out.remaining = 0; out.exhausted = true; }
  return out;
}

/* ---------------- what to do THIS tick (pure) ----------------
   fixtures: [{id, ko(ms), state:"pre"|"in"|"post"}] for today; sched: the bookkeeping below.
   Returns one decision {kind, ...} or null. Exactly one call per tick keeps the per-minute
   limit irrelevant and the spend smooth. */
export function planTick(now, budget, fixtures, sched) {
  const s = Object.assign({ scheduleDay: null, refreshDay: null, lastLive: 0, lineups: {}, finals: {}, standingsDay: null }, sched || {});
  const day = utcDay(now);
  const left = affordable(budget);
  if (left <= 0) return null;                                           /* the reserve is not for spending */

  /* 1. today's schedule, once. Also the schedule for the next two weeks - one call. */
  if (s.scheduleDay !== day) return { kind: "schedule" };

  const todays = (fixtures || []).filter(f => utcDay(f.ko) === day);
  const live = f => f.state !== "post" && now >= f.ko - LIVE_WINDOW_BEFORE && now <= f.ko + LIVE_WINDOW_AFTER;
  const inPlay = todays.filter(live);
  const hourUTC = new Date(now).getUTCHours();

  /* 2. one refresh before the first slot: a postponement announced at lunchtime must not leave
        the app counting down to a match that will not happen */
  if (todays.length && s.refreshDay !== day && hourUTC >= 12 && !inPlay.length && todays.some(f => now < f.ko)) return { kind: "schedule", refresh: true };

  /* 3. finals per slot: a match that has left the live window but is not FT in our copy. One
        dated call returns every fixture of the day, so this is per slot, not per match. */
  const slots = {};
  for (const f of todays) (slots[f.ko] = slots[f.ko] || []).push(f);
  for (const koStr of Object.keys(slots).sort()) {
    const ko = Number(koStr), grp = slots[koStr];
    const pending = grp.filter(f => f.state !== "post");
    /* trigger: the clock has run out, OR the live endpoint stopped listing a match we hold as
       in-play - API-Football's live feed returns only matches in progress, so a finished match
       VANISHES rather than turning FT. Without this the app would freeze at 90+5' until KO+112. */
    if (!pending.length || (now < ko + FINALS_AT && !pending.some(f => f.gone))) continue;
    const done = s.finals[koStr] || { n: 0, at: 0 };
    if (done.n < 3 && now - done.at >= 5 * 60000) return { kind: "finals", slot: ko };
  }

  /* 4. line-ups, two attempts per fixture, only if the live poll would still be affordable */
  for (const f of todays) {
    if (f.state === "post" || now >= f.ko) continue;
    const got = s.lineups[f.id] || { n: 0, have: false };
    if (got.have || got.n >= LINEUP_AT.length) continue;
    const dueAt = f.ko - LINEUP_AT[got.n];
    if (now >= dueAt && left > inPlay.length + 1) return { kind: "lineups", fixture: f.id };
  }

  /* 5. the live poll, at the pace the day can afford */
  if (inPlay.length) {
    const pendingSlots = Object.keys(slots).filter(k => slots[k].some(f => f.state !== "post")).length;
    const lineupsAhead = todays.filter(f => now < f.ko && !(s.lineups[f.id] || {}).have).length;
    const fixedAhead = pendingSlots + 1 /* standings */ + Math.min(lineupsAhead, 4);
    const liveBudget = Math.max(1, left - fixedAhead);
    /* live minutes still ahead: the union of remaining windows, slot by slot */
    let minutes = 0;
    for (const koStr of Object.keys(slots)) {
      const ko = Number(koStr);
      if (!slots[koStr].some(f => f.state !== "post")) continue;
      const end = ko + LIVE_WINDOW_AFTER, start = Math.max(now, ko - LIVE_WINDOW_BEFORE);
      if (end > start) minutes += (end - start) / 60000;
    }
    const interval = Math.min(10, Math.max(1, Math.ceil(minutes / liveBudget)));
    if (now - (s.lastLive || 0) >= interval * 60000) return { kind: "live", interval: interval };
    return null;
  }

  /* 6. the table, once, after the day's football is over */
  if (todays.length && s.standingsDay !== day && todays.every(f => f.state === "post")) return { kind: "standings" };
  return null;
}

/* ---------------- ESPN shapes ----------------
   The shell, the push filter and the goal queue all read ESPN's fields. These produce them. */
const SHORT_TO_STATE = { TBD: "pre", NS: "pre", "1H": "in", HT: "in", "2H": "in", ET: "in", BT: "in", P: "in", LIVE: "in", INT: "in", SUSP: "in",
                         FT: "post", AET: "post", PEN: "post", PST: "post", CANC: "post", ABD: "post", AWD: "post", WO: "post" };
const SHORT_TO_NAME = { TBD: "STATUS_SCHEDULED", NS: "STATUS_SCHEDULED", "1H": "STATUS_FIRST_HALF", HT: "STATUS_HALFTIME", "2H": "STATUS_SECOND_HALF",
                        ET: "STATUS_OVERTIME", BT: "STATUS_HALFTIME_ET", P: "STATUS_SHOOTOUT", LIVE: "STATUS_IN_PROGRESS", INT: "STATUS_INTERRUPTED",
                        SUSP: "STATUS_SUSPENDED", FT: "STATUS_FULL_TIME", AET: "STATUS_FINAL_AET", PEN: "STATUS_FINAL_PEN", PST: "STATUS_POSTPONED",
                        CANC: "STATUS_CANCELED", ABD: "STATUS_ABANDONED", AWD: "STATUS_FINAL", WO: "STATUS_FINAL" };
function abbr(name) { return String(name || "").replace(/^(Al|El)[ -]/i, "").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "EGY"; }
function team(t) {
  return { id: String(t.id), displayName: t.name, shortDisplayName: t.name, abbreviation: abbr(t.name), logo: t.logo || "" };
}
function clockOf(time) {
  if (!time || time.elapsed == null) return "";
  return String(time.elapsed) + (time.extra ? "+" + time.extra : "") + "'";
}
/* one API-Football fixture -> one ESPN event. `at` is when the provider was asked. */
export function toEspnEvent(f, at) {
  const fx = f.fixture || {}, st = fx.status || {}, short = String(st.short || "NS");
  const state = SHORT_TO_STATE[short] || "pre", name = SHORT_TO_NAME[short] || "STATUS_SCHEDULED";
  const home = team(f.teams.home), away = team(f.teams.away);
  const g = f.goals || {};
  const score = v => (v == null ? (state === "pre" ? "" : "0") : String(v));
  const status = { type: { state, name, completed: state === "post", shortDetail: short }, displayClock: state === "in" ? clockOf({ elapsed: st.elapsed }) : "" };
  const details = [];
  for (const ev of f.events || []) {
    const type = String(ev.type || ""), detail = String(ev.detail || "");
    const who = ev.player && ev.player.name ? [{ id: String(ev.player.id || ""), displayName: ev.player.name, shortName: ev.player.name }] : [];
    if (ev.assist && ev.assist.name) who.push({ id: String(ev.assist.id || ""), displayName: ev.assist.name, shortName: ev.assist.name });
    const base = { type: { text: detail || type }, clock: { displayValue: clockOf(ev.time) }, team: { id: String((ev.team || {}).id || "") }, athletesInvolved: who, shootout: false };
    if (type === "Goal") {
      if (/missed/i.test(detail)) continue;                          /* a miss is not a scoring play; it lives in keyEvents */
      details.push(Object.assign(base, { scoringPlay: true, ownGoal: /own/i.test(detail), penaltyKick: /penalty/i.test(detail) }));
    } else if (type === "Card") {
      details.push(Object.assign(base, { scoringPlay: false, redCard: /red/i.test(detail), yellowCard: /yellow/i.test(detail), type: { text: /red/i.test(detail) ? "Red Card" : "Yellow Card" } }));
    }
  }
  const comp = {
    id: String(fx.id), date: fx.date, status,
    competitors: [
      { id: home.id, homeAway: "home", team: home, score: score(g.home), winner: f.teams.home.winner === true },
      { id: away.id, homeAway: "away", team: away, score: score(g.away), winner: f.teams.away.winner === true }
    ],
    details, notes: [],
    venue: fx.venue && fx.venue.name ? { fullName: fx.venue.name, address: { city: fx.venue.city || "" } } : undefined
  };
  return { id: String(fx.id), uid: "s:600~l:af233~e:" + fx.id, date: fx.date, name: home.displayName + " vs " + away.displayName,
           shortName: away.abbreviation + " @ " + home.abbreviation, status, competitions: [comp],
           _gkSrc: "af", _gkLeagueId: "egy", _gkAt: at };
}
/* line-ups + events -> the summary shape the match sheet reads (rosters, keyEvents) */
export function toEspnSummary(f, lineups, at) {
  const rosters = [];
  for (const side of lineups || []) {
    const roster = [];
    const push = (p, starter, place) => roster.push({ starter, formationPlace: String(starter ? place : 0),
      jersey: p.player && p.player.number != null ? String(p.player.number) : "",
      position: { abbreviation: (p.player && p.player.pos) || "" },
      athlete: { id: String((p.player || {}).id || ""), displayName: (p.player || {}).name || "", shortName: (p.player || {}).name || "" } });
    (side.startXI || []).forEach((p, i) => push(p, true, i + 1));
    (side.substitutes || []).forEach(p => push(p, false, 0));
    rosters.push({ team: { id: String((side.team || {}).id || ""), displayName: (side.team || {}).name || "" },
                   formation: side.formation || "", roster });
  }
  const keyEvents = [];
  for (const ev of f.events || []) {
    const type = String(ev.type || ""), detail = String(ev.detail || "");
    const clock = { displayValue: clockOf(ev.time) };
    const tm = { id: String((ev.team || {}).id || "") };
    const P = (p) => ({ athlete: { id: String((p || {}).id || ""), displayName: (p || {}).name || "", shortName: (p || {}).name || "" } });
    if (type === "subst") keyEvents.push({ type: { type: "substitution", text: "Substitution" }, clock, team: tm, participants: [P(ev.assist), P(ev.player)] });
    else if (type === "Goal" && /missed/i.test(detail)) keyEvents.push({ type: { type: "penalty - missed", text: "Penalty missed" }, clock, team: tm, participants: [P(ev.player)] });
    else if (type === "Goal") keyEvents.push({ type: { type: "goal", text: detail || "Goal" }, clock, team: tm, participants: [P(ev.player), P(ev.assist)] });
    else if (type === "Var") keyEvents.push({ type: { type: "var", text: "VAR - " + detail }, clock, team: tm, participants: [P(ev.player)] });
  }
  return { rosters, keyEvents, boxscore: { teams: [] }, _gkSrc: "af", _gkAt: at };
}
/* API-Football standings -> ESPN standings (children[0].standings.entries[]) */
export function toEspnStandings(afResponse, at) {
  const league = ((afResponse || [])[0] || {}).league || {};
  const table = ((league.standings || [])[0]) || [];
  const stat = (name, value, display) => ({ name, value, displayValue: display != null ? String(display) : String(value) });
  const entries = table.map(r => {
    const all = r.all || {}, goals = all.goals || {};
    return { team: { id: String((r.team || {}).id || ""), displayName: (r.team || {}).name || "", shortDisplayName: (r.team || {}).name || "", abbreviation: abbr((r.team || {}).name) },
      stats: [stat("rank", r.rank), stat("gamesPlayed", all.played), stat("wins", all.win), stat("ties", all.draw), stat("losses", all.lose),
              stat("pointsFor", goals.for), stat("pointsAgainst", goals.against), stat("pointDifferential", r.goalsDiff, (r.goalsDiff > 0 ? "+" : "") + r.goalsDiff),
              stat("points", r.points)] };
  });
  return { children: [{ name: league.name || "Egyptian Premier League", standings: { entries } }], _gkSrc: "af", _gkAt: at };
}

/* ---------------- the provider ----------------
   The only function that spends. Returns {body, headers} or null on a transport failure. */
async function afGet(env, path) {
  const r = await fetch(AF_HOST + path, { headers: { "x-apisports-key": env.APIFOOTBALL_KEY }, signal: AbortSignal.timeout(8000) });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, headers: r.headers, body };
}
const rows = body => (body && Array.isArray(body.response)) ? body.response : [];
const slim = f => ({ id: String(f.fixture.id), ko: Date.parse(f.fixture.date) || 0, state: SHORT_TO_STATE[String((f.fixture.status || {}).short || "NS")] || "pre" });

/* ---------------- the tick ----------------
   Called once a minute from runOnce. Makes at most one provider call, updates storage, and
   returns today's board as ESPN events for the push machinery. Inert without a key. */
export async function egyptTick(env, store, now, log) {
  if (!env || !env.APIFOOTBALL_KEY || !store) return null;
  let budget = budgetFor(await store.get(K.budget), now);
  const sched = Object.assign({ scheduleDay: null, refreshDay: null, lastLive: 0, lineups: {}, finals: {}, standingsDay: null }, (await store.get(K.sched)) || {});
  const fixtures = (await store.get(K.fixtures)) || { at: 0, list: [] };
  const live = (await store.get(K.live)) || { at: 0, byId: {}, gone: {} };
  live.gone = live.gone || {};
  const day = utcDay(now);
  /* a new day forgets yesterday's per-fixture bookkeeping so the objects cannot grow for a season */
  if (sched.scheduleDay && sched.scheduleDay !== day) { sched.lineups = {}; sched.finals = {}; }

  const slimToday = fixtures.list.map(f => { const s = slim(f); const l = live.byId[s.id]; if (l) s.state = slim(l).state; s.gone = !!live.gone[s.id]; return s; });
  const plan = planTick(now, budget, slimToday, sched);
  const spend = async (path) => {
    const r = await afGet(env, path).catch(() => null);
    if (!r) { if (log) log.push("egy:" + path.split("?")[0] + ":ERR"); return null; }
    budget = chargeBudget(budget, r.headers, r.body);
    await store.put(K.budget, budget);
    if (budget.exhausted) { if (log) log.push("egy:quota"); return null; }
    if (!r.ok) { if (log) log.push("egy:" + r.status); return null; }
    return r.body;
  };
  const season = seasonFor(now);

  if (plan && plan.kind === "schedule") {
    const from = utcDay(now - 86400000), to = utcDay(now + 14 * 86400000);
    const body = await spend("/fixtures?league=" + AF_LEAGUE + "&season=" + season + "&from=" + from + "&to=" + to + "&timezone=UTC");
    if (body) {
      const list = rows(body);
      /* a finished fixture in this list is also the final result - fold it into the live copy */
      for (const f of list) if (slim(f).state === "post") live.byId[String(f.fixture.id)] = f;
      await store.put(K.fixtures, { at: now, list });
      await store.put(K.live, { at: live.at, byId: live.byId });
      sched.scheduleDay = day; if (plan.refresh) sched.refreshDay = day;
    } else if (!plan.refresh && fixtures.list.length) sched.scheduleDay = day;   /* keep yesterday's window rather than retry every minute */
  } else if (plan && plan.kind === "finals") {
    const body = await spend("/fixtures?league=" + AF_LEAGUE + "&season=" + season + "&date=" + day + "&timezone=UTC");
    const f = sched.finals[String(plan.slot)] || { n: 0, at: 0 }; f.n++; f.at = now; sched.finals[String(plan.slot)] = f;
    if (body) { for (const fx of rows(body)) { live.byId[String(fx.fixture.id)] = fx; if (slim(fx).state === "post") delete live.gone[String(fx.fixture.id)]; } live.at = now; await store.put(K.live, live); }
  } else if (plan && plan.kind === "lineups") {
    const body = await spend("/fixtures/lineups?fixture=" + plan.fixture);
    const l = sched.lineups[plan.fixture] || { n: 0, have: false }; l.n++;
    if (body && rows(body).length >= 2 && rows(body).every(s => (s.startXI || []).length >= 11)) {
      l.have = true;
      const all = (await store.get(K.lineups)) || {};
      all[plan.fixture] = { at: now, data: rows(body) };
      /* keep only today's and yesterday's line-ups */
      for (const id of Object.keys(all)) if (now - (all[id].at || 0) > 2 * 86400000) delete all[id];
      await store.put(K.lineups, all);
    }
    sched.lineups[plan.fixture] = l;
  } else if (plan && plan.kind === "live") {
    const body = await spend("/fixtures?live=" + AF_LEAGUE + "&timezone=UTC");
    sched.lastLive = now;
    if (body) {
      const seen = new Set();
      for (const fx of rows(body)) { const id = String(fx.fixture.id); seen.add(id); live.byId[id] = fx; delete live.gone[id]; }
      /* a match we hold as in-play that the live feed no longer lists has (almost certainly)
         finished - flag it so the next tick asks the dated endpoint for its final score. We do
         NOT write FT ourselves: a guess is a wrong update, and the owner asked for none. */
      for (const s of slimToday) if (s.state === "in" && !seen.has(s.id) && utcDay(s.ko) === day) live.gone[s.id] = true;
      live.at = now; await store.put(K.live, live);
    }
  } else if (plan && plan.kind === "standings") {
    const body = await spend("/standings?league=" + AF_LEAGUE + "&season=" + season);
    sched.standingsDay = day;
    if (body && rows(body).length) await store.put(K.standings, { at: now, data: rows(body) });
  }
  await store.put(K.sched, sched);

  /* today's board, from whatever we hold - the freshest copy of each fixture */
  const events = fixtures.list.filter(f => utcDay(Date.parse(f.fixture.date)) === day)
    .map(f => toEspnEvent(live.byId[String(f.fixture.id)] || f, live.byId[String(f.fixture.id)] ? live.at : fixtures.at));
  return { events, _gkSrc: "af" };
}

/* ---------------- readers for the phones (no provider calls, ever) ---------------- */
export async function egyStatus(env, store, now) {
  const configured = !!(env && env.APIFOOTBALL_KEY);
  const b = store ? budgetFor(await store.get(K.budget), now) : null;
  return { ok: true, configured, day: b ? b.day : null, used: b ? b.used : 0, remaining: b ? b.remaining : null, exhausted: !!(b && b.exhausted), reserve: RESERVE };
}
export async function egyBoard(store, dayStr) {
  const fixtures = (await store.get(K.fixtures)) || { at: 0, list: [] };
  const live = (await store.get(K.live)) || { at: 0, byId: {} };
  const events = fixtures.list.filter(f => !dayStr || utcDay(Date.parse(f.fixture.date)) === dayStr)
    .map(f => toEspnEvent(live.byId[String(f.fixture.id)] || f, live.byId[String(f.fixture.id)] ? live.at : fixtures.at));
  return { events, at: Math.max(fixtures.at || 0, live.at || 0), _gkSrc: "af" };
}
export async function egySummary(store, fixtureId) {
  const live = (await store.get(K.live)) || { byId: {} };
  const fixtures = (await store.get(K.fixtures)) || { list: [] };
  const f = live.byId[String(fixtureId)] || fixtures.list.find(x => String(x.fixture.id) === String(fixtureId));
  if (!f) return null;
  const all = (await store.get(K.lineups)) || {};
  const lu = all[String(fixtureId)];
  return toEspnSummary(f, lu ? lu.data : [], Math.max(live.at || 0, lu ? lu.at : 0));
}
export async function egyStandings(store) {
  const s = await store.get(K.standings);
  return s ? toEspnStandings(s.data, s.at) : null;
}
