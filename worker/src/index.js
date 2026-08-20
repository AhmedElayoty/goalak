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

export { ChatRoom, AccountStore };

const LEAGUES = [
  { id: "ucl", slug: "uefa.champions", en: "Champions League", ar: "دوري الأبطال" },
  { id: "ucl", slug: "uefa.champions_qual", en: "UCL Qualifying", ar: "تصفيات دوري الأبطال" },
  { id: "uel", slug: "uefa.europa", en: "Europa League", ar: "الدوري الأوروبي" },
  { id: "uel", slug: "uefa.europa_qual", en: "UEL Qualifying", ar: "تصفيات الدوري الأوروبي" },
  { id: "epl", slug: "eng.1", en: "Premier League", ar: "الدوري الإنجليزي" },
  { id: "liga", slug: "esp.1", en: "La Liga", ar: "الدوري الإسباني" },
  { id: "seriea", slug: "ita.1", en: "Serie A", ar: "الدوري الإيطالي" },
  { id: "bun", slug: "ger.1", en: "Bundesliga", ar: "الدوري الألماني" },
  { id: "fl1", slug: "fra.1", en: "Ligue 1", ar: "الدوري الفرنسي" },
  { id: "tsl", slug: "tur.1", en: "Süper Lig", ar: "الدوري التركي" },
  { id: "spl", slug: "sco.1", en: "Scottish Premiership", ar: "الدوري الأسكتلندي" }
];
const APP_URL = "https://goallak.com/";
const SUBS_KEY = "goalak_push_subs";
const SENT_KEY = "goalak_push_sent";
const STATE_KEY = "goalak_push_states";
const SENT_CAP = 400;

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
function isVoided(e) { return /POSTPON|CANCEL|SUSPEND/.test(statusName(e)); }
function normalizeSubs(list) {
  const map = new Map();
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) continue;
    map.set(s.endpoint, s);
  }
  return [...map.values()].slice(0, 500); /* junk-flood cap: an open store must not make the worker unbounded */
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
function buildPayload(kind, e, lg, lang) {
  const { h, a, hs, as } = names(e);
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
    const scorer = lastScorer(e);
    title = (ar ? "⚽ جوووول! " : "⚽ GOAL! ") + h + " " + hs + " - " + as + " " + a;
    body = (scorer ? scorer + " · " : "") + lgName;
  } else if (kind === "red") {
    title = (ar ? "🟥 طرد · " : "🟥 Red card · ") + h + " × " + a;
    body = lgName;
  } else if (kind === "ft") {
    title = (ar ? "🏁 انتهت · " : "🏁 FT · ") + h + " " + hs + " - " + as + " " + a;
    body = lgName;
  } else {
    title = "GOALLAK"; body = ar ? "الجول جولك" : "El Goal Goallak";
  }
  return {
    payload: { title, body, icon: APP_URL + "icon-192.png", badge: APP_URL + "badge.png", tag, url: APP_URL },
    options: { ttl: 3600, urgency: "high", topic: tag.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, "-") }
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
async function runOnce(env, dry) {
  const now = Date.now();
  const subsRaw = await tdbRead(SUBS_KEY, []);
  if (subsRaw === READ_FAILED) return { ok: false, dry, error: "subs read failed - run aborted" };
  const subs = normalizeSubs(subsRaw);
  if (!subs.length) return { ok: true, dry, subs: 0, queued: [] };

  /* a failed ledger read must ABORT the run: proceeding with empty ledgers would resend and lose baselines */
  const sentRaw = await tdbRead(SENT_KEY, []);
  const statesRaw = await tdbRead(STATE_KEY, {});
  if (sentRaw === READ_FAILED || statesRaw === READ_FAILED) return { ok: false, dry, error: "ledger read failed - run aborted" };
  let sent = pruneSent(sentRaw, now);
  const sentIds = new Set(sent.map(s => s.id));
  let states = pruneStates(statesRaw, now);

  const range = utcYMD(now - 86400000) + "-" + utcYMD(now + 86400000);
  const boards = await Promise.all(LEAGUES.map(l =>
    fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/" + l.slug + "/scoreboard?dates=" + range + "&limit=300")
      .then(r => r.ok ? r.json() : null).catch(() => null)
  ));

  const queued = [];
  const queue = (id, kind, e, lg) => {
    if (sentIds.has(id)) return;
    queued.push({ id, kind, e, lg });
    sentIds.add(id); /* in-run dedupe only; the persisted ledger entry is added AFTER a delivery attempt succeeds */
  };

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

      /* 30-minute reminder: real window only, once */
      const mins = (kickoff - now) / 60000;
      if (st === "pre" && mins >= 25 && mins <= 35) queue("k30-" + e.id, "k30", e, lg);

      if (!rec) {
        /* first observation: record only; live send only if genuinely near kickoff (no stale backfill) */
        if (st === "in" && (now - kickoff) < 12 * 60000) queue("live-" + e.id, "live", e, lg);
        states[e.id] = { st, hs: nh, as: na, red: reds, ts: now, kickoff };
        continue;
      }
      if (rec.st === "pre" && st === "in" && (now - kickoff) < 20 * 60000) queue("live-" + e.id, "live", e, lg);
      if (st === "in" && (nh > (rec.hs || 0) || na > (rec.as || 0)) && (now - (rec.ts || 0)) < 10 * 60000) {
        queue("goal-" + e.id + "-" + nh + "-" + na, "goal", e, lg);
      }
      if (st === "in" && reds > (rec.red || 0) && (now - (rec.ts || 0)) < 10 * 60000) {
        queue("red-" + e.id + "-" + reds, "red", e, lg);
      }
      if (rec.st === "in" && st === "post") queue("ft-" + e.id, "ft", e, lg);
      states[e.id] = { st, hs: nh, as: na, red: reds, ts: now, kickoff };
    }
  });

  let delivered = 0, failed = 0;
  const deadAll = new Set();
  if (!dry && queued.length) {
    const privateJWK = privateJwkFromEnv(env);
    for (const q of queued) {
      const targets = subs.filter(s => {
        const lgs = Array.isArray(s.lgs) ? s.lgs : [];
        return !lgs.length || lgs.includes(q.lg.id);
      });
      let qOk = 0, qFail = 0;
      const byLang = { ar: targets.filter(s => (s.lang || "ar") === "ar"), en: targets.filter(s => (s.lang || "ar") !== "ar") };
      for (const lang of ["ar", "en"]) {
        if (!byLang[lang].length) continue;
        const built = buildPayload(q.kind, q.e, q.lg, lang);
        const res = await sendTo(byLang[lang], built, env, privateJWK);
        qOk += res.ok; qFail += res.fail;
        res.dead.forEach(d => deadAll.add(d));
      }
      delivered += qOk; failed += qFail;
      /* total failure = leave unmarked so the next run retries (tag replaces, so no stacking) */
      if (qOk > 0 || targets.length === 0 || qFail === 0) sent.push({ id: q.id, ts: now });
    }
  }

  /* persist ledgers (never on dry runs, so tests stay side-effect free) */
  if (!dry) {
    await tdbWrite(STATE_KEY, pruneStates(states, now)).catch(() => {});
    await tdbWrite(SENT_KEY, pruneSent(sent, now)).catch(() => {});
    if (deadAll.size) {
      /* wipe guard: a dead endpoint by definition came from a non-empty list, so an
         empty/failed re-read means "do not touch the subs key this run" */
      const freshRaw = await tdbRead(SUBS_KEY, []);
      if (freshRaw !== READ_FAILED) {
        const fresh = normalizeSubs(freshRaw);
        if (fresh.length) await tdbWrite(SUBS_KEY, fresh.filter(s => !deadAll.has(s.endpoint))).catch(() => {});
      }
    }
  }
  return { ok: true, dry, subs: subs.length, queued: queued.map(q => q.id), delivered, failed, dead: deadAll.size };
}

/* ---------- test send ---------- */
async function testSend(env) {
  const subsRaw = await tdbRead(SUBS_KEY, []);
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
  constructor(state, env) { this.env = env; this.chain = Promise.resolve(); }
  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    const url = new URL(request.url);
    /* real serialization: DO input gates open during awaited fetches, so chain runs explicitly */
    const job = url.pathname === "/test"
      ? () => testSend(this.env)
      : () => runOnce(this.env, body.dry !== false);
    const p = this.chain.then(job, job);
    this.chain = p.then(() => {}, () => {});
    return json(await p);
  }
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
    if (url.pathname.startsWith("/api/auth") || url.pathname.startsWith("/api/pred")
      || url.pathname.startsWith("/api/fx")) {
      /* /api/fx/board is open for the same reason /api/pred/leaderboard is: a standings table
         is public by nature. Reading or WRITING one manager's own squad is not. */
      const open = /\/api\/auth\/(signup|login|verify|request-reset|reset)$/.test(url.pathname)
        || url.pathname === "/api/pred/leaderboard" || url.pathname === "/api/fx/board";
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
    if (url.pathname === "/health") return json({
      ok: true,
      brand: "Goallak",
      dryDefault: env.DRY_RUN !== "false",
      chat: !!env.CHAT_ROOM,
      media: !!env.CHAT_MEDIA,
      chatAuth: !!env.CHAT_AUTH_SECRET
    });

    if (url.pathname === "/api/broadcasts") {
      if (request.method === "OPTIONS") return apiPreflight(request);
      if (request.headers.get("origin") && !allowedOrigin(request)) return withApiCors(json({ ok: false, error: "origin not allowed" }, 403), request);
      return withApiCors(await broadcastScheduleResponse(request, ctx), request);
    }
    if (url.pathname === "/api/session" || url.pathname.startsWith("/api/session/") || url.pathname.startsWith("/api/chat/")
      || url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/pred/")
      || url.pathname.startsWith("/api/fx/")) return chatApi(request, env, url);
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
    if (url.pathname === "/accounts/stats") return accountStore(env).fetch("https://accounts.local/stats", { method: "POST", body: "{}" });
    if (url.pathname === "/accounts/import" && request.method === "POST") return accountStore(env).fetch("https://accounts.local/import-now", { method: "POST", body: "{}" });
    if (url.pathname === "/accounts/fx-import" && request.method === "POST") return accountStore(env).fetch("https://accounts.local/fx-import-now", { method: "POST", body: "{}" });
    if (url.pathname === "/accounts/delete" && request.method === "POST") {
      return accountStore(env).fetch("https://accounts.local/delete-user", { method: "POST", headers: { "Content-Type": "application/json" }, body: await request.text() });
    }
    return json({ ok: false, error: "not found" }, 404);
  }
};
