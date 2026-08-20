import { DurableObject } from "cloudflare:workers";
import { buildPushHTTPRequest } from "@pushforge/builder";

const APP_URL = "https://goallak.com/";
const CHAT_ROOM_NAME = "friends";
import { accountStore } from "./accounts.js";

const ACCOUNTS_KEY = "goalak_accounts";   /* legacy read path, kept for the chat club map only */
const LEGACY_CHAT_KEY = "goalak_room";
const PUSH_SUBS_KEY = "goalak_push_subs";
const SESSION_LIFETIME_MS = 30 * 86400000;
const MEDIA_LINK_LIFETIME_MS = 7 * 86400000;
/* The six the WC app offered, and the ONLY six accepted. An allow-list rather than free
   text: an arbitrary "emoji" is an arbitrary string, and this one is stored, counted and
   rendered back to everybody in the room. */
const REACTIONS = ["❤️", "😂", "👏", "😮", "😢", "🔥"];
const CHAT_CAP = 200;
const encoder = new TextEncoder();

const MEDIA_RULES = {
  image: { max: 8 * 1024 * 1024, types: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]) },
  audio: { max: 15 * 1024 * 1024, types: new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"]) },
  video: { max: 50 * 1024 * 1024, types: new Set(["video/mp4", "video/webm", "video/quicktime"]) }
};

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function bytesToB64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(value) {
  const source = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(source.padEnd(Math.ceil(source.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function cleanName(value) {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 40);
}

async function hmacKey(secret) {
  if (!secret || String(secret).length < 24) throw new Error("CHAT_AUTH_SECRET is not configured");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signValue(value, secret) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(value));
  return bytesToB64url(new Uint8Array(signature));
}

async function verifyValue(value, signature, secret) {
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(secret), b64urlToBytes(signature), encoder.encode(value));
  } catch (_) {
    return false;
  }
}

async function issueToken(account, env) {
  const now = Date.now();
  const payload = {
    uid: String(account.uid || "").slice(0, 80),
    name: cleanName(account.username),
    iat: now,
    exp: now + SESSION_LIFETIME_MS,
    nonce: crypto.randomUUID()
  };
  const encoded = bytesToB64url(encoder.encode(JSON.stringify(payload)));
  return { token: encoded + "." + await signValue(encoded, env.CHAT_AUTH_SECRET), exp: payload.exp, user: { uid: payload.uid, name: payload.name } };
}

export async function verifySessionToken(token, env) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 2 || !await verifyValue(parts[0], parts[1], env.CHAT_AUTH_SECRET)) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    if (!payload || !payload.uid || !payload.name || Number(payload.exp) <= Date.now()) return null;
    return { uid: String(payload.uid).slice(0, 80), name: cleanName(payload.name), exp: Number(payload.exp) };
  } catch (_) {
    return null;
  }
}

function tokenFromRequest(request) {
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;
  const protocols = (request.headers.get("sec-websocket-protocol") || "").split(",").map(value => value.trim());
  const marker = protocols.indexOf("goallak-chat");
  return marker >= 0 ? (protocols[marker + 1] || "") : "";
}

export async function authenticateChatRequest(request, env) {
  return verifySessionToken(tokenFromRequest(request), env);
}

async function readSmallJson(request, limit = 4096) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > limit) throw new Error("request-too-large");
  const text = await request.text();
  if (text.length > limit) throw new Error("request-too-large");
  return JSON.parse(text || "{}");
}

async function textdbRead(key, fallback) {
  try {
    const response = await fetch("https://textdb.online/" + key + "?t=" + Date.now(), { cf: { cacheTtl: 0 } });
    if (!response.ok) return { ok: false, value: fallback };
    const text = (await response.text()).trim();
    if (!text) return { ok: true, value: fallback };
    return { ok: true, value: JSON.parse(text) };
  } catch (_) {
    return { ok: false, value: fallback };
  }
}

function hexToBytes(value) {
  if (!/^[0-9a-f]{64}$/i.test(String(value || ""))) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function issueChatSession(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let body;
  try { body = await readSmallJson(request); }
  catch (_) { return json({ ok: false, error: "invalid request" }, 400); }
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (username.length < 2 || username.length > 18 || password.length < 4 || password.length > 200) {
    return json({ ok: false, error: "invalid credentials" }, 401);
  }
  /* ONE credential authority. This used to read textdb directly and verify the old single-round
     hash here; it now defers to the AccountStore, so password checking, the PBKDF2 upgrade and
     the account state all live in exactly one place. Two verifiers would drift. */
  let account = null;
  try {
    const response = await accountStore(env).fetch("https://accounts.local/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.user) return json({ ok: false, error: "invalid credentials" }, 401);
    account = data.user;
  } catch (error) {
    console.error(JSON.stringify({ message: "account store unavailable", error: String(error) }));
    return json({ ok: false, error: "account store unavailable" }, 503);
  }
  try {
    /* An UNVERIFIED account still gets a session on purpose: the four imported accounts have no
       email yet, and locking them out to enforce a rule they pre-date would be punishing them
       for our change. The app nags; Fantasy will gate on `verified`. */
    return json({ ok: true, ...await issueToken({ uid: account.uid, username: account.username }, env), user: account });
  } catch (error) {
    console.error(JSON.stringify({ message: "chat session configuration error", error: String(error) }));
    return json({ ok: false, error: "chat is not configured" }, 503);
  }
}

export async function renewChatSession(session, env) {
  if (!session || !session.uid || !session.name || Number(session.exp) <= Date.now()) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  try {
    return json({ ok: true, ...await issueToken({ uid: session.uid, username: session.name }, env) });
  } catch (error) {
    console.error(JSON.stringify({ message: "chat session refresh failed", error: String(error) }));
    return json({ ok: false, error: "chat is not configured" }, 503);
  }
}

export function roomStub(env) {
  return env.CHAT_ROOM.getByName(CHAT_ROOM_NAME, { locationHint: "me" });
}

function normalizeLegacyMessages(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter(item => item && item.id && item.uid && item.txt && !seen.has(item.id) && seen.add(item.id))
    .map(item => ({
      id: String(item.id).slice(0, 100), uid: String(item.uid).slice(0, 80), name: cleanName(item.name || "?"),
      kind: "text", text: String(item.txt).trim().slice(0, 500), ts: Math.max(1, Number(item.ts) || Date.now())
    }))
    .filter(item => item.text)
    .sort((a, b) => a.ts - b.ts)
    .slice(-80);
}

async function ensureLegacyImported(env, stub) {
  if (!await stub.needsLegacyImport()) return;
  const legacy = await textdbRead(LEGACY_CHAT_KEY, []);
  if (!legacy.ok) return;
  await stub.importLegacy(normalizeLegacyMessages(legacy.value));
}

function encodeMediaKey(key) {
  return bytesToB64url(encoder.encode(key));
}

function decodeMediaKey(encoded) {
  try { return new TextDecoder().decode(b64urlToBytes(encoded)); }
  catch (_) { return ""; }
}

async function signedMediaUrl(request, env, key) {
  const encoded = encodeMediaKey(key);
  const expires = Date.now() + MEDIA_LINK_LIFETIME_MS;
  const signature = await signValue("media:" + encoded + ":" + expires, env.CHAT_AUTH_SECRET);
  return new URL(request.url).origin + "/media/" + encoded + "?e=" + expires + "&s=" + signature;
}

async function messageForClient(request, env, message) {
  const output = { ...message };
  if (output.mediaKey) output.mediaUrl = await signedMediaUrl(request, env, output.mediaKey);
  return output;
}

export async function deleteChatMessage(request, env, session) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  if (!id) return json({ ok: false, error: "missing id" }, 400);
  const stub = roomStub(env);
  const result = await stub.deleteMessage({ uid: session.uid, name: session.name }, id);
  return json(result, result.ok ? 200 : 403);
}

export async function chatHistory(request, env) {
  const stub = roomStub(env);
  await ensureLegacyImported(env, stub);
  const messages = await stub.getHistory(120);
  return json({ ok: true, messages: await Promise.all(messages.map(message => messageForClient(request, env, message))) });
}

export async function postChatMessage(request, env, session) {
  let body;
  try { body = await readSmallJson(request); }
  catch (_) { return json({ ok: false, error: "invalid request" }, 400); }
  const text = String(body.text || "").trim().slice(0, 500);
  if (!text) return json({ ok: false, error: "empty message" }, 400);
  const stub = roomStub(env);
  await ensureLegacyImported(env, stub);
  const message = await stub.sendText(session, text);
  return json({ ok: true, message });
}

function mediaKind(contentType) {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("video/")) return "video";
  return "";
}

function monthPath(date) {
  return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0");
}

export async function uploadChatMedia(request, env, session) {
  if (!request.body) return json({ ok: false, error: "empty upload" }, 400);
  const contentType = String(request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  const kind = mediaKind(contentType);
  const rule = MEDIA_RULES[kind];
  if (!rule || !rule.types.has(contentType)) return json({ ok: false, error: "unsupported media type" }, 415);
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) return json({ ok: false, error: "content length required" }, 411);
  if (declaredSize > rule.max) return json({ ok: false, error: "file too large", maxBytes: rule.max }, 413);
  const durationMs = Math.min(10 * 60 * 1000, Math.max(0, Number(request.headers.get("x-media-duration") || 0) || 0));
  const key = "chat/" + CHAT_ROOM_NAME + "/" + monthPath(new Date()) + "/" + crypto.randomUUID() + "." + MIME_EXTENSIONS[contentType];
  let stored;
  try {
    /* Incoming request bodies retain their known length, allowing R2 to stream without buffering. */
    stored = await env.CHAT_MEDIA.put(key, request.body, {
      httpMetadata: { contentType, cacheControl: "private, max-age=604800" },
      customMetadata: { uid: session.uid, name: session.name, kind, durationMs: String(durationMs) }
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "chat media upload failed", error: String(error) }));
    return json({ ok: false, error: "upload failed" }, 502);
  }
  if (!stored) return json({ ok: false, error: "upload failed" }, 502);
  const stub = roomStub(env);
  await ensureLegacyImported(env, stub);
  const mediaUrl = await signedMediaUrl(request, env, key);
  try {
    const message = await stub.sendMedia(session, {
      kind, mediaKey: key, mediaType: contentType, mediaSize: stored.size, durationMs, mediaUrl
    });
    return json({ ok: true, message });
  } catch (error) {
    await env.CHAT_MEDIA.delete(key).catch(() => {});
    console.error(JSON.stringify({ message: "chat media message failed", error: String(error) }));
    return json({ ok: false, error: "message failed" }, 502);
  }
}

export async function refreshMediaUrl(request, env) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!key.startsWith("chat/" + CHAT_ROOM_NAME + "/") || key.length > 300) return json({ ok: false, error: "invalid key" }, 400);
  const object = await env.CHAT_MEDIA.head(key);
  if (!object) return json({ ok: false, error: "not found" }, 404);
  return json({ ok: true, url: await signedMediaUrl(request, env, key) });
}

export async function serveChatMedia(request, env) {
  const url = new URL(request.url);
  const encoded = url.pathname.slice("/media/".length);
  const expires = Number(url.searchParams.get("e") || 0);
  const signature = url.searchParams.get("s") || "";
  if (!encoded || expires < Date.now() || expires > Date.now() + MEDIA_LINK_LIFETIME_MS + 60000 ||
      !await verifyValue("media:" + encoded + ":" + expires, signature, env.CHAT_AUTH_SECRET)) {
    return new Response("Forbidden", { status: 403 });
  }
  const key = decodeMediaKey(encoded);
  if (!key.startsWith("chat/" + CHAT_ROOM_NAME + "/")) return new Response("Forbidden", { status: 403 });
  const object = await env.CHAT_MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
  if (!object) return new Response("Not Found", { status: 404 });
  if (!object.body) return new Response(null, { status: 304, headers: { ETag: object.httpEtag } });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=3600");
  let status = 200;
  if (request.headers.has("range") && object.range && "offset" in object.range && object.range.offset != null) {
    const length = object.range.length || Math.max(0, object.size - object.range.offset);
    headers.set("Content-Range", "bytes " + object.range.offset + "-" + (object.range.offset + length - 1) + "/" + object.size);
    headers.set("Content-Length", String(length));
    status = 206;
  }
  return new Response(object.body, { status, headers });
}

export async function openChatSocket(request, env, session) {
  const stub = roomStub(env);
  await ensureLegacyImported(env, stub);
  const headers = new Headers(request.headers);
  headers.set("x-goallak-chat-session", bytesToB64url(encoder.encode(JSON.stringify(session))));
  headers.set("sec-websocket-protocol", "goallak-chat");
  return stub.fetch(new Request(request.url, { method: "GET", headers }));
}

function privateJwkFromEnv(env) {
  const pub = b64urlToBytes(env.VAPID_PUBLIC_KEY || "");
  const d = b64urlToBytes(env.VAPID_PRIVATE_KEY || "");
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error("VAPID keys unavailable");
  return { kty: "EC", crv: "P-256", x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), d: bytesToB64url(d) };
}

async function sendChatPush(env, message, activeUids) {
  if (!env.VAPID_PRIVATE_KEY) return;
  const result = await textdbRead(PUSH_SUBS_KEY, []);
  if (!result.ok) return;
  const targets = [];
  const endpoints = new Set();
  for (const sub of Array.isArray(result.value) ? result.value : []) {
    if (!sub || !sub.endpoint || endpoints.has(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) continue;
    if (!sub.uid || sub.uid === message.uid || activeUids.has(String(sub.uid))) continue;
    endpoints.add(sub.endpoint);
    targets.push(sub);
    if (targets.length >= 500) break;
  }
  if (!targets.length) return;
  const privateJWK = privateJwkFromEnv(env);
  for (let start = 0; start < targets.length; start += 20) {
    await Promise.all(targets.slice(start, start + 20).map(async sub => {
      const ar = (sub.lang || "ar") === "ar";
      const mediaLabel = message.kind === "image" ? (ar ? "📷 صورة" : "📷 Photo") :
        message.kind === "video" ? (ar ? "🎬 فيديو" : "🎬 Video") :
        message.kind === "audio" ? (ar ? "🎤 رسالة صوتية" : "🎤 Voice note") : message.text;
      const payload = {
        title: "💬 " + message.name + " · Goallak", body: mediaLabel || (ar ? "رسالة جديدة" : "New message"),
        icon: APP_URL + "icon-192.png", badge: APP_URL + "badge.png", tag: "goallak-chat", url: APP_URL + "?go=chat"
      };
      try {
        const built = await buildPushHTTPRequest({
          privateJWK,
          subscription: { endpoint: sub.endpoint, keys: sub.keys },
          message: { payload, adminContact: env.VAPID_SUBJECT || APP_URL, options: { ttl: 3600, urgency: "normal", topic: "goallak-chat" } }
        });
        await fetch(built.endpoint, { method: "POST", headers: built.headers, body: built.body });
      } catch (_) { /* dead endpoints are pruned by the scheduled match-alert run */ }
    }));
  }
}

function rowToMessage(row) {
  return {
    id: row.id, uid: row.uid, name: row.name, kind: row.kind, text: row.text || "", txt: row.text || "",
    mediaKey: row.media_key || "", mediaType: row.media_type || "", mediaSize: Number(row.media_size) || 0,
    durationMs: Number(row.duration_ms) || 0, ts: Number(row.ts) || 0
  };
}

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  migrate() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const current = this.ctx.storage.sql.exec("SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations").one().version;
    if (current < 1) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          uid TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          text TEXT,
          media_key TEXT,
          media_type TEXT,
          media_size INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          ts INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);
        CREATE TABLE IF NOT EXISTS room_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO _sql_schema_migrations (id) VALUES (1);
      `);
    }
  }

  /* REACTIONS.
     The WC app had these and Goallak did not, which is the whole reason this exists. That
     version stored them by reading the entire room, merging, and writing it back — with a
     retry loop, a wipe guard and a random backoff, because two people reacting in the same
     moment could silently lose one. None of that is needed here: this is a Durable Object with
     a single writer, so a reaction is one row.

     ONE ROW PER (message, person, emoji), which makes the table a SET. Toggling is therefore
     idempotent: a double tap, a replayed socket frame, or the same person on two devices all
     land on the same state instead of racing, and nothing can ever be counted twice. */
  #ensureReactions() {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS reactions (
      mid TEXT NOT NULL, uid TEXT NOT NULL, emoji TEXT NOT NULL, ts INTEGER NOT NULL,
      PRIMARY KEY (mid, uid, emoji))`);
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_reactions_mid ON reactions(mid)");
  }

  /* emoji -> [uid, ...] for one message, which is the shape the client renders directly */
  #rxOf(id) {
    this.#ensureReactions();
    const out = {};
    for (const r of this.ctx.storage.sql.exec("SELECT uid,emoji FROM reactions WHERE mid = ?", String(id))) {
      (out[r.emoji] = out[r.emoji] || []).push(String(r.uid));
    }
    return out;
  }

  /* the same for a whole page of history, in ONE query rather than one per message */
  rxFor(ids) {
    this.#ensureReactions();
    if (!ids.length) return {};
    const marks = ids.map(() => "?").join(",");
    const out = {};
    for (const r of this.ctx.storage.sql.exec(
      "SELECT mid,uid,emoji FROM reactions WHERE mid IN (" + marks + ")", ...ids)) {
      const m = out[r.mid] = out[r.mid] || {};
      (m[r.emoji] = m[r.emoji] || []).push(String(r.uid));
    }
    return out;
  }

  async toggleReaction(session, id, emoji) {
    const mid = String(id || "").slice(0, 80);
    const e = String(emoji || "").slice(0, 16);
    if (!mid || !e || !REACTIONS.includes(e)) return { ok: false, error: "invalid reaction" };
    /* reacting to a message that is gone must not leave an orphan row behind */
    const exists = this.ctx.storage.sql.exec("SELECT id FROM messages WHERE id = ?", mid).toArray()[0];
    if (!exists) return { ok: false, error: "no message" };
    this.#ensureReactions();
    const uid = String(session.uid).slice(0, 80);
    const had = this.ctx.storage.sql.exec(
      "SELECT uid FROM reactions WHERE mid = ? AND uid = ? AND emoji = ?", mid, uid, e).toArray()[0];
    if (had) this.ctx.storage.sql.exec("DELETE FROM reactions WHERE mid = ? AND uid = ? AND emoji = ?", mid, uid, e);
    else this.ctx.storage.sql.exec("INSERT INTO reactions (mid,uid,emoji,ts) VALUES (?,?,?,?)", mid, uid, e, Date.now());
    const rx = this.#rxOf(mid);
    const payload = JSON.stringify({ type: "react", id: mid, rx });
    for (const socket of this.ctx.getWebSockets()) { try { socket.send(payload); } catch (_) {} }
    return { ok: true, id: mid, rx };
  }

  async needsLegacyImport() {
    const row = this.ctx.storage.sql.exec("SELECT value FROM room_meta WHERE key = 'legacy_imported'").toArray()[0];
    return !row;
  }

  async importLegacy(messages) {
    const already = this.ctx.storage.sql.exec("SELECT value FROM room_meta WHERE key = 'legacy_imported'").toArray()[0];
    if (already) return;
    for (const message of Array.isArray(messages) ? messages : []) {
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO messages (id,uid,name,kind,text,ts) VALUES (?,?,?,?,?,?)",
        message.id, message.uid, message.name, "text", message.text, message.ts
      );
    }
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO room_meta (key,value) VALUES ('legacy_imported',?)", String(Date.now()));
    this.trimHistory();
  }

  async getHistory(limit = 120) {
    const safeLimit = Math.min(CHAT_CAP, Math.max(1, Number(limit) || 120));
    const rows = this.ctx.storage.sql.exec(
      "SELECT id,uid,name,kind,text,media_key,media_type,media_size,duration_ms,ts FROM messages ORDER BY seq DESC LIMIT ?",
      safeLimit
    ).toArray().reverse();
    /* history carries its reactions, or every message arrives blank and only fills in when
       somebody reacts again while you happen to be watching */
    const msgs = rows.map(rowToMessage);
    const rx = this.rxFor(msgs.map(m => m.id));
    for (const m of msgs) if (rx[m.id]) m.rx = rx[m.id];
    return msgs;
  }

  trimHistory() {
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE seq NOT IN (SELECT seq FROM messages ORDER BY seq DESC LIMIT ?)", CHAT_CAP);
  }

  persist(session, value) {
    const message = {
      id: crypto.randomUUID(), uid: String(session.uid).slice(0, 80), name: cleanName(session.name),
      kind: value.kind, text: String(value.text || "").slice(0, 500), mediaKey: String(value.mediaKey || "").slice(0, 300),
      mediaType: String(value.mediaType || "").slice(0, 100), mediaSize: Math.max(0, Number(value.mediaSize) || 0),
      durationMs: Math.max(0, Number(value.durationMs) || 0), ts: Date.now()
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO messages (id,uid,name,kind,text,media_key,media_type,media_size,duration_ms,ts) VALUES (?,?,?,?,?,?,?,?,?,?)",
      message.id, message.uid, message.name, message.kind, message.text || null, message.mediaKey || null,
      message.mediaType || null, message.mediaSize, message.durationMs, message.ts
    );
    this.trimHistory();
    return message;
  }

  broadcast(message) {
    const payload = JSON.stringify({ type: "message", message });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(payload); } catch (_) { /* stale sockets disappear from getWebSockets */ }
    }
  }

  activeUids() {
    const ids = new Set();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment && attachment.uid) ids.add(String(attachment.uid));
    }
    return ids;
  }

  notify(message) {
    this.ctx.waitUntil(sendChatPush(this.env, message, this.activeUids()).catch(error => {
      console.error(JSON.stringify({ message: "chat push failed", error: String(error) }));
    }));
  }

  async sendText(session, text) {
    const value = String(text || "").trim().slice(0, 500);
    if (!value) throw new Error("empty message");
    const message = this.persist(session, { kind: "text", text: value });
    this.broadcast(message);
    this.notify(message);
    return message;
  }

  /* delete-for-everyone, ownership enforced server-side: a client can only ever remove its OWN
     message, whatever it claims. Media objects are removed from R2 too so nothing is left orphaned. */
  async deleteMessage(session, id) {
    const row = this.ctx.storage.sql.exec("SELECT id,uid,media_key FROM messages WHERE id = ?", String(id || "")).toArray()[0];
    if (!row) return { ok: true, removed: false };
    if (String(row.uid) !== String(session.uid)) return { ok: false, error: "not your message" };
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE id = ?", row.id);
    /* or the rows outlive the message and the table grows for ever */
    this.#ensureReactions();
    this.ctx.storage.sql.exec("DELETE FROM reactions WHERE mid = ?", row.id);
    if (row.media_key) this.ctx.waitUntil(this.env.CHAT_MEDIA.delete(row.media_key).catch(() => {}));
    const payload = JSON.stringify({ type: "delete", id: row.id });
    for (const socket of this.ctx.getWebSockets()) { try { socket.send(payload); } catch (_) {} }
    return { ok: true, removed: true, id: row.id };
  }

  async sendMedia(session, media) {
    if (!MEDIA_RULES[media.kind] || !String(media.mediaKey || "").startsWith("chat/" + CHAT_ROOM_NAME + "/")) throw new Error("invalid media");
    const message = this.persist(session, media);
    message.mediaUrl = String(media.mediaUrl || "");
    this.broadcast(message);
    this.notify(message);
    return message;
  }

  async fetch(request) {
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") return json({ ok: false, error: "websocket required" }, 426);
    let session;
    try {
      const encoded = request.headers.get("x-goallak-chat-session") || "";
      session = JSON.parse(new TextDecoder().decode(b64urlToBytes(encoded)));
    } catch (_) { return json({ ok: false, error: "unauthorized" }, 401); }
    if (!session || !session.uid || !session.name || Number(session.exp) <= Date.now()) return json({ ok: false, error: "unauthorized" }, 401);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["room:" + CHAT_ROOM_NAME]);
    server.serializeAttachment({ uid: session.uid, name: session.name, exp: session.exp, joinedAt: Date.now() });
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": "goallak-chat" } });
  }

  async webSocketMessage(socket, rawMessage) {
    const session = socket.deserializeAttachment();
    if (!session || Number(session.exp) <= Date.now()) { socket.close(4001, "Session expired"); return; }
    if (typeof rawMessage !== "string" || rawMessage.length > 4096) { socket.send(JSON.stringify({ type: "error", error: "invalid message" })); return; }
    let value;
    try { value = JSON.parse(rawMessage); }
    catch (_) { socket.send(JSON.stringify({ type: "error", error: "invalid message" })); return; }
    if (value.type === "message") {
      try { await this.sendText(session, value.text); }
      catch (_) { socket.send(JSON.stringify({ type: "error", error: "message failed" })); }
    }
    /* a reaction is a socket verb like a message, so everyone in the room sees it at once —
       and the uid comes from the socket's OWN session, never from the frame */
    if (value.type === "react") {
      try { await this.toggleReaction(session, value.id, value.emoji); }
      catch (_) { socket.send(JSON.stringify({ type: "error", error: "reaction failed" })); }
    }
  }

  async webSocketClose(socket, code, reason) {
    try { socket.close(code, reason); } catch (_) { /* auto close reply is enabled for the compatibility date */ }
  }
}
