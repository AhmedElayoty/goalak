/* Goallak service worker
   CACHE changelog (bump on EVERY deploy, newest first):
   goalak-v39  2026-08-16  v4.5 LESSONS-LEARNED AUDIT FIXES. A dedicated audit of this app against the WC app's LESSONS_LEARNED, the pre-deploy checklist and the WC sw.js bug changelog found 7 violations and 12 partials; 5 of the 7 were the SAME failure mode - a fix applied to some surfaces and not all. Fixed: (BLOCKER) the midnight live bug was still live one layer down - the strip/chip/count were state-gated in v4.2 but the LIVE LIST and the MATCH SHEET keyed off _gkLeagueId, which was written only inside mrow() i.e. only for the browsed day, so a match that kicked off before midnight showed "live (1)" beside an empty list and opened with no timeline, line-ups, stats, Star of the Match or TV channel; events are now tagged where they are CACHED, one writer, so every consumer sees them. (HIGH) .pname was declared bare for the pitch and reused by the leaderboard podium - in LIGHT theme the 2nd and 3rd place names were white on white, invisible; the pitch class is renamed .gkPname (the .msg collision, third occurrence). (HIGH) Serie A existed in the app but never in the push worker, so Serie A alerts were dead and anyone who selected only Serie A got zero notifications with the toggle showing ON. (HIGH) "failed" was being rendered as "empty" in three more places: a failed prediction read scored a real player 0 points, a failed standings fetch was persisted as "this league has no clubs" for SEVEN DAYS (breaking the favourite-club picker and the friendlies filter), and an empty chat history overwrote the local cache. (HIGH) saveClubToAccount rewrote the whole shared accounts object with no wipe guard and no verify-after-write - a signup landing between its read and write was erased; it now uses the same 3-attempt guarded loop as doAuth. (HIGH) not one ESPN scoreboard call sent &limit=, the exact bug that hid an entire knockout round in the WC app (v3.31) - club friendlies were already at 60 of the silent 100-event cap; all six calls now go through one sbUrl() helper. Also: the day now follows midnight on RESUME, not just while the tab is visible (an installed app is backgrounded across midnight every night); the leaderboard's Math.min(150) would have started silently decaying every player's total from 2026-12-29 - the cap is gone and the season anchor, the previous-season chip and the season labels are all derived instead of hardcoded; the footer version marker is driven from APP_VERSION instead of hand-typed; five aria-labels and the AM·PM/24H buttons are localised; Escape closes only the topmost sheet and the player card and sign-in sheet push history entries so Back stops eating the tab's entry; a live match no longer appears in BOTH Upcoming and Results; the player card follows a language change; a cross-midnight match keeps its TV channel; .mx got an explicit z-index; and sw.js is never served by itself.
   goalak-v38  2026-08-16  v4.4 STALE-APP FIX (root cause of "my app still shows the old version"): GitHub Pages serves sw.js with Cache-Control max-age=600, so update checks were being answered from the HTTP cache - the browser never saw a new worker, so controllerchange never fired and FORCE_RELOAD never ran. Now registered with updateViaCache:"none" so the worker script is always revalidated. A home-screen app that is only resumed never navigates either, so it now calls registration.update() on resume/focus and every 5 minutes. Plus an independent last-resort guard: fetch index.html no-store, compare APP_VERSION, and reload ONCE (guarded per version in sessionStorage) if this client is behind - so a stuck client recovers even if the service worker misbehaves.
   goalak-v37  2026-08-16  v4.3: FORCE_RELOAD token bumped to 2026-08-16-v43 - it had been stuck on the v3.3 token, so nobody with the app already open (or installed to the home screen) had been forced to refresh through nine releases. Every existing client now hard-reloads exactly ONCE on this update and lands on v4.3.
   goalak-v36  2026-08-16  v4.2: (1) REPEAT OF WC LESSON v2.66 - a match that kicked off before midnight vanished from LIVE at 00:00 because the live set was filtered by calendar day. The live set is now gated on STATE ONLY and spans today + yesterday, for the strip, the LIVE chip, the count and the filtered list; both days are also kept warm by the refresh tick whatever day is on screen. (2) Scroll no longer chains from an open sheet into the page behind it: overscroll-behavior:contain plus a real body scroll lock that restores the exact scroll position on close. (3) Serie A added (ita.1) with Arabic names for all 20 clubs.
   goalak-v35  2026-08-16  v4.1: 3D icon set. All five bottom-nav icons become layered-gradient SVG with a separate active state (white + gold on the rust pill), and the emoji that varied by platform (⚽ 🟨 🟥 in the timeline, scorer lines and match events) become inline 3D symbols. One sprite of gradients + symbols, all gk3d- prefixed, ~2.7KB gzipped, no SVG filters so Android WebView stays fast. The chat bubble was redrawn with a centred tail so it is identical when mirrored for Arabic.
   goalak-v34  2026-08-15  v4.0 QA sweep fixes: (HIGH) Arabic match sheet showed the score one way in the header and the other way in the timeline - running scores and the FT marker now follow the same orientation; (HIGH) a LIVE friendly/international was invisible in the LIVE strip, chip and count because those groups were filtered out - LIVE now covers every competition; (HIGH) ESPN returns subbedIn/subbedOut as objects, so a whole pre-match XI was flagged as substituted on AND off - the flag is read properly now; (MED) league lists refresh every 20s once a match has kicked off instead of holding an ESPN snapshot for 90s; (MED) tab->tab navigation replaces its history entry so Back never needs repeated presses; (MED) substitutes are no longer all rated with the midfield model - a role is inferred from what they actually did; de-duplication now keeps a genuine same-day double-header (different venues, hours apart) while still collapsing ESPN's ghost records; chat send button + chat bar strings localise at boot; Star of the Match keeps the player's position.
   goalak-v33  2026-08-15  v3.9: tap any player (on the pitch or in the line-up list) for a card with his ESPN match kit, rating and full stat line; the Star of the Match card now leads with that kit image too. ESPN has NO player headshots for football (verified: 91 of 92 athlete ids 404 on the headshot pattern) but DOES ship a per-match rendered jersey PNG in light and dark variants (42/42 coverage) - they are 1440px/~218KB and cannot be resized, so they are used only where one image earns its weight (star card + on-demand player card), never 22-at-once on the pitch. Also: settings sheet showed a stale hardcoded v3.2, and .pchip/.lnrow were being re-declared in a second CSS section (the .msg-collision pattern) - both fixed.
   goalak-v32  2026-08-15  v3.8: (a) you can DELETE your own chat messages - trash icon on your bubbles, confirm, removed for everyone (worker re-checks ownership server-side and drops the R2 media too, live "delete" event over the socket); (b) voice notes now PREVIEW before upload - play it back, then Send or bin it, nothing leaves the phone until you press send; (c) de-duplicate fixtures: ESPN published Liverpool v Como twice (a ghost 10:30Z record with no venue next to the real 17:00Z one at Anfield) - same teams on the same day now collapse to the better-sourced record (venue > live/finished > broadcast/odds detail).
   goalak-v31  2026-08-15  v3.7: line-ups now appear BEFORE kick-off like the WC app - tapping a scheduled match opens the pitch as soon as ESPN publishes the XI (roughly an hour before), with a "line-ups usually appear about an hour before kick-off" note until then. A pre-match summary with no XI yet is re-checked every 2 minutes instead of being cached empty for the session, and match rows within 90 minutes of kick-off carry a التشكيل hint.
   goalak-v30  2026-08-15  v3.6 QA-sweep fixes: BLOCKER penalty-shootout kicks were listed as goals under each club (5 "goals" beside a 1-1 scoreline) - now excluded like the timeline already did; Android Back no longer exits the app from Predictions/Fantasy/Chat/Settings (each tab pushes a history entry, Back returns to Matches); alerts toggle localised (إيقاف/تشغيل); 9 top-division clubs added to the Arabic name map (هال، ديبورتيفو، ملقا، إلفرسبرغ، بادربورن، شالكه، لوهافر، لومان، تروا); day-key arithmetic moved to UTC so picking a zone west of the device no longer shifts the date strip by a day; a deep link while Chat/Settings was open no longer renders two panes; leaderboard shows a specific "results unavailable" banner instead of a generic load error; chat badge no longer clips its icon; the day auto-advances at midnight; player ratings now derive goal difference from the scoreline so team-mates are judged on the same rule; aria-labels localised and the settings gear got an accessible name.
   goalak-v29  2026-08-15  v3.5: Summary is now the WC app's TWO-SIDED timeline - centre spine, home events on one side and away on the other, newest first, running score under each goal, substitutions included, goal rows tinted on the scoring side, and the whole thing mirrored for Arabic. Line-ups: subs lists stack full-width on phones and each carries its club name, so nothing needs sideways reading.
   goalak-v28  2026-08-15  v3.4: owner call - the "unofficial app" line is gone entirely (footer is now just brand · motto · version); string, markup and both JS setters removed, nothing left anywhere in the app.
   goalak-v27  2026-08-15  v3.3: FIX bottom-nav labels stayed Arabic on a fresh English load (they were only repainted on a language CHANGE, never at boot) - all five labels now come from one paintNavLabels() used by boot and setLang. Also ported the WC app's FORCE_RELOAD token: bump it and every already-open client hard-reloads exactly once.
   goalak-v26  2026-08-15  v3.2 owner pass: (1) bottom nav rebuilt around a big raised centre orb for MATCHES - Predictions + Fantasy on one side, Chat + Settings on the other, and Settings is now a full page instead of a dropdown; (2) tapping a date shows a spinner while that day is still fetching (it used to flash "no matches / retry" before the data landed); (3) Line-ups now render the REAL pitch from the WC app (formation string -> depth lines -> football-sensible lanes, per-player rating badges and goal/card icons on the shirt, subs listed underneath), goal scorers are listed under each club in the match header, and the stats tab is a proper aligned card with fixed side columns.
   goalak-v25  2026-08-15  v3.1: owner call - drop all data-source name-dropping from the UI. Footer is just "تطبيق غير رسمي", and the TV row shows the channel alone with no "Source: FilGoal/Yallakora" link. Sourcing still happens exactly as before behind the scenes.
   goalak-v24  2026-08-15  v3.0: STAR OF THE MATCH + player ratings, ported from the WC app's engine and re-tuned for club data (club feeds have no xG/xA/duels and sparse tackles, so weight moved to goals, assists, key passes, defensiveInterventions, save% and clean sheets; keeper save-volume now has diminishing returns and keepers take a share of a defeat - a keeper with 11 saves in a 4-1 loss no longer outranks a brace). Ratings show per player in Line-ups; runners-up listed, and a near-tie is labelled instead of faking certainty. Cached per match in localStorage. Verified: GAL 4-1 COR -> Osimhen 9.7; DUN 2-0 ABE -> Bevan 8.6 (goal + assist).
   goalak-v23  2026-08-15  v2.9: tapping a played or in-play match now opens a tabbed detail sheet - Summary (goal/card timeline with assists), Line-ups (both formations, starting XI + used subs with jersey, position, goals/assists/cards/sub minute) and Stats (possession, shots, on target, corners, saves, fouls, offsides, passes, cards as comparison bars). Data from the ESPN match summary feed, cached per match, graceful when line-ups are not published yet.
   goalak-v22  2026-08-15  v2.8: Yallakora is the exact-channel fallback for FilGoal, broadcaster names remain channel-neutral, and predictions explain that they begin after UCL qualifying.
   goalak-v21  2026-08-15  v2.7: club friendlies are limited to fixtures involving at least one club from a tracked Goallak domestic league, reducing load and clutter.
   goalak-v20  2026-08-15  v2.6: club friendlies plus senior national-team official and friendly matches appear in All only; chat names now show each user's favourite club.
   goalak-v19  2026-08-15  v2.5: named TV channels are now shown only for exact fixture matches; league-rights fallback is labelled channel not confirmed instead of claiming a generic broadcaster.
   goalak-v18  2026-08-15  v2.4: selecting match-alert leagues no longer closes Settings after the league buttons re-render.
   goalak-v17  2026-08-15  v2.3: active live-match score refresh reduced from about 45 seconds to about 25 seconds; non-live schedules remain throttled.
   goalak-v16  2026-08-15  v2.2: MENA TV channels with verified rights fallback; mobile chat/header overlap fixes; renewable secure chat session; 1200x630 WhatsApp cover cache-bust.
   goalak-v15  2026-08-15  v2.1: Arabic UI wordmark is جولك; explicit wrong-username/wrong-password login feedback; WhatsApp/Open Graph social cover and feature description.
   goalak-v14  2026-08-15  v2.0: real-time Cloudflare chat, protected picture/video/voice-note media, secure chat sessions, and chat notifications.
   goalak-v13  2026-08-15  v1.9: public rebrand from Goalak to Goallak and custom-domain cutover to goallak.com; technical goalak_* namespaces retained for continuity.
   goalak-v12  2026-08-15  v1.8: chat is members-only (signed-out users see a sign-in wall, no room reads, badge hidden); stats hero tiles overlap fix (owner screenshot: big number over the team name - text now reserves the number's corner and ellipses).
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
const CACHE = "goalak-v39";
const SHELL = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png", "icon-180.png", "favicon.svg", "logo-head.svg", "logo-mark-pos.svg", "logo-mark-rev.svg", "badge.png"];
/* Third-party hosts are never intercepted (live data + shared state must ride the network). */
const BYPASS = /espn\.com|espncdn\.com|googleapis\.com|gstatic\.com|flagcdn\.com|textdb\.online|workers\.dev/;

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
  catch (_) { try { d = { title: "Goallak", body: e.data.text() }; } catch (__) { d = {}; } }
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
  e.waitUntil(self.registration.showNotification(d.title || "Goallak", opts));
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
  /* never let the worker mediate its own script — the update path must always hit the network */
  if (new URL(url).pathname.endsWith("sw.js")) return;
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
