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
  "الشرقية للدخان": "Eastern Company", "أسوان": "Aswan", "الإنتاج الحربي": "El Entag El Harby", "طنطا": "Tanta", "نجوم": "Nogoom" };
export const enName = ar => EGY_EN[String(ar || "").trim()] || String(ar || "");
const FG_HOST = "https://www.filgoal.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const K = { fixtures: "egy:fixtures", live: "egy:live", fg: "egy:fg" };

export function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

/* the JSON sits after `var viewModelData = `; walk it with a bracket counter that respects strings */
export function extractViewModel(html) {
  const i = html.indexOf("var viewModelData = ");
  if (i < 0) return null;
  let j = i + "var viewModelData = ".length;
  while (j < html.length && html[j] !== "[") j++;
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
  const mins = m.TimeElapsed && +m.TimeElapsed.Minutes ? +m.TimeElapsed.Minutes : 0;
  const scored = m.HomeScore != null && m.AwayScore != null;
  let short = "NS", elapsed = null;
  if (text === "over" || /انتهت/.test(String(m.MatchStatusName || ""))) short = "FT";
  else if (text === "live" || (scored && ko && now > ko && now < ko + 3 * 3600000 && mins > 0)) { elapsed = Math.min(90, mins); short = mins > 45 ? "2H" : "1H"; }
  else if (/تأجلت|ألغيت/.test(String(m.MatchStatusName || ""))) short = "PST";
  const st = { short, elapsed, long: String(m.MatchStatusName || "") };
  return {
    fixture: { id: +m.Id, date: new Date(ko).toISOString(), status: st, venue: { name: m.StadiumName || null, city: null } },
    league: { id: +m.ChampionshipId || FG_LEAGUE_ID, name: m.ChampionshipName || "الدوري المصري", nameEn: +m.ChampionshipId === FG_LEAGUE_ID ? "Egyptian Premier League" : (CUP_EN[Object.keys(CUP_EN).find(k => String(m.ChampionshipName || "").indexOf(k) >= 0)] || m.ChampionshipName), country: "Egypt", season: new Date(ko).getUTCMonth() >= 6 ? new Date(ko).getUTCFullYear() : new Date(ko).getUTCFullYear() - 1, round: m.Week ? "Regular Season - " + m.Week : "" },
    teams: { home: { id: +m.HomeTeamId, name: enName(m.HomeTeamName), nameAr: m.HomeTeamName, winner: short === "FT" ? m.HomeScore > m.AwayScore : null },
             away: { id: +m.AwayTeamId, name: enName(m.AwayTeamName), nameAr: m.AwayTeamName, winner: short === "FT" ? m.AwayScore > m.HomeScore : null } },
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
  if (fixtures.list.some(f => f.teams && f.teams.home && f.teams.home.nameAr === undefined)) state.scheduleDay = null;   /* stored before English names existed: re-read once */
  const plan = fgPlan(now, state, fixtures.list);
  const day = utcDay(now);
  try {
    if (plan && plan.kind === "schedule") {
      const list = [];
      for (let d = 0; d < 8; d++) {
        const dayStr = utcDay(now + d * 86400000);
        const rows = parseDay(await fgFetch("/matches?date=" + dayStr), now);
        if (rows) list.push(...rows);
      }
      const seen = new Set();
      fixtures.list = list.filter(f => !seen.has(f.fixture.id) && seen.add(f.fixture.id));
      fixtures.at = now; fixtures.league = { id: FG_LEAGUE_ID, name: "الدوري المصري", country: "Egypt", season: fixtures.list[0] ? fixtures.list[0].league.season : null, via: "filgoal" };
      for (const f of fixtures.list) if (f.fixture.status.short !== "NS") live.byId[String(f.fixture.id)] = f;
      live.at = now;
      await store.put(K.fixtures, fixtures); await store.put(K.live, live);
      state.scheduleDay = day; state.lastLive = now;
    } else if (plan && plan.kind === "live") {
      const rows = parseDay(await fgFetch("/matches?date=" + day), now);
      if (rows) {
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
export async function fgStatus(store) { return (await store.get(K.fg)) || null; }
