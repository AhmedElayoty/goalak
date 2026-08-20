/* MENA broadcast schedule adapter.
   FilGoal is the primary exact-channel source and Yallakora is the independent fallback
   and gap-filler for individual fixtures FilGoal did not publish.
   Both are public server-rendered schedules without documented APIs, so requests are
   bounded, timed out and cached at the edge. Channel names are source-neutral: beIN,
   Thmanyah, Abu Dhabi Sports, Sharjah Sports, ON Sport, Dubai Sports, Saudi Sports/SSC
   and any other explicitly published broadcaster are accepted. */

const FILGOAL_MATCHES = "https://www.filgoal.com/matches/";
const YALLAKORA_MATCHES = "https://www.yallakora.com/matches-center";
const MAX_SOURCE_BYTES = 2_500_000;
const SOURCE_TIMEOUT_MS = 7_000;
const CACHE_VERSION = "v3";

const MENA_RIGHTS = Object.freeze({
  ucl: {
    broadcaster: "beIN SPORTS",
    source: "UEFA",
    sourceUrl: "https://www.uefa.com/uefachampionsleague/news/0253-0d82037aaedd-f371c464f919-1000--where-to-watch-the-uefa-champions-league-final-tv-broadcast-partners-live-streams/"
  },
  uel: {
    broadcaster: "beIN SPORTS",
    source: "beIN SPORTS",
    sourceUrl: "https://www.beinsports.com/en-mena/tv-guide"
  },
  epl: {
    broadcaster: "beIN SPORTS",
    source: "Premier League",
    sourceUrl: "https://www.premierleague.com/ar/news/3703577/premier-league-broadcast-deals-for-2025-2028"
  },
  liga: {
    broadcaster: "beIN SPORTS",
    source: "LALIGA",
    sourceUrl: "https://www.laliga.com/en-ES/news/bein-extends-exclusive-laliga-broadcast-rights-across-34-markets-in-mena-and-apac"
  },
  bun: {
    broadcaster: "beIN SPORTS",
    source: "beIN SPORTS",
    sourceUrl: "https://www.beinsports.com/en-mena/tv-guide"
  },
  fl1: {
    broadcaster: "beIN SPORTS",
    source: "beIN SPORTS",
    sourceUrl: "https://www.beinsports.com/en/sport/football/"
  },
  tsl: {
    broadcaster: "beIN SPORTS",
    source: "TFF",
    sourceUrl: "https://www.tff.org/Default.aspx?ftxtId=44977&pageId=200"
  }
});

function plainText(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function confirmedChannel(value) {
  const channel = plainText(value)
    .replace(/^(?:بى|بي)\s*(?:إن|ان)\s*سبورت/i, "beIN SPORTS")
    .replace(/^(?:أون|اون)\s*سبورت/i, "ON Sport")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (!channel || /لم يحدد|غير محدد|لم تعلن|not announced|not confirmed|\bTBD\b/i.test(channel)) return "";
  return channel;
}

function normalizeArabic(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ـ/g, "")
    .replace(/[^\u0621-\u064A0-9]+/g, " ")
    .trim();
}

export function leagueIdForFilGoal(name) {
  const n = normalizeArabic(name);
  if (/ابطال اوروبا/.test(n)) return "ucl";
  if (/الدوري الاوروبي|يوروبا ليج/.test(n)) return "uel";
  if (/الانجليزي/.test(n)) return "epl";
  if (/الاسباني/.test(n)) return "liga";
  if (/الالماني/.test(n)) return "bun";
  if (/الفرنسي/.test(n)) return "fl1";
  if (/التركي/.test(n)) return "tsl";
  if (/الاسكتلندي|اسكتلندا/.test(n)) return "spl";
  return "";
}

function extractChannelsByMatch(html) {
  const starts = [...String(html || "").matchAll(/<div\s+class=["'][^"']*\bcin_cntnr\b[^"']*["'][^>]*>/gi)];
  const channels = new Map();
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index || 0;
    const end = i + 1 < starts.length ? starts[i + 1].index : html.length;
    const card = html.slice(start, end);
    const id = card.match(/href=["']\/matches\/(\d+)(?:\/|["'])/i)?.[1];
    if (!id) continue;
    const auxStart = card.search(/<div\s+class=["'][^"']*\bmatch-aux\b[^"']*["'][^>]*>/i);
    if (auxStart < 0) continue;
    const auxEnd = card.indexOf("</div>", auxStart);
    const aux = card.slice(auxStart, auxEnd < 0 ? card.length : auxEnd + 6);
    for (const span of aux.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)) {
      if (!/fb_screen/i.test(span[1])) continue;
      const channel = confirmedChannel(span[1]);
      if (channel) channels.set(String(id), channel);
      break;
    }
  }
  return channels;
}

export function parseFilGoalSchedule(html, date) {
  const match = String(html || "").match(/window\.sportsEngineData\.todayMatches\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error("FilGoal schedule data was not found");
  const raw = JSON.parse(match[1]);
  const channels = extractChannelsByMatch(html);
  const matches = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const id = String(item?.Id || "");
    const channel = channels.get(id);
    if (!id || !channel) continue;
    matches.push({
      sourceMatchId: id,
      home: String(item.HomeTeamName || "").slice(0, 100),
      away: String(item.AwayTeamName || "").slice(0, 100),
      competition: String(item.ChampionshipName || "").slice(0, 100),
      leagueId: leagueIdForFilGoal(item.ChampionshipName),
      kickoffLocal: String(item.Date || "").slice(0, 30),
      channel,
      source: "FilGoal",
      sourceUrl: FILGOAL_MATCHES + "?date=" + encodeURIComponent(date)
    });
  }
  return {
    date,
    region: "MENA",
    matches,
    rights: MENA_RIGHTS,
    source: "FilGoal public match schedule",
    sourceUrl: FILGOAL_MATCHES + "?date=" + encodeURIComponent(date)
  };
}

export function leagueIdForYallakoraPath(value) {
  const path = String(value || "").toLowerCase();
  if (/\/champions-league(?:-|\/)|\/uefa-champions/.test(path)) return "ucl";
  if (/\/europa-league(?:-|\/)|\/uefa-europa/.test(path)) return "uel";
  if (/\/premier-league(?:-|\/)|\/english-premier/.test(path)) return "epl";
  if (/\/la-liga(?:-|\/)|\/spanish-la-liga/.test(path)) return "liga";
  if (/\/bundesliga(?:-|\/)|\/german-league/.test(path)) return "bun";
  if (/\/ligue-?1(?:-|\/)|\/french-league/.test(path)) return "fl1";
  if (/\/turkish-super-lig(?:-|\/)|\/turkish-league/.test(path)) return "tsl";
  if (/\/scottish-premiership(?:-|\/)|\/scottish-league/.test(path)) return "spl";
  if (/\/friendly-matches-club(?:-|\/)|\/club-friendl/.test(path)) return "clubfriendlies";
  if (/\/international-friendly|\/world-cup|\/africa-cup|\/asian-cup|\/euro-qual/.test(path)) return "national";
  return "";
}

function yallakoraTeam(card, side) {
  const pattern = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${side}\\b[^"']*["'][^>]*>[\\s\\S]*?<p\\b[^>]*>([\\s\\S]*?)<\\/p>`, "i");
  return plainText(card.match(pattern)?.[1]).slice(0, 100);
}

export function parseYallakoraSchedule(html, date) {
  const text = String(html || "");
  const starts = [...text.matchAll(/<div\b[^>]*\bliveScoreMatchId=["'](\d+)["'][^>]*>/gi)];
  if (!starts.length) throw new Error("Yallakora schedule data was not found");
  const sourceUrl = YALLAKORA_MATCHES + "?date=" + encodeURIComponent(date);
  const matches = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index || 0;
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    const card = text.slice(start, end);
    const id = String(starts[i][1] || "");
    const href = card.match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1] || "";
    const channel = confirmedChannel(card.match(/<div\b[^>]*class=["'][^"']*\bchannel\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    const home = yallakoraTeam(card, "teamA");
    const away = yallakoraTeam(card, "teamB");
    const kickoff = plainText(card.match(/<span\b[^>]*class=["'][^"']*\btime\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    if (!id || !channel || !home || !away || !/^\d{1,2}:\d{2}$/.test(kickoff)) continue;
    matches.push({
      sourceMatchId: "yk-" + id,
      home,
      away,
      competition: "",
      leagueId: leagueIdForYallakoraPath(href),
      kickoffLocal: date + "T" + kickoff.padStart(5, "0"),
      channel,
      source: "Yallakora",
      sourceUrl
    });
  }
  return {
    date,
    region: "MENA",
    matches,
    rights: MENA_RIGHTS,
    source: "Yallakora match centre",
    sourceUrl
  };
}

async function readTextLimited(response, byteLimit) {
  const stated = Number(response.headers.get("content-length") || 0);
  if (stated > byteLimit) throw new Error("broadcast source response is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > byteLimit) throw new Error("broadcast source response exceeded limit");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function fetchPublicSchedule(sourceName, sourceUrl, date, parser) {
  const response = await fetch(sourceUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "ar,en;q=0.7",
      "User-Agent": "Goallak/2.8 (+https://goallak.com/)"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(sourceName + " returned HTTP " + response.status);
  const html = await readTextLimited(response, MAX_SOURCE_BYTES);
  const parsed = parser(html, date);
  if (!parsed.matches.length) throw new Error(sourceName + " returned no confirmed channels");
  return parsed;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(ms)) return false;
  return Math.abs(ms - Date.now()) <= 370 * 86400000;
}

function scheduleResponse(payload, maxAge, edgeAge) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}, s-maxage=${edgeAge}`,
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function broadcastScheduleResponse(request, ctx) {
  if (request.method !== "GET") return scheduleResponse({ ok: false, error: "method" }, 0, 0);
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || "";
  const region = (url.searchParams.get("region") || "MENA").toUpperCase();
  if (!validDate(date)) return new Response(JSON.stringify({ ok: false, error: "invalid date" }), {
    status: 400,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
  if (region !== "MENA") return scheduleResponse({ ok: true, date, region, matches: [], rights: {}, supported: ["MENA"] }, 300, 900);

  const cacheKey = new Request(`${url.origin}/__broadcast-cache/${CACHE_VERSION}/${date}/MENA`);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  let payload = null;
  let maxAge = 300;
  let edgeAge = 900;
  const sourceStatus = [];
  const [filGoalResult, yallakoraResult] = await Promise.allSettled([
    fetchPublicSchedule("FilGoal", FILGOAL_MATCHES + "?date=" + encodeURIComponent(date), date, parseFilGoalSchedule),
    fetchPublicSchedule("Yallakora", YALLAKORA_MATCHES + "?date=" + encodeURIComponent(date), date, parseYallakoraSchedule)
  ]);
  const filGoal = filGoalResult.status === "fulfilled" ? filGoalResult.value : null;
  const yallakora = yallakoraResult.status === "fulfilled" ? yallakoraResult.value : null;
  sourceStatus.push({ source: "FilGoal", status: filGoal ? "ok" : "failed" });
  sourceStatus.push({ source: "Yallakora", status: yallakora ? "ok" : "failed" });
  if (!filGoal) console.warn(JSON.stringify({ message: "primary broadcast schedule failed", source: "FilGoal", date, error: String(filGoalResult.reason) }));
  if (!yallakora) console.warn(JSON.stringify({ message: "supplemental broadcast schedule failed", source: "Yallakora", date, error: String(yallakoraResult.reason) }));
  if (filGoal) {
    payload = {
      ...filGoal,
      matches: filGoal.matches.concat(yallakora ? yallakora.matches : []),
      source: yallakora ? "FilGoal and Yallakora schedules" : filGoal.source,
      supplemented: !!yallakora
    };
  } else if (yallakora) {
    payload = { ...yallakora, fallback: true };
  }
  if (!payload) {
    console.error(JSON.stringify({ message: "all exact broadcast schedules failed", date, sources: sourceStatus }));
    payload = {
      degraded: true,
      date,
      region: "MENA",
      matches: [],
      rights: MENA_RIGHTS,
      source: "Verified competition broadcast rights",
      fetchedAt: new Date().toISOString()
    };
    maxAge = 30;
    edgeAge = 60;
  }
  payload = { ok: true, ...payload, sources: sourceStatus, fetchedAt: new Date().toISOString() };
  const response = scheduleResponse(payload, maxAge, edgeAge);
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}
