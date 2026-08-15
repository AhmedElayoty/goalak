/* Goalak service worker
   CACHE changelog (bump on EVERY deploy, newest first):
   goalak-v11  2026-08-15  v1.7: permanent "🏆 توقعات دوري أبطال أوروبا" banner at the top of the predictions tab (owner: the tab must say it is UCL).
   goalak-v10  2026-08-15  v1.6 owner design pass: 3D bottom nav (gradient bar, gold hairline, raised glowing orb on the active tab, custom SVG icons - fantasy star replaced with an FPL-style jersey); leaderboard podium (top-3 with crown + gold/silver/bronze avatar rings); "Predict now" hero card with the live count of open UCL matches.
   goalak-v9   2026-08-15  v1.5: (a) install/download option visible like the WC app - dismissible install bar above the bottom nav (native prompt when offered, clear AR/EN instructions otherwise) + Settings install row always shown when not installed; (b) CHAT ported - new دردشة nav tab, fresh goalak_room textdb key with the WC room rules (80-message cap, dedupe by id, wipe guard, verify-after-write), fixed composer, unread badge, 12s poll in-tab + background badge checks.
   goalak-v8   2026-08-15  v1.4 WC-app essentials (owner call-outs): LIVE NOW strip (today's in-play matches across all leagues, fresh even while browsing other days); Arabic club names everywhere (~150-club FilGoal-register map, owner to validate spellings); header sign-in button + account row in Settings; favourite club (signup + Settings picker, leaderboard/userchip badges, home hero card with the club's next fixture); "التفاصيل" hint on live/finished rows pointing to the goals/cards timeline modal.
   goalak-v7   2026-08-15  v1.3: predictions now UCL-ONLY (owner call; qualifying play-offs predictable now, league phase auto-follows the draw); new third bottom-nav tab GOALAK Fantasy showing a branded "قريبًا / Soon" teaser only.
   goalak-v6   2026-08-14  v1.2: web-push handlers (payload-driven, WC-style) + badge icon precached; textdb bypassed so live data and subs never get cached.
   goalak-v5   2026-08-14  v1.2: Bundesliga added; prediction game (accounts + picks + leaderboard, goalak_* textdb keys); country flag images via flagcdn (bypassed here); readability scale-up; bottom nav; install row; Android back handling.
   goalak-v4   2026-08-14  Brand package integration: official Goal Gate mark (header + favicon), aubergine app icons from the owner's brand package, Alexandria wordmark font.
   goalak-v3   2026-08-14  v1.1 WC-app feature port: settings sheet (lang/theme/timezone/12-24h), light theme, TZ-aware times + live clock bar, compact one-screen league rail, stats hero tiles, GF/GA standings columns.
   goalak-v2   2026-08-14  QA pass: WCup navy palette; precise shell matching vs SW scope; non-ok responses fall back to cached shell; redirected responses re-wrapped before use/caching; cache writes tied to event lifetime.
   goalak-v1   2026-08-14  v1.0 initial build: 7 leagues, all-leagues day view, league pages (matches / table / stats), AR/EN RTL.
*/
const CACHE = "goalak-v11";
const SHELL = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png", "icon-180.png", "favicon.svg", "logo-head.svg", "logo-mark-pos.svg", "logo-mark-rev.svg", "badge.png"];
/* Third-party hosts are never intercepted (live data + shared state must ride the network). */
const BYPASS = /espn\.com|espncdn\.com|googleapis\.com|gstatic\.com|flagcdn\.com|textdb\.online/;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isShellReq(req) {
  if (req.mode === "navigate") return true;
  const scopePath = new URL(self.registration.scope).pathname;
  const p = new URL(req.url).pathname;
  return p === scopePath || p === scopePath + "index.html";
}

/* Responses that arrived via redirect cannot be replayed for navigations; re-wrap the body. */
async function unredirect(r) {
  if (!r.redirected) return r;
  const b = await r.blob();
  return new Response(b, { status: 200, headers: { "Content-Type": r.headers.get("Content-Type") || "text/html" } });
}

/* ===== Web Push ===== payload (JSON) from the goalak-push Worker:
   { title, body, icon?, badge?, tag, renotify?, silent?, url } */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (_) { try { d = { title: "Goalak", body: e.data.text() }; } catch (__) { d = {}; } }
  const opts = {
    body: d.body || "",
    icon: d.icon || "./icon-192.png",
    badge: d.badge || "./badge.png",
    tag: d.tag || undefined,
    renotify: d.renotify != null ? !!d.renotify : !!d.tag,
    silent: !!d.silent,
    data: { url: d.url || "./" },
    vibrate: d.silent ? undefined : [80, 40, 80]
  };
  e.waitUntil(self.registration.showNotification(d.title || "Goalak", opts));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) {
      if ("focus" in c) { try { await c.focus(); if ("navigate" in c) { try { await c.navigate(target); } catch (_) {} } return; } catch (_) {} }
    }
    if (clients.openWindow) { try { return await clients.openWindow(target); } catch (_) {} }
  })());
});

self.addEventListener("fetch", e => {
  const url = e.request.url;
  if (e.request.method !== "GET" || BYPASS.test(url)) return;
  if (isShellReq(e.request)) {
    /* network-first with no-store so every deploy shows on the next open; cache is the offline fallback */
    e.respondWith((async () => {
      try {
        let r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error("http " + r.status);
        r = await unredirect(r);
        const cp = r.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put("index.html", cp)).catch(() => {}));
        return r;
      } catch (_) {
        const m = await caches.match("index.html");
        return m || caches.match("./");
      }
    })());
    return;
  }
  /* static assets: cache-first */
  e.respondWith((async () => {
    const m = await caches.match(e.request);
    if (m) return m;
    const r = await fetch(e.request);
    if (r && r.ok && !r.redirected) {
      const cp = r.clone();
      e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, cp)).catch(() => {}));
    }
    return r;
  })());
});
