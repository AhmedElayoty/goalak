/* goalak-push - Cloudflare Worker push scheduler for the Goallak app.
   Modeled on the proven wc26-push-scheduler: Durable Object serializes runs (no overlap),
   textdb holds subs + sent ledger + event states, @pushforge/builder does web-push crypto.
   Events sent: 30-min kickoff reminder, match live, goals (fresh only, no backfill),
   red cards, full time. Per-sub league filter (sub.lgs = [leagueId]; empty = all).
   DRY_RUN=true computes and reports without sending. */
import { buildPushHTTPRequest } from "@pushforge/builder";
import {
  ChatRoom,
  authenticateChatRequest,
  chatHistory,
  deleteChatMessage,
  reactChatMessage,
  issueChatSession,
  openChatSocket,
  postChatMessage,
  renewChatSession,
  roomStub,
  refreshMediaUrl,
  serveChatMedia,
  uploadChatMedia
} from "./chat.js";
import { broadcastScheduleResponse } from "./broadcasts.js";
import { AccountStore, accountsApi, accountStore } from "./accounts.js";
import { egyptTick, egyBoard, egySummary, egyStandings, egyStatus, afDoor } from "./egypt.js";

export { ChatRoom, AccountStore };

/* The hidden ESPN API serves browsers and 403s a bare edge request. */
const ESPN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-GB,en;q=0.9",
  "Referer": "https://www.espn.com/",
  "Origin": "https://www.espn.com"
};
/* THE HOST MATTERS, AND ONLY FROM A SERVER.
   site.api.espn.com serves any browser and 403s every request from this worker - measured, all
   eleven leagues, every tick, for as long as anyone can tell. It is not the User-Agent: adding
   a full browser header set changed nothing, so the block is on where the request comes from.
   site.web.api.espn.com answers the IDENTICAL path and query with 200. The app keeps using the
   original host because it is a browser and is served happily; only the edge takes this route,
   with the browser host kept as a fallback in case the two ever swap places. */
/* FOUR WAYS IN, AND NONE OF THEM ASSUMED TO KEEP WORKING.
   ESPN answered 403 to every request from this worker, for every league, for as long as anyone
   can tell - and because a failed feed is indistinguishable from a quiet afternoon, the entire
   notification pipeline was dead in silence. That is the part that has to never happen again,
   so this stopped being one request with a fallback and became a list of genuinely different
   routes, tried in order, each the way it wants to be asked:
     - site.web.api with browser headers  (what works from this edge today)
     - site.api    with browser headers   (what works from a browser)
     - site.api    bare                   (what works from a residential address, where the
                                           browser header set is the thing that gets refused)
     - cdn.espn.com core                  (a different origin and a different response shape
                                           entirely, so an outage of the api hosts is survivable)
   Each attempt is given six seconds. Without a timeout one hanging host stalls the whole run,
   and because the coordinator serialises runs, the next cron tick queues behind it - a slow
   feed becomes a growing backlog rather than a slow minute. */
const ESPN_ROUTES = [
  { host: "https://site.web.api.espn.com", headers: true, core: false },
  { host: "https://site.api.espn.com", headers: true, core: false },
  { host: "https://site.api.espn.com", headers: false, core: false },
  { host: "https://cdn.espn.com", headers: true, core: true }
];
async function espnFetch(url, headers) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 6000);
  try { return await fetch(url, { headers: headers ? ESPN_HEADERS : {}, signal: ctl.signal }); }
  finally { clearTimeout(to); }
}
/* ============================================================ the edge proxy
   THE PHONES WERE TALKING TO ESPN DIRECTLY, and the app lived or died by every user's own
   route to it: the owner's circle hit "could not connect - last saved data" while the
   worker's feed monitor read perfectly healthy, because the outage was between THEIR
   networks and ESPN, not between Cloudflare and ESPN. Match data now flows through here:
   one cached copy at the edge serves the whole audience (a scoreboard is fetched once per
   45 seconds however many people open the app), the resilient route ladder absorbs ESPN
   refusing one hostname, and when every upstream fails the last good copy is served STALE
   with a marker header - old data, honestly labelled, instead of an error card. The client
   still falls back to direct ESPN if this route itself is unreachable. */
const ESPN_PROXY_OK = /^apis\/(site\/)?v2\/sports\/soccer\/[A-Za-z0-9._-]+\/(scoreboard|summary|standings|teams\/\d+\/schedule|teams\/\d+\/roster|teams\/\d+)$/;
/* THE CORE API - season statistics per team - lives on a different ESPN host and carries no
   live data, so it gets its own narrow whitelist and a plain hour-long edge cache. */
const ESPN_CORE_OK = /^sports\/soccer\/leagues\/[A-Za-z0-9._-]+\/seasons\/\d{4}\/types\/\d\/teams\/\d+\/statistics$/;
async function espnCoreProxy(request, url) {
  if (request.method !== "GET") return json({ ok: false, error: "method" }, 405);
  const rest = url.pathname.replace(/^\/api\/espn-core\//, "");
  if (!ESPN_CORE_OK.test(rest)) return json({ ok: false, error: "not-proxied" }, 404);
  const cache = caches.default, key = new Request("https://espn-core-edge.goallak.internal/" + rest);
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, hit);
  const r = await fetch("https://sports.core.api.espn.com/v2/" + rest, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36", "accept": "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return json({ ok: false, error: "upstream-" + r.status }, 502);
  const out = new Response(await r.text(), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600" } });
  await cache.put(key, out.clone());
  return out;
}
function espnProxyTtl(rest) {
  if (rest.endsWith("/scoreboard") || rest.indexOf("/scoreboard?") >= 0) return 45;
  if (rest.indexOf("/summary") >= 0) return 45;
  if (rest.indexOf("/standings") >= 0) return 300;
  return 3600;   /* team schedules move slowly */
}
/* A GOAL IS NOT A TEAM SHEET, AND 45 SECONDS IS NOT ONE NUMBER FOR BOTH. The client repaints
   live scores every 25 seconds and, since v6.81, re-reads a live summary after 25 — but it was
   reading them through a 45-second edge copy, so a goal could sit finished at ESPN and still be
   absent from the phone for the better part of a minute. The TTL now follows the PAYLOAD rather
   than the path: a board or summary that still contains a match in play is worth re-asking for
   after 15 seconds; the same URL an hour later, with nothing in play, is not. It cannot be
   decided from the path alone, so the answer is measured from the body at fetch time and
   carried on the cached copy in x-gk-live, which is what the freshness check reads back.
   ESPN serialises compactly ("state":"post", no space) — verified against a live payload, and
   the check is a substring scan rather than a parse because it runs on every cache read. */
const ESPN_LIVE_TTL = 15;
function espnBodyLive(body) {
  return typeof body === "string" && body.indexOf('"state":"in"') >= 0;
}
async function espnProxy(request, url) {
  if (request.method !== "GET") return json({ ok: false, error: "method" }, 405);
  const rest = url.pathname.replace(/^\/api\/espn\//, "");
  if (!ESPN_PROXY_OK.test(rest)) return json({ ok: false, error: "not-proxied" }, 404);
  const qs = url.search || "";
  const base = espnProxyTtl(rest + qs);
  const cache = caches.default;
  const cacheKey = new Request("https://espn-edge.goallak.internal/" + rest + qs);
  const hit = await cache.match(cacheKey);
  const now = Date.now();
  /* the shortened window applies only where the base is the 45-second one (boards and
     summaries). A standings table or a team schedule does not become urgent because some
     match somewhere in it is being played. */
  const ttlFor = live => (live && base === 45 ? ESPN_LIVE_TTL : base) * 1000;
  const serve = (body, ts, stale, live) => new Response(body, { headers: {
    "content-type": "application/json; charset=utf-8",
    "x-gk-ts": String(ts),
    "x-gk-stale": stale ? "1" : "0",
    "x-gk-live": live ? "1" : "0",        /* what the TTL was decided on; also readable in QA */
    "cache-control": "no-store"           /* freshness is decided HERE, not by the client */
  }});
  if (hit) {
    const ts = Number(hit.headers.get("x-gk-ts")) || 0;
    const wasLive = hit.headers.get("x-gk-live") === "1";
    if (now - ts < ttlFor(wasLive)) return serve(await hit.text(), ts, false, wasLive);
  }
  for (const route of ESPN_ROUTES) {
    if (route.core) continue;             /* the cdn dialect answers a different shape */
    try {
      const r = await espnFetch(route.host + "/" + rest + qs, route.headers);
      if (r && r.ok) {
        const body = await r.text();
        JSON.parse(body);                 /* a 200 with a broken body must not poison the cache */
        const live = espnBodyLive(body);
        await cache.put(cacheKey, new Response(body, { headers: {
          "content-type": "application/json",
          "x-gk-ts": String(now),
          "x-gk-live": live ? "1" : "0",
          "cache-control": "public, max-age=21600"   /* the stale reserve lives six hours */
        }}));
        return serve(body, now, false, live);
      }
    } catch (_) { /* next rung of the ladder */ }
  }
  if (hit) return serve(await hit.text(), Number(hit.headers.get("x-gk-ts")) || 0, true, hit.headers.get("x-gk-live") === "1");
  return json({ ok: false, error: "upstream" }, 502);
}

async function espnBoard(slug, range, status) {
  const path = "/apis/site/v2/sports/soccer/" + slug + "/scoreboard?dates=" + range + "&limit=300";
  for (const route of ESPN_ROUTES) {
    /* the cdn route speaks a different dialect: one day at a time, and the events arrive
       wrapped, so it is only worth asking when the api hosts are all refusing */
    const url = route.core
      ? route.host + "/core/soccer/scoreboard?xhr=1&league=" + slug + "&dates=" + range.split("-")[0]
      : route.host + path;
    try {
      const r = await espnFetch(url, route.headers);
      if (r.ok) {
        const j = await r.json();
        if (route.core) {
          const evs = (j && j.content && j.content.sbData && j.content.sbData.events) || null;
          if (evs) return { events: evs };
        } else if (j && Array.isArray(j.events)) {
          return j;
        }
        status.push(slug + " " + route.host.replace("https://", "") + ":shape");
        continue;
      }
      status.push(slug + " " + route.host.replace("https://", "") + (route.headers ? "" : "/bare") + ":" + r.status);
    } catch (e) {
      status.push(slug + " " + route.host.replace("https://", "") + ":ERR " + String(e && e.message || e).slice(0, 40));
    }
  }
  return null;
}
/* one match summary - the only place line-ups live. Same host ladder as the boards;
   the cdn route speaks a different dialect and has no summary endpoint, so it is skipped. */
async function espnSummary(slug, eid) {
  const path = "/apis/site/v2/sports/soccer/" + slug + "/summary?event=" + eid;
  for (const route of ESPN_ROUTES) {
    if (route.core) continue;
    try {
      const r = await espnFetch(route.host + path, route.headers);
      if (r.ok) { const j = await r.json(); if (j && typeof j === "object") return j; }
    } catch (_) { /* next route */ }
  }
  return null;
}
const LEAGUES = [
  { id: "ucl", slug: "uefa.champions", en: "Champions League", ar: "دوري الأبطال" },
  { id: "ucl", slug: "uefa.champions_qual", en: "UCL Qualifying", ar: "تصفيات دوري الأبطال" },
  { id: "uel", slug: "uefa.europa", en: "Europa League", ar: "الدوري الأوروبي" },
  { id: "uel", slug: "uefa.europa_qual", en: "UEL Qualifying", ar: "تصفيات الدوري الأوروبي" },
  { id: "uecl", slug: "uefa.europa.conf", en: "Conference League", ar: "دوري المؤتمر الأوروبي" },
  { id: "uecl", slug: "uefa.europa.conf_qual", en: "UECL Qualifying", ar: "تصفيات دوري المؤتمر الأوروبي" },
  /* THE EGYPTIAN PREMIER LEAGUE is not on ESPN. It arrives through egypt.js (API-Football, a
     hundred calls a day, spent by the tick below and never by a phone) already in ESPN's shape,
     so kick-off, goal, red-card, full-time and live-card pushes need no special case. The slug
     is a marker, not an ESPN path: both board loops skip espnBoard() for src "af". */
  { id: "egy", slug: "egy.af", src: "af", en: "Egyptian Premier League", ar: "الدوري المصري" },
  { id: "epl", slug: "eng.1", en: "Premier League", ar: "الدوري الإنجليزي" },
  { id: "liga", slug: "esp.1", en: "La Liga", ar: "الدوري الإسباني" },
  { id: "seriea", slug: "ita.1", en: "Serie A", ar: "الدوري الإيطالي" },
  { id: "bun", slug: "ger.1", en: "Bundesliga", ar: "الدوري الألماني" },
  { id: "fl1", slug: "fra.1", en: "Ligue 1", ar: "الدوري الفرنسي" },
  { id: "tsl", slug: "tur.1", en: "Süper Lig", ar: "الدوري التركي" },
  { id: "spl", slug: "sco.1", en: "Scottish Premiership", ar: "الدوري الأسكتلندي" }
];
/* far above any plausible audience for this app, and far below what a flood needs to matter */
const SUB_CAP = 2000;
const APP_URL = "https://goallak.com/";
const SUBS_KEY = "goalak_push_subs";
const SENT_KEY = "goalak_push_sent";
const STATE_KEY = "goalak_push_states";
/* 400 was fine when every entry lived one band; the fxlock catch-up band can now hold an item
   in-window for half a day, and a busy weekend across eight leagues writes hundreds of goal and
   full-time entries - evicting a reminder's ledger row while its band is still open re-sends it.
   Entries are ~40 bytes; three days of the busiest weekend fits comfortably. */
const SENT_CAP = 1200;

/* ---------- textdb ---------- */
const READ_FAILED = Symbol("tdb-read-failed");
async function tdbRead(key, fallback) {
  try {
    const r = await fetch("https://textdb.online/" + key + "?t=" + Date.now(), { cf: { cacheTtl: 0 } });
    if (!r.ok) return READ_FAILED;
    const txt = (await r.text()).trim();
    if (!txt) return fallback;
    return JSON.parse(txt);
  } catch (_) { return READ_FAILED; }
}
async function tdbWrite(key, val) {
  const body = "key=" + encodeURIComponent(key) + "&value=" + encodeURIComponent(JSON.stringify(val));
  const r = await fetch("https://api.textdb.online/update/", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body
  });
  if (!r.ok) throw new Error("textdb write " + r.status);
}

/* ---------- helpers ---------- */
function json(v, status = 200) { return new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } }); }
function b64urlToBytes(s) {
  const b64 = String(s || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(s || "").length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function privateJwkFromEnv(env) {
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY || "");
  const d = b64urlToBytes(env.VAPID_PRIVATE_KEY || "");
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be an uncompressed P-256 point");
  if (d.length !== 32) throw new Error("VAPID private key must be a 32-byte base64url key");
  return { kty: "EC", crv: "P-256", x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), d: bytesToB64url(d) };
}
function utcYMD(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
function evState(e) {
  return (e.status && e.status.type && e.status.type.state) ||
    (e.competitions && e.competitions[0] && e.competitions[0].status && e.competitions[0].status.type && e.competitions[0].status.type.state) || "pre";
}
function statusName(e) {
  return (e.status && e.status.type && e.status.type.name) ||
    (e.competitions && e.competitions[0] && e.competitions[0].status && e.competitions[0].status.type && e.competitions[0].status.type.name) || "";
}
/* ABANDONED belongs here too. It arrives with state=post and a partial score, so without it
   the worker pushed "FULL TIME 1-0" for a match the app was already labelling Abandoned on
   screen - the two disagreeing about the same fixture, in the same minute. */
function isVoided(e) { return /POSTPON|CANCEL|SUSPEND|ABANDON/.test(statusName(e)); }
/* `keepAll` is for the WRITE path. The 500 cap is an in-memory sanity guard for a store
   anyone can post to - but the dead-endpoint cleanup normalised, filtered and then SAVED the
   result, so the first run that met a single dead endpoint after the list passed five hundred
   permanently deleted every subscriber past the five hundredth. Insertion order is signup
   order, so the ones it deleted were the newest. A cap that is a read-time guard must never
   decide what is written back. */
function normalizeSubs(list, keepAll) {
  const map = new Map();
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) continue;
    map.set(s.endpoint, s);
  }
  const out = [...map.values()];
  /* 500 was a junk-flood guard on a store anyone can post to, and it doubled as a silent
     ceiling on real subscribers: number 501 onward simply never received anything, with their
     switch reading ON. The guard still exists; it is now far above any plausible audience. */
  return keepAll ? out : out.slice(0, 5000);
}
function pruneSent(sent, now) {
  return (Array.isArray(sent) ? sent : [])
    .filter(s => s && s.id && (now - (Number(s.ts) || 0)) < 3 * 86400000)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .slice(-SENT_CAP);
}
function pruneStates(states, now) {
  const out = {};
  for (const [id, rec] of Object.entries(states && typeof states === "object" ? states : {})) {
    const ref = (Number(rec && rec.kickoff) || Number(rec && rec.ts) || 0);
    if (ref && (now - ref) < 4 * 86400000 && (ref - now) < 8 * 86400000) out[id] = rec;
  }
  return out;
}

/* ---------- payloads (bilingual) ---------- */
function names(e) {
  const comp = e.competitions && e.competitions[0] || {};
  const cs = comp.competitors || [];
  const H = cs.find(c => c.homeAway === "home") || cs[0] || {};
  const A = cs.find(c => c.homeAway === "away") || cs[1] || {};
  const nm = c => (c.team && (c.team.shortDisplayName || c.team.displayName)) || "?";
  return { H, A, h: nm(H), a: nm(A), hs: H.score != null ? H.score : "0", as: A.score != null ? A.score : "0" };
}
function lastScorer(e) {
  const dets = (e.competitions && e.competitions[0] && e.competitions[0].details) || [];
  const goals = dets.filter(d => d && (d.scoringPlay || /goal/i.test(d.type && d.type.text || "")));
  const g = goals[goals.length - 1];
  if (!g) return "";
  const who = g.athletesInvolved && g.athletesInvolved[0] && g.athletesInvolved[0].displayName || "";
  const min = g.clock && g.clock.displayValue || "";
  return who ? (who + (min ? " " + min : "")) : "";
}
function buildPayload(kind, e, lg, lang, sc) {
  const n = names(e);
  const h = n.h, a = n.a;
  const hs = sc ? String(sc.hs) : n.hs, as = sc ? String(sc.as) : n.as;
  const ar = lang === "ar";
  const lgName = ar ? lg.ar : lg.en;
  const tag = kind + "-" + e.id;
  let title = "", body = "";
  if (kind === "k30") {
    title = ar ? "⏰ بعد نصف ساعة · " + lgName : "⏰ 30 minutes · " + lgName;
    body = h + " × " + a;
  } else if (kind === "live") {
    title = ar ? "🔴 بدأت المباراة · " + lgName : "🔴 Kick-off · " + lgName;
    body = h + " × " + a;
  } else if (kind === "goal") {
    /* lastScorer reads the CURRENT card, so a goal held for a minute while a second one went in
       was announced with the later scorer's name against the earlier scoreline. When the two
       disagree the name is simply left off rather than being wrong. */
    const scorer = sc && (String(sc.hs) !== String(n.hs) || String(sc.as) !== String(n.as)) ? "" : lastScorer(e);
    title = (ar ? "⚽ جوووول! " : "⚽ GOAL! ") + h + " " + hs + " - " + as + " " + a;
    body = (scorer ? scorer + " · " : "") + lgName;
  } else if (kind === "red") {
    title = (ar ? "🟥 طرد · " : "🟥 Red card · ") + h + " × " + a;
    body = lgName;
  } else if (kind === "ft") {
    title = (ar ? "🏁 انتهت · " : "🏁 FT · ") + h + " " + hs + " - " + as + " " + a;
    body = lgName;
  } else if (kind === "lineup") {
    title = ar ? "\u{1F4CB} \u0627\u0644\u062a\u0634\u0643\u064a\u0644\u0629 \u0646\u0632\u0644\u062a \u00b7 " + h + " \u00d7 " + a : "\u{1F4CB} Line-ups out \u00b7 " + h + " \u00d7 " + a;
    body = ar ? "\u0628\u0635 \u0645\u064a\u0646 \u0644\u0639\u0628 \u0623\u0633\u0627\u0633\u064a \u2014 " + lgName : "See who starts \u2014 " + lgName;
  } else if (kind === "fxlock") {
    /* e is not an ESPN event here — it carries {round, hours} */
    title = ar ? "⏳ الجولة " + e.round + " بتقفل قريب" : "⏳ Round " + e.round + " locks soon";
    body = ar ? "باقي " + e.hours + " ساعة. راجع فريقك والكابتن قبل ما تقفل."
              : e.hours + "h left. Check your team and captain before it locks.";
  } else if (kind === "predopen") {
    title = ar ? "🔮 توقعات دوري الأبطال فتحت" : "🔮 Champions League predictions are open";
    body = ar ? "ماتشات بكرة جاهزة للتوقع" : "Tomorrow's matches are ready to predict";
  } else if (kind === "livecard") {
    /* THE STICKY ONE. Same tag every minute, silent, never re-alerts: Android replaces the
       existing notification in place, so it reads as one card that updates rather than a
       stream of buzzes. This is as close as the web gets to a native live activity —
       Android's rich Live Updates are not exposed to web push at all, and iOS shows nothing
       like it, so the card degrades to an ordinary silent notification there. */
    const clock = (e.status && e.status.displayClock) || "";
    title = h + " " + hs + " - " + as + " " + a;
    body = (clock ? clock + " · " : "") + lgName;
  } else {
    title = "GOALLAK"; body = ar ? "الجول جولك" : "El Goal Goallak";
  }
  const live = kind === "livecard";
  return {
    payload: {
      title, body, icon: APP_URL + "icon-192.png", badge: APP_URL + "badge.png",
      /* One tag PER MATCH for the live card, so it replaces itself instead of stacking - but
         "live-" was ALREADY the kick-off notification's tag, because that kind is called
         `live`. Same tag AND same Web Push Topic meant the silent card overwrote the kick-off
         alert within the same second, and for a phone that was asleep the push service
         collapsed the two and delivered only the card: the people who follow one of the clubs,
         who most want the kick-off alert, were exactly the ones who never got it. The card has
         its own namespace now. */
      tag: live ? "card-" + e.id : tag,
      /* FULL TIME TAKES THE CARD DOWN WITH IT. requireInteraction keeps Android from
         auto-dismissing a pinned card, so without this the shade kept a frozen 90th-minute
         score for every match the user followed, for ever, until it was swiped away by hand. */
      close: kind === "ft" ? "card-" + e.id : undefined,
      url: APP_URL, sticky: live, silent: live, renotify: !live, ts: Date.now()
    },
    options: {
      /* a live card that arrives late is worse than not arriving: it would overwrite a newer
         score with an older one, so it expires in two minutes */
      ttl: live ? 120 : 3600,
      urgency: live ? "normal" : "high",
      topic: (live ? "card-" + e.id : tag).slice(0, 32).replace(/[^A-Za-z0-9_-]/g, "-")
    }
  };
}

/* ---------- send ---------- */
async function sendTo(list, built, env, privateJWK) {
  const dead = new Set();
  let ok = 0, fail = 0;
  const adminContact = env.VAPID_SUBJECT || APP_URL;
  for (let i = 0; i < list.length; i += 20) {
    const batch = list.slice(i, i + 20);
    await Promise.all(batch.map(async s => {
      try {
        const req = await buildPushHTTPRequest({
          privateJWK,
          subscription: { endpoint: s.endpoint, keys: s.keys },
          message: { payload: built.payload, adminContact, options: built.options }
        });
        const r = await fetch(req.endpoint, { method: "POST", headers: req.headers, body: req.body });
        if (r.status >= 200 && r.status < 300) ok++;
        else { fail++; if (r.status === 404 || r.status === 410) dead.add(s.endpoint); }
      } catch (_) { fail++; }
    }));
  }
  return { ok, fail, dead };
}

/* ---------- the run ---------- */
/* held on the coordinator's own durable storage: free, survives eviction, and costs nothing
   on the runs where nothing is wrong */
async function noteFeedOn(store, healthy, env, dry) {
  if (dry) return;
  const prev = (await store.get("feed")) || { fail: 0, lastOk: 0, alerted: 0 };
  if (healthy) {
    if (prev.fail || prev.alerted) await store.put("feed", { fail: 0, lastOk: Date.now(), alerted: 0 });
    else if (Date.now() - (prev.lastOk || 0) > 300000) await store.put("feed", { fail: 0, lastOk: Date.now(), alerted: 0 });
    return;
  }
  const fail = (prev.fail || 0) + 1;
  const next = { fail, lastOk: prev.lastOk || 0, alerted: prev.alerted || 0 };
  /* ten consecutive dead runs is ten minutes; anything shorter is a blip not worth waking
     somebody for, and anything longer has already cost real notifications */
  if (fail >= 10 && !next.alerted) {
    next.alerted = Date.now();
    try { await alertOwner(env, store, fail); } catch (_) {}
  }
  await store.put("feed", next);
}
/* subscriptions live in the coordinator's own storage now; textdb remains only as a one-time
   import source for records written before the move */
async function storedSubs(store) {
  if (!store) return null;
  const m = await store.list({ prefix: "sub:" });
  return m.size ? [...m.values()] : null;
}
async function loadSubsRaw(store) {
  const own = await storedSubs(store);
  if (own) return own;
  const legacy = await tdbRead(SUBS_KEY, []);
  if (legacy === READ_FAILED) return READ_FAILED;
  const list = Array.isArray(legacy) ? legacy : [];
  if (store && list.length) {
    for (const r of normalizeSubs(list, true)) if (r && r.endpoint) await store.put("sub:" + r.endpoint, r);
  }
  return list;
}
async function alertOwnerMsg(env, store, tag, title, body) {
  const owner = env.OWNER_UID || "";
  if (!owner) return;
  const subsRaw = await loadSubsRaw(store);
  if (subsRaw === READ_FAILED) return;
  const mine = normalizeSubs(subsRaw, true).filter(s => s && s.uid === owner);
  if (!mine.length) return;
  const built = {
    payload: { title, body, tag, url: APP_URL, renotify: true, ts: Date.now() },
    options: { ttl: 3600, urgency: "high", topic: tag.slice(0, 32) }
  };
  await sendTo(mine, built, env, privateJwkFromEnv(env));
}
async function alertOwner(env, store, fail) {
  await alertOwnerMsg(env, store, "feeddown", "⚠️ Goallak: the match feed is down",
    "No fixture data for " + fail + " minutes. Notifications are not being sent.");
}

async function runOnce(env, dry, store) {
  const now = Date.now();
  /* THE LEDGERS LIVE AT HOME NOW. Subscriptions, the dedupe ledger and the live-match
     baselines all sat on textdb.online - a free third-party store, world-writable by key,
     with no versioning and no promise of tomorrow. One wipe there and every notification
     switch in the app silently read ON while nothing was ever sent again. They live in the
     coordinator's own durable storage now; textdb is consulted exactly once, as the import
     source for whatever it still holds, and never written again. */
  const subsRaw = await loadSubsRaw(store);
  if (subsRaw === READ_FAILED) return { ok: false, dry, error: "subs read failed - run aborted" };
  const subs = normalizeSubs(subsRaw);
  if (!subs.length) return { ok: true, dry, subs: 0, queued: [] };

  /* a failed ledger read must ABORT the run: proceeding with empty ledgers would resend and lose baselines */
  let sentRaw = store ? await store.get("sent") : undefined;
  let statesRaw = store ? await store.get("states") : undefined;
  if (sentRaw == null) { sentRaw = await tdbRead(SENT_KEY, []); }
  if (statesRaw == null) { statesRaw = await tdbRead(STATE_KEY, {}); }
  if (sentRaw === READ_FAILED || statesRaw === READ_FAILED) return { ok: false, dry, error: "ledger read failed - run aborted" };
  let sent = pruneSent(sentRaw, now);
  const sentIds = new Set(sent.map(s => s.id));
  let states = pruneStates(statesRaw, now);

  const range = utcYMD(now - 86400000) + "-" + utcYMD(now + 86400000);
  /* ESPN WAS ANSWERING 403 TO EVERY SINGLE REQUEST FROM HERE, and had been.
     Not a bug anyone could see: the fetches fail silently by design (`.catch(() => null)`),
     an empty board is indistinguishable from a quiet afternoon, and the run still reports
     ok:true. The whole notification pipeline was dead - no kick-off, no goal, no red card, no
     full time, no fantasy deadline, no prediction reminder - and nothing anywhere said so.
     The difference between the browser, which is served happily, and the worker is the
     headers: an edge request carries no browser User-Agent and no Referer, and that is what
     the block is keyed on. Now it looks like what it is: the same app, from the server side. */
  const feedStatus = [];
  /* the Egyptian tick runs first: at most one provider call, then today's board from storage */
  const egyLog = [];
  const egyNow = await egyptTick(env, store, now, egyLog).catch(e => { egyLog.push("egy:tick:" + ((e && e.message) || "err")); return null; });
  if (egyLog.length) console.log("egy " + egyLog.join(" "));
  const boards = await Promise.all(LEAGUES.map(l => l.src === "af" ? egyNow : espnBoard(l.slug, range, feedStatus)));
  /* A DEAD FEED MUST BE LOUD. Silence here used to mean "nothing is happening"; it now says
     which league refused and with what, so this can never again be invisible. */
  if (feedStatus.length) console.log(JSON.stringify({ message: "espn feed refused", range, feedStatus }));
  /* A DEAD FEED IS NOW AN EVENT, NOT A SILENCE.
     Every league answering nothing means no kick-off, no goal, no full time, no deadline
     reminder - and the run still returns ok, because an empty board looks exactly like an
     afternoon with no football. The streak is remembered across runs so /health can be asked,
     and once it has been dead for ten minutes the owner is told, once, by the same push channel
     everything else uses. Recovery clears it, so the next outage alerts again. */
  const feedsOk = boards.filter(Boolean).length;
  if (store) await noteFeedOn(store, feedsOk > 0, env, dry);

  const queued = [];
  const queue = (id, kind, e, lg, sc) => {
    if (sentIds.has(id)) return;
    /* `sc` is the score AT THE MOMENT THE GOAL WAS SEEN. Without it a goal held for a minute
       was announced with whatever the score had become by the time it was sent, so two quick
       goals both read as the later scoreline. */
    queued.push({ id, kind, e, lg, sc });
    sentIds.add(id); /* in-run dedupe only; the persisted ledger entry is added AFTER a delivery attempt succeeds */
  };
  const luCands = [];   /* pre-window matches whose line-ups have not been seen yet */

  boards.forEach((j, i) => {
    const lg = LEAGUES[i];
    for (const e of (j && j.events) || []) {
      if (!e || !e.id) continue;
      if (isVoided(e)) continue;
      const st = evState(e);
      const kickoff = Date.parse(e.date) || 0;
      const { hs, as } = names(e);
      const nh = parseInt(hs, 10) || 0, na = parseInt(as, 10) || 0;
      const dets = (e.competitions && e.competitions[0] && e.competitions[0].details) || [];
      const reds = dets.filter(d => d && /red card/i.test(d.type && d.type.text || "")).length;
      const rec = states[e.id];
      let pendingGoals = [];

      /* 30-minute reminder: real window only, once */
      const mins = (kickoff - now) / 60000;
      if (st === "pre" && mins >= 25 && mins <= 35) queue("k30-" + e.id, "k30", e, lg);

      /* LINE-UPS land ~55 min before kick-off (measured live, 27 Aug: T-56 UEFA, T-59..29
         La Liga). Collect candidates here; the gentle poll runs AFTER the sweep because this
         loop is synchronous. The 5-minute per-event gate and the 3-per-tick cap keep the
         subrequest budget flat on a busy Saturday. */
      if (st === "pre" && mins >= 20 && mins <= 80) {
        const r0 = states[e.id];
        if (!(r0 && r0.lu) && (!(r0 && r0.luAt) || now - r0.luAt >= 5 * 60000)) luCands.push({ e, lg });
      }

      if (!rec) {
        /* first observation: record only; live send only if genuinely near kickoff (no stale backfill) */
        if (st === "in" && (now - kickoff) < 12 * 60000) queue("live-" + e.id, "live", e, lg);
        states[e.id] = { st, hs: nh, as: na, red: reds, ts: now, kickoff };
        continue;
      }
      if (rec.st === "pre" && st === "in" && (now - kickoff) < 20 * 60000) queue("live-" + e.id, "live", e, lg);
      /* GOALS ARE HELD BACK ONE MINUTE, on the owner's instruction: a push that beats the
         television spoils the goal for anybody watching a stream that runs behind. The goal is
         recorded when it is seen and sent on the NEXT tick — the cron runs every minute, so the
         delay is exactly the minute asked for and needs no timer. */
      /* A QUEUE, not a slot. Holding one pending goal meant that when a held goal came due on
         the same tick as a new one was spotted, the new one was overwritten and lost - and the
         baseline was then written forward, so nothing ever noticed. In a burst only every
         other goal was announced. */
      const pgs = Array.isArray(rec.pendingGoals) ? rec.pendingGoals
                : (rec.pendingGoal ? [rec.pendingGoal] : []);
      const keep = [];
      for (const pg of pgs) {
        if (now - pg.at < 55000) { keep.push(pg); continue; }   /* the minute is not up yet */
        /* a goal that has been sitting for ten minutes is a cron gap, not news */
        if (now - pg.at > 10 * 60000) continue;
        /* VAR. The whole point of holding a goal back is that a chalked-off one is never
           announced; if the score is no longer at least what it was, it did not stand. */
        if (nh < pg.hs || na < pg.as) continue;
        /* the id used to be the scoreline alone, so a goal chalked off by VAR and then legally
           scored again arrived at a scoreline already in the three-day ledger and was silently
           dropped. The sequence makes each goal its own event. */
        queue("goal-" + e.id + "-" + pg.hs + "-" + pg.as + "-" + (pg.seq || 0), "goal", e, lg, { hs: pg.hs, as: pg.as });
      }
      if (st === "in" && (nh > (rec.hs || 0) || na > (rec.as || 0)) && (now - (rec.ts || 0)) < 10 * 60000) {
        keep.push({ hs: nh, as: na, at: now, seq: (Number(rec.seq) || 0) + 1 });
      }
      pendingGoals = keep.slice(-6);
      if (st === "in" && reds > (rec.red || 0) && (now - (rec.ts || 0)) < 10 * 60000) {
        queue("red-" + e.id + "-" + reds, "red", e, lg);
      }
      if (rec.st === "in" && st === "post") queue("ft-" + e.id, "ft", e, lg);
      /* THE LIVE CARD. One silent, self-replacing notification per live match, for the people
         who follow one of the clubs in it. Queued every tick while the match is in play so the
         score and the clock stay current. */
      if (st === "in") queue("livecard-" + e.id + "-" + now, "livecard", e, lg);

      /* CHAMPIONS LEAGUE PREDICTIONS, a day out. One per match, once. */
      const hrs = (kickoff - now) / 3600000;
      /* ONE PER MATCHDAY. Keyed per fixture, every Champions League match in the same slot
         entered the window on the same tick with a different tag and identical text, so a
         matchday delivered four to nine byte-identical buzzes in one minute. */
      /* THE SLUG, NOT THE FAMILY ID: both uefa.champions and uefa.champions_qual carry the
         "ucl" id, but the prediction tab loads only the main competition - so a qualifier
         kicked off a "predictions are open" push that led to an empty tab. August is exactly
         when qualifiers happen, so this was live-firing before the league phase even began. */
      if (lg.slug === "uefa.champions" && st === "pre" && hrs >= 23.5 && hrs <= 24.5) queue("predopen-" + utcYMD(kickoff), "predopen", e, lg);

      states[e.id] = { st, hs: nh, as: na, red: reds, ts: now, kickoff, pendingGoals,
                       seq: keep.length ? keep[keep.length - 1].seq : (Number(rec.seq) || 0),
                       /* the line-up flags must ride the rebuild or every tick forgets them */
                       lu: rec.lu, luAt: rec.luAt };
    }
  });

  /* the line-up poll: at most three summaries a minute, each event retried no sooner than
     five minutes after its last look. Twelve simultaneous pre-window matches are all checked
     inside twenty minutes - comfortably before kick-off. Best-effort by design: if no line-up
     is seen by kick-off, the k30 and live pushes still carry the match. */
  for (const c of luCands.slice(0, 3)) {
    const r0 = states[c.e.id];
    if (!r0 || r0.lu) continue;
    r0.luAt = now;
    try {
      const sum = await espnSummary(c.lg.slug, c.e.id);
      if (sum && (sum.rosters || []).some(rr => (rr.roster || []).length)) {
        r0.lu = 1;
        queue("lineup-" + c.e.id, "lineup", c.e, c.lg);
      }
    } catch (_) { /* the 5-minute gate retries */ }
  }

  /* FANTASY ROUND DEADLINES. The rounds live in the app's own calendar.json, so the worker
     reads the same file the game does rather than keeping a second copy that can drift. A
     round locks the moment its window opens. */
  try {
    const cal = await fetch(APP_URL + "fantasy/calendar.json?t=" + now, { cf: { cacheTtl: 300 } })
      .then(r => r.ok ? r.json() : null).catch(() => null);
    const gws = cal && Array.isArray(cal.gws) ? cal.gws : [];
    /* the refined per-round locks the wide sweep left behind; the calendar's midnight is the
       floor when a round's fixtures are not known yet */
    let gwlocks = {};
    try { gwlocks = (store && await store.get("gwlocks")) || {}; } catch (_) {}
    for (let i = 0; i < gws.length; i++) {
      const lockMs = gwlocks[i + 1] || Date.parse(gws[i][0] + "T00:00:00Z");
      if (!isFinite(lockMs)) continue;
      const hrsLeft = (lockMs - now) / 3600000;
      /* two reminders: a day out to make a plan, three hours out to actually do it.
         The window used to be +/- 0.02h - 144 seconds - against a cron whose ticks are
         `max(60s, how long the last run took)`. On a busy Saturday a run comfortably exceeds
         that and the window is stepped straight over, with no catch-up: the reminder simply
         never arrives. It is a BAND now, from the mark down to an hour past it, and the
         persisted ledger is what keeps it to one send. */
      /* NOT AT ONE IN THE MORNING. The rounds lock at midnight UTC, which is 04:00 where most
         of these managers are - so "24 hours before" landed at 04:00 and "3 hours before" at
         01:00, both with renotify and high urgency. The marks stay, the send waits for a
         civilised hour, and the persisted ledger still keeps it to one. */
      /* DELAYED, NOT DROPPED. The waking-hours gate used to sit on a one-hour band, so any
         mark whose band fell entirely in the night was skipped outright rather than sent the
         next morning - the reminder for a Friday-evening lock simply never came. Each mark now
         has a catch-up band down to the next natural boundary, and the persisted ledger still
         keeps it to one send. */
      const localHour = new Date(now + 4 * 3600000).getUTCHours();
      const awake = localHour >= 9 && localHour <= 22;
      for (const mark of [24, 3]) {
        const floor = mark === 24 ? 12 : 0;
        if (awake && hrsLeft <= mark && hrsLeft > floor) {
          queue("fxlock-" + (i + 1) + "-" + mark, "fxlock",
                { id: "fx" + (i + 1), round: i + 1, hours: mark }, { id: "fx", ar: "فانتازي", en: "Fantasy" });
        }
      }
    }
  } catch (_) { /* the calendar is unreachable this minute — try again next minute */ }

  /* THE KICK-OFF TIMES GO TO THE ACCOUNT STORE, which is where the prediction deadline has
     to be decided. We are already holding every fixture in the window; handing over the map
     costs one call a minute and turns a browser-only rule into a server one. */
  if (!dry) {
    const kmap = {};
    boards.forEach(j => { for (const e of (j && j.events) || []) {
      const ko = Date.parse(e && e.date) || 0;
      if (e && e.id && ko) kmap[String(e.id)] = ko;
    } });
    /* A DAY IS NOT FAR ENOUGH. The sweep window is +/-1 day because that is all the state
       machine needs, and the kick-off index was filled from it - so it held 22 fixtures while
       the app lets people predict a fortnight out. Everything resting on that index was
       therefore far weaker than it looked: the server-side deadline could not judge most picks,
       and a pick with no known kick-off is returned to every other player the moment it is
       saved. A wider sweep, four times an hour, is eleven cheap requests. */
    if (new Date(now).getUTCMinutes() % 15 === 0) {
      const wide = utcYMD(now) + "-" + utcYMD(now + 21 * 86400000);
      const far = await Promise.all(LEAGUES.map(l => l.src === "af" ? null : espnBoard(l.slug, wide, feedStatus)));
      const wideKos = [];
      far.forEach(j => { for (const e of (j && j.events) || []) {
        const ko = Date.parse(e && e.date) || 0;
        if (e && e.id && ko) { kmap[String(e.id)] = ko; wideKos.push(ko); }
      } });
      /* THE ROUND LOCKS AT ITS FIRST WHISTLE, NOT AT MIDNIGHT. The game now locks thirty
         minutes before the round's first kick-off, so a reminder that counts hours to the
         calendar's midnight is counting to the wrong moment - "3 hours left" at 01:00 for a
         lock that is actually at 22:00 that night. This sweep already holds every kick-off
         for three weeks; fold them into per-round locks and leave them where the minute
         loop can read them. */
      if (store && wideKos.length) {
        try {
          const cal = await fetch(APP_URL + "fantasy/calendar.json?t=" + now, { cf: { cacheTtl: 300 } })
            .then(r => r.ok ? r.json() : null).catch(() => null);
          const gws = cal && Array.isArray(cal.gws) ? cal.gws : [];
          const locks = {};
          let prevLocks = {};
          try { prevLocks = (await store.get("gwlocks")) || {}; } catch (_) {}
          for (let i = 0; i < gws.length; i++) {
            const open = Date.parse(gws[i][0] + "T00:00:00Z");
            const end = Date.parse(gws[i][1] + "T00:00:00Z");
            if (!isFinite(open) || !isFinite(end)) continue;
            /* A LOCK THAT HAS STRUCK IS HISTORY, NOT A FORECAST. This sweep only sees kick-offs
               from today forward, so late in a round's week the surviving fixtures in its window
               are its LAST matches - recomputing from those moved round 1's lock to 27 August,
               six days after its first whistle, and woke everybody with "3h left" for a round
               sealed the previous Friday. A past lock is frozen for ever; a window open for over
               a day with no recorded lock defaults to its own past midnight, which reminds
               nobody rather than the wrong body. */
            const stored = +prevLocks[i + 1] || 0;
            if (stored && stored <= now) { locks[i + 1] = stored; continue; }
            if (!stored && open < now - 86400000) { locks[i + 1] = open; continue; }
            let min = Infinity;
            for (const ko of wideKos) if (ko >= open && ko < end && ko < min) min = ko;
            if (isFinite(min)) locks[i + 1] = Math.max(open, min - 30 * 60000);
            else if (stored) locks[i + 1] = stored;
          }
          if (Object.keys(locks).length) await store.put("gwlocks", locks);
        } catch (_) { /* next quarter-hour refreshes it */ }
      }
    }
    if (Object.keys(kmap).length) {
      try {
        await accountStore(env).fetch("https://accounts.local/kicks-set", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ map: kmap })
        });
      } catch (_) { /* the deadline index is a minute stale; the next run refreshes it */ }
    }
  }

  /* who actually plays the fantasy: the standings endpoint already lists exactly the managers
     with a squad, and nobody else should be woken about a deadline they do not have */
  const fxUids = {};
  try {
    const b = await accountStore(env).fetch("https://accounts.local/fx-board", { method: "POST", body: "{}" }).then(r => r.json());
    for (const m of (b && b.managers) || []) if (m && m.uid) fxUids[m.uid] = 1;
  } catch (_) { /* no list this minute: the reminder simply finds no targets rather than all of them */ }

  /* one lookup per run: who follows which club. The account store already returns it. */
  const clubOf = {};
  try {
    const lb = await accountStore(env).fetch("https://accounts.local/leaderboard", { method: "POST", body: JSON.stringify({ full: true }) }).then(r => r.json());
    for (const u of (lb && lb.users) || []) if (u && u.uid && u.club && u.club.id) clubOf[u.uid] = String(u.club.id);
  } catch (_) { /* no club map this minute: the live card simply finds no targets */ }

  let delivered = 0, failed = 0;
  const deadAll = new Set();
  if (!dry && queued.length) {
    const privateJWK = privateJwkFromEnv(env);
    for (const q of queued) {
      const targets = subs.filter(s => {
        /* a belled match is a personal subscription to ONE fixture: it cuts through league
           mutes and club filters alike - that is the whole promise of the bell */
        const evsB = Array.isArray(s.events) ? s.events : [];
        const belled = q.e && q.e.id && evsB.includes(String(q.e.id));
        /* A LIVE CARD IS PERSONAL. It sits pinned in the shade for ninety minutes, so it goes
           only to somebody who follows one of the two clubs — sending it on league interest
           alone would pin a card for every match in the Premier League at once. */
        if (q.kind === "livecard") {
          if (belled) return true;
          /* club interest decides WHO gets it, but a league the user has switched off stays
             off: the most intrusive notification in the system was the one that ignored the
             preferences hardest */
          /* teams-only mode mutes every league - but a club you FOLLOW is not "the league":
             the live card survives when the club is on the user's followed-teams list */
          const tmsL = Array.isArray(s.teams) ? s.teams.slice(0, 10).map(String) : [];
          const muted = Array.isArray(s.lgs) && s.lgs.length && !s.lgs.includes(q.lg.id);
          if (muted && !(s.uid && clubOf[s.uid] && tmsL.includes(String(clubOf[s.uid])))) return false;
          const mine = clubOf[s.uid];
          if (!mine) return false;
          const cs = (q.e.competitions && q.e.competitions[0] && q.e.competitions[0].competitors) || [];
          return cs.some(c => c.team && String(c.team.id) === String(mine));
        }
        const lgs = Array.isArray(s.lgs) ? s.lgs : [];
        /* THE FANTASY DEADLINE IS NOT A LEAGUE. It was run through the league filter with a
           synthetic id of "fx", which is never in anybody's list - so it worked only by
           accident for users who had every league on, and the moment somebody switched one
           league off their round-lock reminders stopped for ever, silently. */
        /* IT WENT TO EVERYBODY. Bypassing the league filter was right - a fantasy deadline is
           not a league event - but it left the reminder with no audience rule at all, so every
           subscriber got it whether or not they have ever opened the game. The audience is the
           people who actually have a squad. */
        if (q.kind === "fxlock") return !!fxUids[s.uid];
        /* line-ups never go league-wide: followed clubs and belled matches only */
        if (q.kind === "lineup") {
          if (belled) return true;
          const tmsLU = Array.isArray(s.teams) ? s.teams.slice(0, 10).map(String) : [];
          if (!tmsLU.length) return false;
          const csLU = (q.e.competitions && q.e.competitions[0] && q.e.competitions[0].competitors) || [];
          return csLU.some(c => c.team && tmsLU.includes(String(c.team.id)));
        }
        if (q.kind !== "predopen" && belled) return true;
        if (!lgs.length || lgs.includes(q.lg.id)) return true;
        /* A FOLLOWED TEAM CUTS THROUGH THE LEAGUE FILTER. Somebody follows Trabzonspor, not
           the whole Turkish league - switching the league off used to silence the one club
           they cared about. Up to ten followed teams ride the subscription; a match involving
           one of them alerts regardless of the league toggles. */
        const tms = Array.isArray(s.teams) ? s.teams.slice(0, 10).map(String) : [];
        if (!tms.length) return false;
        const cs2 = (q.e.competitions && q.e.competitions[0] && q.e.competitions[0].competitors) || [];
        return cs2.some(c => c.team && tms.includes(String(c.team.id)));
      });
      let qOk = 0, qFail = 0;
      const byLang = { ar: targets.filter(s => (s.lang || "ar") === "ar"), en: targets.filter(s => (s.lang || "ar") !== "ar") };
      for (const lang of ["ar", "en"]) {
        if (!byLang[lang].length) continue;
        const built = buildPayload(q.kind, q.e, q.lg, lang, q.sc);
        const res = await sendTo(byLang[lang], built, env, privateJWK);
        qOk += res.ok; qFail += res.fail;
        res.dead.forEach(d => deadAll.add(d));
      }
      delivered += qOk; failed += qFail;
      /* total failure = leave unmarked so the next run retries (tag replaces, so no stacking) */
      /* the live card is MEANT to repeat every minute, so it never joins the ledger —
         recording it would grow the file without bound and dedupe the very repeat we want */
      /* A PARTIAL SEND IS NOT A SEND. `qOk > 0` marked the whole item delivered, so one
         success and two hundred 429s meant those two hundred people never heard about the
         goal. It is retried instead - the tag replaces rather than stacks - but not for ever:
         one endpoint that fails every minute must not re-push to everybody else for three
         days, so the third attempt closes it out. */
      /* THE RETRY WAS WORSE THAN THE GAP IT CLOSED, so it is gone.
         Holding an item back for a partial failure cannot help the kinds it was written for -
         live, goal, red and ft are edge-triggered and their baseline advances on the same tick,
         so a held item is never offered again - and it actively harmed the ones re-queued every
         tick: k30, predopen and fxlock all carry renotify, so ONE endpoint returning 429 meant
         everybody else was buzzed three times, a minute apart, for the same notification. The
         honest statement is the original one: a delivery that reached anybody is recorded, and a
         partial failure is a known gap rather than a reason to re-alert a whole audience. */
      if (q.kind !== "livecard" && (qOk > 0 || targets.length === 0 || qFail === 0)) {
        sent.push({ id: q.id, ts: now });
      }
      if (qFail > 0) console.log(JSON.stringify({ message: "partial delivery", id: q.id, ok: qOk, fail: qFail }));
    }
  }

  /* persist ledgers (never on dry runs, so tests stay side-effect free) */
  if (!dry && store) {
    try { await store.put("states", pruneStates(states, now)); } catch (_) {}
    try { await store.put("sent", pruneSent(sent, now)); } catch (_) {}
    /* a dead endpoint is deleted by ITS OWN key - no wholesale list rewrite, no wipe guard
       needed, because there is no longer a write that could take the whole list with it */
    for (const d of deadAll) { try { await store.delete("sub:" + d); } catch (_) {} }
  }
  /* THE MAIL PIPE HAS A PULSE CHECK. Signup confirmations and password resets fail silently
     from the user's side - the app says "sent" and nothing arrives. The account store counts
     consecutive delivery failures; three in a row wakes the owner, once, and recovery clears
     the alarm. */
  if (!dry && store) {
    try {
      const st = await accountStore(env).fetch("https://accounts.local/stats", { method: "POST", body: "{}" }).then(r => r.json());
      const mf = Number(st.mailFails) || 0;
      const flagged = await store.get("mailAlerted");
      if (mf >= 3 && !flagged) {
        await alertOwnerMsg(env, store, "maildown", "⚠️ Goallak: emails are failing",
          "The last " + mf + " emails failed to send. Signups and password resets are stuck.");
        await store.put("mailAlerted", Date.now());
      } else if (mf === 0 && flagged) { await store.delete("mailAlerted"); }
    } catch (_) {}
  }
  return { ok: true, dry, subs: subs.length, queued: queued.map(q => q.id), delivered, failed, dead: deadAll.size };
}

/* ---------- test send ---------- */
async function testSend(env, store) {
  const subsRaw = await loadSubsRaw(store);
  if (subsRaw === READ_FAILED) return { ok: false, error: "subs read failed" };
  const subs = normalizeSubs(subsRaw);
  if (!subs.length) return { ok: false, error: "no subscriptions" };
  const privateJWK = privateJwkFromEnv(env);
  let delivered = 0, failed = 0;
  for (const lang of ["ar", "en"]) {
    const list = subs.filter(s => (s.lang || "ar") === lang || (lang === "en" && (s.lang || "ar") !== "ar"));
    if (!list.length) continue;
    const built = {
      payload: {
        title: lang === "ar" ? "🎉 تنبيهات جولك تعمل!" : "🎉 Goallak alerts are working!",
        body: lang === "ar" ? "الجول جولك · ستصلك الأهداف والنتائج أولًا بأول" : "El Goal Goallak · goals and results as they happen",
        icon: APP_URL + "icon-192.png", badge: APP_URL + "badge.png", tag: "gk-test", url: APP_URL
      },
      options: { ttl: 600, urgency: "high", topic: "gk-test" }
    };
    const res = await sendTo(list, built, env, privateJWK);
    delivered += res.ok; failed += res.fail;
  }
  return { ok: true, subs: subs.length, delivered, failed };
}

async function safeEqualText(provided, expected) {
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(provided || ""))),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(expected || "")))
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}
async function isAdmin(request, env) {
  if (!env.PUSH_ADMIN_TOKEN) return false;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const token = bearer || new URL(request.url).searchParams.get("token") || "";
  return !!token && await safeEqualText(token, env.PUSH_ADMIN_TOKEN);
}
function coordinator(env) {
  const id = env.PUSH_COORDINATOR.idFromName("global");
  return env.PUSH_COORDINATOR.get(id);
}

export class PushCoordinator {
  constructor(state, env) { this.env = env; this.state = state; this.chain = Promise.resolve(); }
  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    const url = new URL(request.url);
    /* real serialization: DO input gates open during awaited fetches, so chain runs explicitly */
    if (url.pathname === "/feed") {
      const f = (await (this.state && this.state.storage ? this.state.storage.get("feed") : null)) || null;
      return json(f ? { ok: f.fail === 0, failMinutes: f.fail || 0, lastOk: f.lastOk || 0 }
                    : { ok: null, failMinutes: 0, lastOk: 0 });
    }
    if (url.pathname === "/sub-set") {
      const rec = body && body.rec;
      if (!rec || !rec.endpoint) return json({ ok: false, error: "bad-sub" }, 400);
      const key = "sub:" + String(rec.endpoint);
      /* A CEILING ON NEW ENDPOINTS, NEVER ON EXISTING ONES. Re-subscribing a device already
         in the store always succeeds - a real user's endpoint rotating, a language change, a
         new followed team - so nobody can be locked out of their own record. Only a
         previously unseen endpoint has to fit under the cap, which bounds what an
         unauthenticated flood can cost to "no new subscribers" instead of "no subscribers". */
      const existing = await this.state.storage.get(key);
      if (!existing) {
        const all = await this.state.storage.list({ prefix: "sub:" });
        if (all.size >= SUB_CAP) return json({ ok: false, error: "sub-cap" }, 507);
      }
      await this.state.storage.put(key, rec);
      return json({ ok: true });
    }
    /* THE EGYPTIAN FEED, read side. Every route here is a storage read; the writes happen in
       egyptTick under the cron, so a phone - or a thousand - can never cause a provider call.
       A bad id answers 404 in the same JSON shape rather than throwing. */
    if (url.pathname === "/egy-board") {
      /* ?dates=YYYYMMDD or YYYYMMDD-YYYYMMDD (ESPN's own spelling, so the shell's URL rewrite is
         mechanical), ?team=<id> for a club's schedule; anything malformed is simply ignored */
      const ymd = v => /^[0-9]{8}$/.test(v) ? v.slice(0, 4) + "-" + v.slice(4, 6) + "-" + v.slice(6, 8) : /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) ? v : null;
      const dates = String(url.searchParams.get("dates") || url.searchParams.get("day") || "").split("-").filter(Boolean);
      const q = {};
      if (dates.length === 1 && dates[0].length === 8) q.from = q.to = ymd(dates[0]);
      else if (dates.length === 2 && dates[0].length === 8) { q.from = ymd(dates[0]); q.to = ymd(dates[1]); }
      else if (dates.length === 3) q.from = q.to = ymd(dates.join("-"));
      const team = String(url.searchParams.get("team") || "").replace(/[^0-9]/g, "");
      if (team) q.team = team;
      return json(await egyBoard(this.state.storage, q, !!afDoor(this.env)));
    }
    if (url.pathname === "/egy-summary") { const s = await egySummary(this.state.storage, url.searchParams.get("fixture") || ""); return s ? json(s) : json({ ok: false, error: "unknown fixture" }, 404); }
    if (url.pathname === "/egy-standings") { const s = await egyStandings(this.state.storage); return s ? json(s) : json({ ok: false, error: "no table yet" }, 404); }
    if (url.pathname === "/egy-status") return json(await egyStatus(this.env, this.state.storage, Date.now()));
    if (url.pathname === "/sub-all") {
      /* the chat room's push audience, read from HERE rather than from a store the whole
         internet can write to - see sendChatPush */
      const m = await this.state.storage.list({ prefix: "sub:" });
      return json({ ok: true, subs: [...m.values()] });
    }
    if (url.pathname === "/sub-del") {
      if (body && body.endpoint) await this.state.storage.delete("sub:" + String(body.endpoint));
      return json({ ok: true });
    }
    const job = url.pathname === "/test"
      ? () => testSend(this.env, this.state && this.state.storage)
      : () => runOnce(this.env, body.dry !== false, this.state && this.state.storage);
    const p = this.chain.then(job, job);
    this.chain = p.then(() => {}, () => {});
    return json(await p);
  }
}

/* THE KEY MATERIAL IS A SPEC, SO CHECK IT AGAINST THE SPEC. p256dh is an uncompressed
   P-256 point - 65 bytes - and auth is 16 bytes of entropy (RFC 8291); both arrive
   base64url. This used to accept any non-empty string, so {"p256dh":"x","auth":"y"} was a
   valid subscriber. That mattered more than it looks: the send path lists the store by KEY,
   which is the endpoint, in lexicographic order, and keeps the first 5000 - so a few
   thousand records beginning "https://aaa..." would sort ahead of every real
   fcm.googleapis.com and web.push.apple.com endpoint and push the actual audience off the
   end of the list. Every notification would stop, for everybody, while /health stayed green
   because the match feed was fine. */
const B64URL = /^[A-Za-z0-9_-]+=*$/;
function b64urlBytes(s) {
  if (!s || !B64URL.test(s)) return -1;
  const pad = s.replace(/=+$/, "").length;
  return Math.floor(pad * 3 / 4);          /* base64url has no separators: 4 chars -> 3 bytes */
}
/* a push subscription record, held to the shape the app has ever sent - and nothing else */
function sanitizeSubRec(b) {
  if (!b || typeof b !== "object") return null;
  const ep = String(b.endpoint || "");
  if (!/^https:\/\//.test(ep) || ep.length > 1900) return null;
  const k = b.keys && typeof b.keys === "object" ? b.keys : {};
  const rec = {
    endpoint: ep,
    keys: { p256dh: String(k.p256dh || "").slice(0, 300), auth: String(k.auth || "").slice(0, 120) },
    lgs: Array.isArray(b.lgs) ? b.lgs.slice(0, 16).map(x => String(x).slice(0, 12)) : [],
    teams: Array.isArray(b.teams) ? b.teams.slice(0, 10).map(x => String(x).slice(0, 12)) : [],
    events: Array.isArray(b.events) ? b.events.slice(0, 30).map(x => String(x).slice(0, 20)) : [],
    lang: String(b.lang || "ar").slice(0, 2),
    uid: b.uid ? String(b.uid).slice(0, 40) : null,
    name: b.name ? String(b.name).slice(0, 60) : null,
    ts: Number(b.ts) || Date.now()
  };
  if (!rec.keys.p256dh || !rec.keys.auth) return null;
  if (b64urlBytes(rec.keys.p256dh) !== 65 || b64urlBytes(rec.keys.auth) !== 16) return null;
  return rec;
}

const APP_ORIGINS = new Set(["https://goallak.com", "https://www.goallak.com"]);
function allowedOrigin(request) {
  const origin = request.headers.get("origin") || "";
  if (APP_ORIGINS.has(origin)) return origin;
  try {
    const parsed = new URL(origin);
    if ((parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && parsed.protocol === "http:") return origin;
  } catch (_) { /* missing/invalid Origin */ }
  return "";
}
function withApiCors(response, request) {
  const origin = allowedOrigin(request);
  const headers = new Headers(response.headers);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");   /* DELETE = message removal; without it the browser blocks the preflight */
  headers.set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Media-Duration");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function apiPreflight(request) {
  if (!allowedOrigin(request)) return json({ ok: false, error: "origin not allowed" }, 403);
  return withApiCors(new Response(null, { status: 204 }), request);
}
async function chatApi(request, env, url) {
  if (request.method === "OPTIONS") return apiPreflight(request);
  if (request.headers.get("origin") && !allowedOrigin(request)) return withApiCors(json({ ok: false, error: "origin not allowed" }, 403), request);
  try {
    if (url.pathname === "/api/session") return withApiCors(await issueChatSession(request, env), request);

    /* Accounts + predictions. Signup / login / verify / reset are reachable WITHOUT a session
       (you cannot have one yet); every other route resolves its uid from the signed token
       inside accountsApi, never from the request body. */
    /* counting a visit needs no account, by design: the point is how many PEOPLE, and
       requiring a login would only count the ones who already signed up */
    if (url.pathname === "/api/visit" && request.method === "POST")
      return withApiCors(await accountsApi(request, env, url, null), request);
    /* the Egyptian league: board / summary / standings / status, served from what the cron
       stored in the coordinator. Nothing a client sends can reach the provider. */
    if (url.pathname.startsWith("/api/egy/")) {
      const sub = url.pathname.slice(9).replace(/[^a-z]/g, "");
      if (!["board", "summary", "standings", "status"].includes(sub)) return withApiCors(json({ ok: false, error: "not found" }, 404), request);
      const id = env.PUSH_COORDINATOR.idFromName("global");
      const r = await env.PUSH_COORDINATOR.get(id).fetch("https://coord/egy-" + sub + url.search, { method: "POST", body: "{}" });
      const out = new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=20" } });
      return withApiCors(out, request);
    }
    if (url.pathname.startsWith("/api/espn-core/")) return withApiCors(await espnCoreProxy(request, url), request);
    /* public read-only sports data; the edge cache is the rate limiter */
    if (url.pathname.startsWith("/api/espn/"))
      return withApiCors(await espnProxy(request, url), request);
    /* the push subscription store - public like the old one was, but validated and OURS */
    if (url.pathname === "/api/push/subscribe" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const rec = sanitizeSubRec(b);
      if (!rec) return withApiCors(json({ ok: false, error: "bad-sub" }, 400), request);
      const id = env.PUSH_COORDINATOR.idFromName("global");
      return withApiCors(await env.PUSH_COORDINATOR.get(id).fetch("https://coordinator/sub-set", { method: "POST", body: JSON.stringify({ rec }) }), request);
    }
    if (url.pathname === "/api/push/unsubscribe" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const id = env.PUSH_COORDINATOR.idFromName("global");
      return withApiCors(await env.PUSH_COORDINATOR.get(id).fetch("https://coordinator/sub-del", { method: "POST", body: JSON.stringify({ endpoint: String(b.endpoint || "").slice(0, 1900) }) }), request);
    }
    if (url.pathname.startsWith("/api/auth") || url.pathname.startsWith("/api/pred")
      || url.pathname.startsWith("/api/fx")) {
      /* /api/fx/board is open for the same reason /api/pred/leaderboard is: a standings table
         is public by nature. Reading or WRITING one manager's own squad is not. */
      const open = /\/api\/auth\/(signup|login|verify|request-reset|reset|export|import|clubs)$/.test(url.pathname)
        || url.pathname === "/api/fx/board";
      const authed = await authenticateChatRequest(request, env);
      if (!open && !authed) return withApiCors(json({ ok: false, error: "unauthorized" }, 401), request);
      return withApiCors(await accountsApi(request, env, url, authed), request);
    }

    const session = await authenticateChatRequest(request, env);
    if (!session) return withApiCors(json({ ok: false, error: "unauthorized" }, 401), request);
    if (url.pathname === "/api/session/refresh" && request.method === "POST") return withApiCors(await renewChatSession(session, env), request);
    if (url.pathname === "/api/chat/ws") {
      if (request.method !== "GET" || (request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
        return withApiCors(json({ ok: false, error: "websocket required" }, 426), request);
      }
      return openChatSocket(request, env, session);
    }
    if (url.pathname === "/api/chat/history" && request.method === "GET") return withApiCors(await chatHistory(request, env), request);
    if (url.pathname === "/api/chat/message" && request.method === "POST") return withApiCors(await postChatMessage(request, env, session), request);
    if (url.pathname === "/api/chat/media" && request.method === "POST") return withApiCors(await uploadChatMedia(request, env, session), request);
    if (url.pathname === "/api/chat/media-url" && request.method === "GET") return withApiCors(await refreshMediaUrl(request, env), request);
    if (url.pathname === "/api/chat/message" && request.method === "DELETE") return withApiCors(await deleteChatMessage(request, env, session), request);
    if (url.pathname === "/api/chat/react" && request.method === "POST") return withApiCors(await reactChatMessage(request, env, session), request);
    return withApiCors(json({ ok: false, error: "not found" }, 404), request);
  } catch (error) {
    console.error(JSON.stringify({ message: "chat API failed", path: url.pathname, error: String(error) }));
    return withApiCors(json({ ok: false, error: "service temporarily unavailable" }, 503), request);
  }
}

export default {
  async scheduled(controller, env, ctx) {
    const dry = env.DRY_RUN !== "false";
    ctx.waitUntil(coordinator(env).fetch("https://push.local/run", { method: "POST", body: JSON.stringify({ dry }) }));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      /* THE DEADLINE INDEX HAS TO BE VISIBLE. The cron writes every fixture's kick-off time
         into the account store so the prediction lock is a server rule rather than a browser
         one - and a write that silently stops happening would turn that lock back off with
         nothing anywhere saying so. A count, and only a count: no ids, no times, no names. */
      /* only when asked: /health is unauthenticated and hit by uptime checks, and every call
         was waking the account store Durable Object to count a table */
      /* the feed's own health, so "are the notifications alive" is a question anyone can ask
         without reading a log */
      let feed = null;
      try {
        const st = coordinator(env);
        const r = await st.fetch("https://push.local/feed", { method: "POST", body: "{}" });
        feed = await r.json();
      } catch (_) {}
      let kicks = null;
      if (url.searchParams.get("kicks")) {
        try {
          const r = await accountStore(env).fetch("https://accounts.local/kicks-count", { method: "POST", body: "{}" });
          const j = await r.json();
          kicks = j && j.ok ? j.n : null;
        } catch (_) {}
      }
      return json({
        ok: true,
        brand: "Goallak",
        dryDefault: env.DRY_RUN !== "false",
        chat: !!env.CHAT_ROOM,
        media: !!env.CHAT_MEDIA,
        chatAuth: !!env.CHAT_AUTH_SECRET,
        /* WITHOUT A KEY, EVERY MAIL IS A LOG LINE. sendMail deliberately does not fail when
           RESEND_API_KEY is missing - it logs the link and reports undelivered - which is the
           right behaviour for the code and a trap for the owner: "forgot password" looks
           finished and no message ever leaves. This is the one place that says so out loud. */
        mail: !!env.RESEND_API_KEY,
        kicks,
        feed
      });
    }

    if (url.pathname === "/api/broadcasts") {
      if (request.method === "OPTIONS") return apiPreflight(request);
      if (request.headers.get("origin") && !allowedOrigin(request)) return withApiCors(json({ ok: false, error: "origin not allowed" }, 403), request);
      return withApiCors(await broadcastScheduleResponse(request, ctx), request);
    }
    if (url.pathname === "/api/session" || url.pathname.startsWith("/api/session/") || url.pathname.startsWith("/api/chat/")
      || url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/pred/")
      || url.pathname.startsWith("/api/fx/") || url.pathname.startsWith("/api/espn/") || url.pathname.startsWith("/api/egy/") || url.pathname.startsWith("/api/espn-core/")
      || url.pathname.startsWith("/api/push/")
      || url.pathname === "/api/visit") return chatApi(request, env, url);
    if (url.pathname.startsWith("/media/") && request.method === "GET") {
      try { return withApiCors(await serveChatMedia(request, env), request); }
      catch (error) {
        console.error(JSON.stringify({ message: "chat media read failed", error: String(error) }));
        return withApiCors(new Response("Service unavailable", { status: 503 }), request);
      }
    }

    /* /tdb proxy: some ISP DNS setups cannot resolve textdb.online; the app falls back to this.
       Keys are restricted to goalak_*.

       WRITES ARE LOCKED TO THE APP ORIGIN. This used to answer POST with
       Access-Control-Allow-Origin:*, which let ANY page on the internet script writes into the
       accounts / predictions / leaderboard store through this proxy. Locking it does NOT make
       that data safe - textdb.online is world-writable by design, so a server-side client can
       still write to it directly, no CORS involved. It only closes the easy browser path.
       The real fix is moving accounts + predictions behind this worker with server-side auth,
       the way chat already works (HMAC sessions, ownership checked in the DO). */
    if (url.pathname === "/tdb" || url.pathname.startsWith("/tdb/")) {
      const origin = allowedOrigin(request);
      const rdCors = { "Access-Control-Allow-Origin": origin || "*", "Vary": "Origin", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
      if (request.method === "OPTIONS") {
        if (!origin) return json({ ok: false, error: "origin not allowed" }, 403);
        return new Response(null, { status: 204, headers: rdCors });
      }
      if (request.method === "GET") {
        const key = url.pathname.slice(5).replace(/[^A-Za-z0-9_-]/g, "");
        if (!/^goalak_/.test(key)) return json({ ok: false, error: "forbidden key" }, 403);
        const r = await fetch("https://textdb.online/" + key + "?t=" + Date.now(), { cf: { cacheTtl: 0 } });
        return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...rdCors } });
      }
      if (request.method === "POST") {
        /* writes require the real app origin - not localhost, not a missing Origin */
        if (!APP_ORIGINS.has(request.headers.get("origin") || "")) {
          return new Response(JSON.stringify({ ok: false, error: "origin not allowed for writes" }), { status: 403, headers: { "Content-Type": "application/json", ...rdCors } });
        }
        const body = await request.text();
        const params = new URLSearchParams(body);
        if (!/^goalak_/.test(params.get("key") || "")) return json({ ok: false, error: "forbidden key" }, 403);
        const r = await fetch("https://api.textdb.online/update/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
        return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8", ...rdCors } });
      }
      return json({ ok: false, error: "method" }, 405);
    }
    if (!await isAdmin(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
    if (url.pathname === "/run") {
      const dryParam = url.searchParams.get("dry");
      const dry = dryParam == null ? env.DRY_RUN !== "false" : dryParam !== "0" && dryParam !== "false";
      if (!dry && env.DRY_RUN !== "false") return json({ ok: false, error: "DRY_RUN is true; flip the var before live sends" }, 409);
      return coordinator(env).fetch("https://push.local/run", { method: "POST", body: JSON.stringify({ dry }) });
    }
    if (url.pathname === "/test") return coordinator(env).fetch("https://push.local/test", { method: "POST", body: "{}" });
    /* admin-only account operations: verify the legacy import landed, retry it, remove a QA account */
    if (url.pathname === "/accounts/visits") return accountStore(env).fetch("https://accounts.local/visits", { method: "POST", body: "{}" });
    if (url.pathname === "/accounts/stats") return accountStore(env).fetch("https://accounts.local/stats", { method: "POST", body: "{}" });
    if (url.pathname === "/accounts/import" && request.method === "POST") return accountStore(env).fetch("https://accounts.local/import-now", { method: "POST", body: "{}" });
    if (url.pathname === "/accounts/fx-import" && request.method === "POST") return accountStore(env).fetch("https://accounts.local/fx-import-now", { method: "POST", body: "{}" });
    if (url.pathname === "/accounts/delete" && request.method === "POST") {
      return accountStore(env).fetch("https://accounts.local/delete-user", { method: "POST", headers: { "Content-Type": "application/json" }, body: await request.text() });
    }
    return json({ ok: false, error: "not found" }, 404);
  }
};
