/* ============ THE EGYPTIAN PREMIER LEAGUE, FROM FILGOAL'S OWN PAGES ============
   Every paid road to Egyptian data was closed to us (see egypt.js and CLAUDE.md); the owner asked
   for a free one. FilGoal's day page embeds the day's matches as JSON - `var viewModelData = [...]`
   - with Arabic club names, kick-off, score, minute and status, refreshed on their side every 28
   seconds, and it answers a fetch from Cloudflare's edge with a plain 200. This module reads that
   JSON, keeps only the Egyptian league (ChampionshipId 1667), and stores it in the SAME shape
   egypt.js stores API-Football fixtures in, so every route, adapter and shell branch built for the
   Egyptian league works unchanged. It is a publisher's page, not an API: the parser is defensive,
   polls politely (one request a minute only while a match is on, a handful a day otherwise), and
   fails to "no update" rather than to a wrong one. Unofficial by nature - friends-and-family only. */

export const FG_LEAGUE_ID = 1667;
/* FilGoal names clubs in Arabic. The shell keys its Arabic names on ENGLISH names (AR_TEAMS), and
   the English interface needs English, so every club we know travels in English; an unknown one
   travels as FilGoal wrote it rather than being dropped. */
export const EGY_EN = { "الأهلي": "Al Ahly", "الزمالك": "Zamalek", "بيراميدز": "Pyramids", "المصري": "Al Masry", "الإسماعيلي": "Ismaily", "سموحة": "Smouha",
  "إنبي": "ENPPI", "بتروجت": "Petrojet", "فاركو": "Pharco", "زد": "ZED", "وادي دجلة": "Wadi Degla", "الجونة": "El Gouna", "القناة": "El Qanah",
  "المقاولون العرب": "Al Mokawloon Al Arab", "طلائع الجيش": "Talaea El Gaish", "غزل المحلة": "Ghazl El Mahalla", "الاتحاد السكندري": "Al Ittihad Alexandria",
  "سيراميكا كليوباترا": "Ceramica Cleopatra", "مودرن سبورت": "Modern Sport", "أبو قير للأسمدة": "Abu Qir Fertilizers", "كهرباء الإسماعيلية": "Kahrabaa Ismailia",
  "بترول أسيوط": "Asyut Petroleum", "البنك الأهلي": "National Bank of Egypt", "حرس الحدود": "Haras El Hodood", "الداخلية": "El Dakhleya", "مصر المقاصة": "Misr Lel Makkasa",
  "الشرقية للدخان": "Eastern Company", "أسوان": "Aswan", "الإنتاج الحربي": "El Entag El Harby", "طنطا": "Tanta", "الشرقية إنبي": "Sharkia ENPPI", "نجوم": "Nogoom" };
export const enName = ar => EGY_EN[String(ar || "").trim()] || String(ar || "");
const FG_HOST = "https://www.filgoal.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const K = { fixtures: "egy:fixtures", live: "egy:live", fg: "egy:fg" };

export function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

/* the JSON sits after `var viewModelData = `; walk it with a bracket counter that respects strings */
/* THE TICK'S CPU IS THE SCARCE THING. The character-by-character bracket walk over a 460 KB page,
   plus one over a 260 KB match page per started match, killed the cron invocation once three matches
   had started (2026-09-02, 16:31-17:30: the board froze, "not started" at kick-off, commentary running).
   The statement ends in "];" / "};" - slice there and let the native parser do the work; the walk is
   only the fallback for a page where that guess fails. */
function sliceJson(html, start, closer) {
  const end = html.indexOf(closer + ";", start);
  if (end < 0) return null;
  try { return JSON.parse(html.slice(start, end + 1)); } catch (_) { return null; }
}
export function extractViewModel(html) {
  const i = html.indexOf("var viewModelData = ");
  if (i < 0) return null;
  let j = i + "var viewModelData = ".length;
  while (j < html.length && html[j] !== "[") j++;
  const quick = sliceJson(html, j, "]");
  if (quick) return quick;
  let depth = 0, inStr = false, esc = false, k = j;
  for (; k < html.length; k++) {
    const ch = html[k];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") { depth--; if (depth === 0) { k++; break; } }
  }
  try { return JSON.parse(html.slice(j, k)); } catch (_) { return null; }
}
const msOf = v => { const m = /\/Date\((\d+)\)\//.exec(String(v || "")); return m ? +m[1] : (Date.parse(v) || 0); };

/* one FilGoal match -> the API-Football fixture shape egypt.js already speaks */
export function fgToFixture(m, now) {
  const ko = msOf(m.Date);
  const text = String(m.CurrentMatchStatusText || "").toLowerCase();
  /* THE MINUTE LIVES IN CurrentMatchStatus, not at the top level (measured on a running match: the
     top-level TimeElapsed is absent; CurrentMatchStatus carries TimeElapsed.Minutes since the half
     began plus TimeElapsedBeforeStatus, 45 in the second half). Reading the wrong one showed 0'. */
  const cms = m.CurrentMatchStatus || {};
  const statusName = String(cms.MatchStatusName || m.MatchStatusName || "");
  const te = cms.TimeElapsed || m.TimeElapsed || null;
  const mins = te && te.Minutes != null ? (+te.Minutes || 0) + (+cms.TimeElapsedBeforeStatus || 0) : 0;
  const scored = m.HomeScore != null && m.AwayScore != null;
  let short = "NS", elapsed = null;
  if (text === "over" || /انتهت/.test(statusName)) short = "FT";
  else if (/استراحة|بين الشوطين/.test(statusName)) { short = "HT"; elapsed = 45; }
  else if (text === "live" || (scored && ko && now > ko && now < ko + 3 * 3600000 && mins > 0)) {
    const second = /الثاني|التاني/.test(statusName) || (+cms.TimeElapsedBeforeStatus || 0) >= 45;
    elapsed = Math.max(1, second ? Math.max(46, mins || 46) : Math.min(45, mins || 1));
    short = second ? "2H" : "1H";
  }
  else if (/تأجلت|ألغيت/.test(statusName)) short = "PST";
  const st = { short, elapsed, long: statusName };
  return {
    fixture: { id: +m.Id, date: new Date(ko).toISOString(), status: st, venue: { name: m.StadiumName || null, city: null } },
    league: { id: +m.ChampionshipId || FG_LEAGUE_ID, name: m.ChampionshipName || "الدوري المصري", nameEn: +m.ChampionshipId === FG_LEAGUE_ID ? "Egyptian Premier League" : (CUP_EN[Object.keys(CUP_EN).find(k => String(m.ChampionshipName || "").indexOf(k) >= 0)] || m.ChampionshipName), country: "Egypt", season: new Date(ko).getUTCMonth() >= 6 ? new Date(ko).getUTCFullYear() : new Date(ko).getUTCFullYear() - 1, round: m.Week ? "Regular Season - " + m.Week : "" },
    teams: { home: { id: +m.HomeTeamId, name: enName(m.HomeTeamName), nameAr: m.HomeTeamName, logo: m.HomeTeamLogoUrl ? "https:" + String(m.HomeTeamLogoUrl).replace(/^https?:/, "") : "", winner: short === "FT" ? m.HomeScore > m.AwayScore : null },
             away: { id: +m.AwayTeamId, name: enName(m.AwayTeamName), nameAr: m.AwayTeamName, logo: m.AwayTeamLogoUrl ? "https:" + String(m.AwayTeamLogoUrl).replace(/^https?:/, "") : "", winner: short === "FT" ? m.AwayScore > m.HomeScore : null } },
    goals: { home: short === "NS" ? null : (m.HomeScore == null ? 0 : +m.HomeScore), away: short === "NS" ? null : (m.AwayScore == null ? 0 : +m.AwayScore) },
    events: [], _fg: { text, status: m.Status, name: m.MatchStatusName }
  };
}
/* the league itself, plus the domestic cups an Egyptian club plays in (Egypt Cup, Super Cup, League
   Cup). CAF competitions are NOT taken from here: ESPN already carries them and the Top Clubs bucket
   shows them, so taking them twice would print the same match twice. */
const CUP_RE = /كأس مصر|كأس السوبر المصري|السوبر المصري|كأس الرابطة المصرية|كأس رابطة الأندية/;
const CUP_EN = { "كأس مصر": "Egypt Cup", "كأس السوبر المصري": "Egyptian Super Cup", "السوبر المصري": "Egyptian Super Cup", "كأس الرابطة المصرية": "Egyptian League Cup", "كأس رابطة الأندية": "Egyptian League Cup" };
export function wanted(m) {
  if (!m || !m.Id || !m.HomeTeamName || !m.AwayTeamName) return false;
  if (+m.ChampionshipId === FG_LEAGUE_ID) return true;
  const nm = String(m.ChampionshipName || "");
  return CUP_RE.test(nm) && (EGY_EN[String(m.HomeTeamName).trim()] || EGY_EN[String(m.AwayTeamName).trim()]);
}
export function parseDay(html, now) {
  const vm = extractViewModel(html);
  if (!Array.isArray(vm)) return null;
  const out = [];
  for (const day of vm) for (const m of (day && day.Matches) || []) if (wanted(m)) out.push(fgToFixture(m, now));
  return out;
}

/* what THIS tick should fetch: the live day page while a match is in its window; the schedule
   for the coming week once a day; nothing else. Pure, so it is testable. */
export function fgPlan(now, state, fixtures) {
  const s = Object.assign({ lastLive: 0, scheduleDay: null, lastWeekly: 0 }, state || {});
  const day = utcDay(now);
  const todays = (fixtures || []).filter(f => utcDay(Date.parse(f.fixture.date)) === day);
  const inWindow = todays.some(f => { const ko = Date.parse(f.fixture.date); return f.fixture.status.short !== "FT" && now >= ko - 5 * 60000 && now <= ko + 125 * 60000; });
  if (inWindow && now - s.lastLive >= 60000) return { kind: "live", day };
  if (s.scheduleDay !== day) return { kind: "schedule", day };           /* the week ahead, once a day */
  if (!inWindow && todays.length && now - s.lastLive >= 30 * 60000) return { kind: "live", day };   /* a quiet half-hourly look on match days (postponements, kick-off changes) */
  return null;
}

async function fgFetch(path) {
  const r = await fetch(FG_HOST + path, { headers: { "user-agent": UA, "accept": "text/html", "accept-language": "ar,en;q=0.8" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("filgoal " + r.status);
  return await r.text();
}

/* the tick: at most one page a minute; writes the egypt.js store; returns today's board */
export async function filgoalTick(env, store, now, log, toEspnEvent) {
  const state = (await store.get(K.fg)) || { lastLive: 0, scheduleDay: null, statuses: {} };
  const fixtures = (await store.get(K.fixtures)) || { at: 0, list: [] };
  const live = (await store.get(K.live)) || { at: 0, byId: {} };
  /* stored copies from before a field existed (English names, then crests) are re-read once */
  const stale = f => f && f.teams && f.teams.home && (f.teams.home.nameAr === undefined || f.teams.home.logo === undefined);
  if (fixtures.list.some(stale) || Object.values(live.byId).some(stale) || !((await store.get(KIDX)) || {}).span) state.scheduleDay = null;   /* no twin index yet (or an old, narrower one): build it */   /* stored before English names existed: re-read once */
  const plan = fgPlan(now, state, fixtures.list);
  const day = utcDay(now);
  try {
    if (plan && plan.kind === "schedule") {
      /* eight pages in PARALLEL, each on its own: in sequence they overran the tick's time budget and one
         slow page aborted the whole read (2026-09-02: the English names never landed). A day that fails
         keeps yesterday's copy of itself; the read counts as done when today's page arrived. */
      /* ONE page. FilGoal ignores ?date= (measured 2026-09-02: three different dates returned the same
         61 match ids) and its matches page carries yesterday, today and tomorrow together - so the ten
         "day pages" this once fetched were ten copies of the same thing. One request, three days. */
      const h0 = await fgFetch("/matches");
      const list = parseDay(h0, now) || [], idxRows = indexRows(h0);
      const okDays = new Set(idxRows.map(r => utcDay(r.ko)));
      if (idxRows.length) { const prev = (await store.get(KIDX)) || { rows: [] }; const keep = prev.rows.filter(r => !okDays.has(utcDay(r.ko))); await store.put(KIDX, { at: now, span: 10, rows: keep.concat(idxRows).slice(-1500) }); }
      for (const f of fixtures.list) if (!okDays.has(utcDay(Date.parse(f.fixture.date)))) list.push(f);   /* keep what a failed day already had */
      if (!idxRows.length) throw new Error("matches page unreadable");
      const seen = new Set();
      fixtures.list = list.filter(f => !seen.has(f.fixture.id) && seen.add(f.fixture.id));
      fixtures.at = now; fixtures.league = { id: FG_LEAGUE_ID, name: "الدوري المصري", country: "Egypt", season: fixtures.list[0] ? fixtures.list[0].league.season : null, via: "filgoal" };
      /* the schedule read is the freshest copy of EVERY match it lists; the live copy must not outrank it
         (it did once: live copies stored before names travelled in English kept winning after the re-read) */
      for (const f of fixtures.list) live.byId[String(f.fixture.id)] = f;
      live.at = now;
      await store.put(K.fixtures, fixtures); await store.put(K.live, live);
      state.scheduleDay = day; state.lastLive = now; state.lastError = null;
      /* match pages are cached one per match for ever otherwise: drop those older than three days */
      try { const old = await store.list({ prefix: KM }); for (const [k, v] of old) if (!v || now - (v.at || 0) > 3 * 86400000) await store.delete(k); } catch (_) {}
    } else if (plan && plan.kind === "live") {
      const dayHtml = await fgFetch("/matches");
      const rows = parseDay(dayHtml, now);
      { const all = indexRows(dayHtml); if (all.length) { const prev = (await store.get(KIDX)) || { rows: [] }; await store.put(KIDX, { at: now, rows: prev.rows.filter(r => utcDay(r.ko) !== day).concat(all).slice(-1200) }); } }
      if (rows) {
        /* events for started matches come from their match pages - ONE page per tick, the stalest first,
           so two or three live matches take turns and the tick never outgrows its CPU allowance */
        const budget = { fetches: 1 };
        const started = rows.filter(f => f.fixture.status.short !== "NS" && f.fixture.status.short !== "PST");
        const ages = await Promise.all(started.map(async f => { const c = await store.get(KM + String(f.fixture.id)); return { f, at: c && c.pv === FGM_PV ? c.at : 0, over: !!(c && c.over) }; }));
        ages.sort((a, b) => a.at - b.at);
        for (const { f } of ages) {
          const m = await fgMatch(store, f.fixture.id, now, budget).catch(() => null);
          if (m && m.events) { f.events = fgEventsToAf(m.events, f); f._fgComments = m.comments ? m.comments.length : 0; }

          else { const prev = live.byId[String(f.fixture.id)]; if (prev && prev.events) f.events = prev.events; }   /* keep last known events */
        }
        for (const f of rows) {
          live.byId[String(f.fixture.id)] = f;
          state.statuses[f._fg.text || "?"] = (state.statuses[f._fg.text || "?"] || 0) + 1;   /* which status words the page uses - read via /api/egy/status */
          const i = fixtures.list.findIndex(x => x.fixture.id === f.fixture.id);
          if (i >= 0) fixtures.list[i] = f; else fixtures.list.push(f);
        }
        live.at = now; await store.put(K.live, live); await store.put(K.fixtures, fixtures);
      } else if (log) log.push("fg:parse");
      state.lastLive = now;
    }
  } catch (e) { if (log) log.push("fg:" + ((e && e.message) || "err")); state.lastError = String((e && e.message) || e); state.lastErrorAt = now; }
  await store.put(K.fg, state);
  const events = fixtures.list.filter(f => utcDay(Date.parse(f.fixture.date)) === day)
    .map(f => toEspnEvent(live.byId[String(f.fixture.id)] || f, live.byId[String(f.fixture.id)] ? live.at : fixtures.at, 1));
  return { events, _gkSrc: "af" };
}
export async function fgStatus(store) { const st = (await store.get(K.fg)) || null; const idx = (await store.get("egy:fgidx")) || null; return st ? Object.assign({}, st, { twinIndex: idx ? { rows: idx.rows.length, at: idx.at, span: idx.span || 8 } : null }) : st; }

/* ============ COMMENTARY, EVENTS AND CLIPS FROM A MATCH PAGE ============
   Every FilGoal match page embeds one JSON object - {"TimeZoneConsidered":true,"Id":<id>,...} - with
   Comments (minute, Arabic text, sometimes a ContentUrl that is a goal clip), typed Events, coaches
   and formations. The day pages we already read list EVERY competition FilGoal follows, so an index
   of (date, Arabic home, Arabic away) -> match id lets a European match in the app find its FilGoal
   twin and borrow the commentary. A page is fetched at most once a minute while live and once a
   day once finished, whoever asks. */
const KIDX = "egy:fgidx", KM = "egy:fgm:";
export const norm = s => String(s || "").replace(/[\u064B-\u0652\u0640]/g, "").replace(/^(ال|نادي )/, "").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\u0621-\u064A0-9a-z]/gi, "").toLowerCase();
export function indexRows(html) {
  const vm = extractViewModel(html); const out = [];
  if (!Array.isArray(vm)) return out;
  for (const day of vm) for (const m of (day && day.Matches) || []) if (m && m.Id && m.HomeTeamName && m.AwayTeamName)
    out.push({ id: +m.Id, ko: msOf(m.Date), h: m.HomeTeamName, a: m.AwayTeamName, c: m.ChampionshipName || "", eg: +m.ChampionshipId === FG_LEAGUE_ID });
  return out;
}
export function findTwin(rows, hAr, aAr, ko) {
  const H = norm(hAr), A = norm(aAr); if (!H || !A) return null;
  const near = r => Math.abs(r.ko - ko) <= 3 * 3600000;
  const fits = (x, y) => x === y || (x.length > 3 && y.length > 3 && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0));
  let best = null;
  for (const r of rows || []) {
    if (!near(r)) continue;
    const fh = fits(norm(r.h), H), fa = fits(norm(r.a), A);
    if (fh && fa) return r;
    if ((fh || fa) && Math.abs(r.ko - ko) <= 30 * 60000 && !best) best = r;
  }
  return best;
}
export const FGM_PV = 4;   /* 4: squads and formations */   /* parse version: bump when the cached shape changes so a day-old cache is re-read */
export function parseMatchBlob(html, id) {
  const i = html.indexOf('{"TimeZoneConsidered":true,"Id":' + id);
  if (i < 0) return null;
  const quick = sliceJson(html, i, "}");
  if (quick && quick.Id == id) return shapeMatch(quick, id);
  let depth = 0, inStr = false, esc = false, k = i;
  for (; k < html.length; k++) {
    const ch = html[k];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === "{" || ch === "[") depth++; else if (ch === "}" || ch === "]") { depth--; if (depth === 0) { k++; break; } }
  }
  let b; try { b = JSON.parse(html.slice(i, k)); } catch (_) { return null; }
  return shapeMatch(b, id);
}
function shapeMatch(b, id) {
  const over = String(b.CurrentMatchStatusText || "").toLowerCase() === "over" || /انتهت/.test(String((b.CurrentMatchStatus && b.CurrentMatchStatus.MatchStatusName) || b.MatchStatusName || ""));
  /* ContentUrl is NOT a URL: it is the embed HTML of a tweet or a video (a <blockquote class="twitter-tweet">
     ending in the status link). Handed to an <a href> as-is it became a relative path on goallak.com, a
     404, and the offline page - the owner saw exactly that. Pull the first absolute link out of it. */
  const linkOf = v => { const str = String(v || "").trim(); if (!str) return ""; if (/^https?:\/\//i.test(str)) return str; if (/^\/\//.test(str)) return "https:" + str;
    const all = str.match(/https?:\/\/[^\s"'<>]+/g) || []; const pick = all.find(u => /twitter\.com\/[^/]+\/status|x\.com\/[^/]+\/status|youtu\.be|youtube\.com\/(watch|shorts|embed)|filgoal\.com\/videos/i.test(u)) || all.find(u => !/twitter\.com\/?$|x\.com\/?$/i.test(u)) || ""; return pick.replace(/\?ref_src=[^&]*$/, ""); };
  /* FilGoal counts a comment's Time from the start of ITS HALF: "55'" at full time is 45 + 10. The absolute
     minute is Time plus what the half started at; the break itself is labelled, not numbered. */
  const base = st => /الثاني|التاني/.test(st) ? 45 : /إضافي/.test(st) ? 90 : /ركلات/.test(st) ? 120 : 0;
  const comments = (b.Comments || []).map(c => { const st = String(c.MatchStatusName || ""); const t = c.Time == null ? null : +c.Time; const ht = /استراحة|بين الشوطين/.test(st);
    return { t, m: t == null ? null : (ht ? 45 : t + base(st)), ht, txt: String(c.Content || "").trim(), url: linkOf(c.ContentUrl), st }; }).filter(c => c.txt);
  const events = (b.Events || []).map(e => ({ type: e.MatchEventTypeName || "", team: e.TeamName || "", teamId: e.TeamId != null ? +e.TeamId : null, player: e.PlayerAName || "", player2: e.PlayerBName || "", min: e.Minute != null ? +e.Minute : (e.Time != null ? +e.Time : null),
    goal: /هدف/.test(e.MatchEventTypeName || "") && !/ضائع|مهدر/.test(e.MatchEventTypeName || ""), red: /حمراء/.test(e.MatchEventTypeName || ""), yellow: /صفراء/.test(e.MatchEventTypeName || ""), sub: /تبديل/.test(e.MatchEventTypeName || "") }));
  /* BOTH SQUADS, from the same page - the line-ups tab said "waiting" for Egyptian matches although the
     eleven and the bench were sitting in HomeTeamSquad / HomeTeamSpareSquad all along. Positions are
     Arabic words; the pitch wants a letter. */
  const posOf = p => /حارس/.test(p) ? "G" : /مدافع|ظهير|قلب/.test(p) ? "D" : /وسط|صانع|ارتكاز/.test(p) ? "M" : /مهاجم|جناح|هجوم|رأس/.test(p) ? "F" : "M";
  const one = (list, spare) => (list || []).filter(x => x && x.PersonName).sort((x, y) => (+x.Order || 0) - (+y.Order || 0))
    .map(x => ({ player: { id: x.PersonId != null ? +x.PersonId : null, name: x.PersonName, number: x.ShirtNumber != null ? +x.ShirtNumber : null, pos: posOf(String(x.PlayerPositionName || "")), grid: null, captain: !!x.IsCaptin, photo: x.PersonLogoUrl || "" } }));
  const side = (teamId, teamName, sq, sp, form, coach) => ({ team: { id: teamId != null ? +teamId : null, name: teamName }, formation: form || "", coach: { name: coach || "" },
    startXI: one((sq || []).filter(x => !x.IsSpare), false), substitutes: one((sp || []).concat((sq || []).filter(x => x.IsSpare)), true) });
  const lineups = ((b.HomeTeamSquad || []).length || (b.AwayTeamSquad || []).length)
    ? [side(b.HomeTeamId, b.HomeTeamName, b.HomeTeamSquad, b.HomeTeamSpareSquad, b.HomeTeamFormationName, b.HomeTeamCoachName), side(b.AwayTeamId, b.AwayTeamName, b.AwayTeamSquad, b.AwayTeamSpareSquad, b.AwayTeamFormationName, b.AwayTeamCoachName)]
    : [];
  return { pv: FGM_PV, id: +id, lineups, home: b.HomeTeamName, away: b.AwayTeamName, homeEn: enName(b.HomeTeamName), awayEn: enName(b.AwayTeamName), hs: b.HomeScore, as: b.AwayScore, over, coachH: b.HomeTeamCoachName || "", coachA: b.AwayTeamCoachName || "", formH: b.HomeTeamFormationName || "", formA: b.AwayTeamFormationName || "", comments, events };
}
/* FilGoal's typed events -> the API-Football event shape egypt.js already turns into ESPN details:
   a goal (normal / penalty / own goal / missed penalty), a card, a substitution (A off, B on). */
export function fgEventsToAf(events, f) {
  const out = [];
  for (const e of events || []) {
    const t = String(e.type || "");
    let type = null, detail = "";
    if (/ضائع|مهدر|أهدر/.test(t)) { type = "Goal"; detail = "Missed Penalty"; }   /* FilGoal types a miss without the word goal */
    else if (/هدف/.test(t)) { type = "Goal"; detail = /جزاء/.test(t) ? "Penalty" : /مرماه|عكسي|ذاتي/.test(t) ? "Own Goal" : "Normal Goal"; }
    else if (/حمراء/.test(t)) { type = "Card"; detail = "Red Card"; }
    else if (/صفراء/.test(t)) { type = "Card"; detail = "Yellow Card"; }
    else if (/تبديل/.test(t)) { type = "subst"; detail = "Substitution"; }
    if (!type) continue;
    let teamId = e.teamId;
    if (teamId == null && f && f.teams) { const n = norm(e.team); teamId = norm(f.teams.home.nameAr || f.teams.home.name) === n ? f.teams.home.id : norm(f.teams.away.nameAr || f.teams.away.name) === n ? f.teams.away.id : null; }
    out.push({ time: { elapsed: e.min != null ? +e.min : null, extra: null }, team: { id: teamId, name: e.team }, player: { id: null, name: e.player || "" }, assist: { id: null, name: e.player2 || "" }, type, detail });
  }
  return out.slice(0, 80);
}
export async function fgMatch(store, id, now, budget) {
  id = String(id).replace(/[^0-9]/g, ""); if (!id) return null;
  const cached = await store.get(KM + id);
  if (cached && cached.pv === FGM_PV && (now - cached.at < (cached.over ? 86400000 : 60000))) return cached;
  if (budget && budget.fetches <= 0) return cached || null;      /* the tick spends one page a minute, no more */
  if (budget) budget.fetches--;
  try {
    const html = await fgFetch("/matches/" + id);
    const m = parseMatchBlob(html, id);
    if (!m) return cached || null;
    m.at = now; await store.put(KM + id, m);
    await storeLineups(store, id, m, now).catch(() => {});
    return m;
  } catch (_) { return cached || null; }
}
/* the line-ups go where egypt.js reads them (egy:lineups), from whichever path parsed the page */
export async function storeLineups(store, id, m, now) {
  if (!m || !m.lineups || !m.lineups.length || !m.lineups.every(sd => (sd.startXI || []).length >= 11)) return;
  const all = (await store.get("egy:lineups")) || {};
  const have = all[String(id)];
  if (have && have.at >= m.at) return;
  all[String(id)] = { at: m.at, data: m.lineups };
  for (const k of Object.keys(all)) if (now - (all[k].at || 0) > 3 * 86400000) delete all[k];
  await store.put("egy:lineups", all);
}
export async function fgTwinFor(store, hAr, aAr, ko) {
  const idx = (await store.get(KIDX)) || { rows: [] };
  return findTwin(idx.rows, hAr, aAr, ko);
}
