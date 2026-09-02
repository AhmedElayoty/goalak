# Goallak (جولك) — working guide for any Claude session

Read this first, whether you are on the owner's PC or working from GitHub on a phone.
It records what the product is, how it ships, the decisions the owner has made, and the
mistakes already paid for. The changelog at the top of `sw.js` is the release history —
newest first, each entry written as a post-mortem. `docs/` holds the longer documents.

## What this is

Arabic-first (Egyptian Arabic) bilingual football PWA at **https://goallak.com** for the
owner's friends and family (~8 users, growing). Live scores for ten competitions, match
sheets (facts, line-ups, stats, timeline, ratings), web push, a private chat room, a
Champions-League-only predictions game, and a club-based fantasy game (`fantasy/`).
Owner: Ahmed Elayoty. He speaks in caps when something is wrong; treat every report as real
until proven otherwise, and prove it in a real browser before touching code.

## Two deployables — and only one of them ships from GitHub

| Part | Source of truth | How it goes live |
|---|---|---|
| Site (`index.html`, `sw.js`, `fantasy/`, `top-clubs.js`, assets) | this repo, `main` | GitHub Pages serves `main` at the `CNAME` (goallak.com). A push IS a deploy. |
| Cloudflare Worker (`worker/`) | **the owner's PC**: `Desktop\Claude Workspace\World Cup Fans App\goalak\worker` | `npx wrangler deploy` from that folder, by a PC session. `worker/` in this repo is the vendored RECORD, kept byte-identical after every deploy. |

**If you are on GitHub only (phone session): a change under `worker/` does NOT go live
until a PC session deploys it.** Say so in the commit and leave a note for the PC session.
Never treat `worker/` as deployable from here.

The repo is **PUBLIC** and Pages serves its whole tree — every file here is downloadable
from goallak.com. No credential, hash, token or private data may ever be committed. All
worker secrets are `env.*` wrangler secrets (`VAPID_PRIVATE_KEY`, `RESEND_API_KEY`,
`PUSH_ADMIN_TOKEN`, `CHAT_AUTH_SECRET`, `BACKUP_TOKEN`); `wrangler.toml [vars]` carries only
non-secrets. This was violated once (2026-08-28) and cost six users a password rotation.

## The release ritual (every change to `index.html`, `sw.js` or `fantasy/index.html`)

1. New changelog entry at the TOP of `sw.js`: `   goalak-vNNN YYYY-MM-DD  vX.Y  <post-mortem prose>`
2. `const CACHE = "goalak-vNNN"` in `sw.js` (+1)
3. `const APP_VERSION = "X.Y"` and `const FORCE_RELOAD = "YYYY-MM-DD-vXY"` in `index.html`
4. `const FX_BUILD = "X.Y"` in `fantasy/index.html`
5. `node check-release.mjs` must print "all consistent" — it refuses any mismatch.

Never reuse a version number. If `main` moved while you worked, re-version yours ABOVE
theirs (v6.84 collided once; it shipped as v6.84.2). `FORCE_RELOAD` makes every open
client hard-reload once — the owner dislikes churn, so worker-only or asset-only commits do
NOT bump.

`fantasy/modules.js` and `modules.css` are **generated** from `fantasy/src/` by
`node fantasy/src/build-bundle.mjs`. Edit `src/`, rebuild, commit both. A fix that only
touches `src/` passes its tests and ships nothing — this happened (Triple Captain, v6.84.1).

## Gates — all must pass before a commit (1,898 assertions as of 2026-09-02)

```
node check-release.mjs  check-sync.mjs  check-fantasy-tab.mjs  predscore.test.mjs
     aggregate.test.mjs  lineups.test.mjs
node fantasy/check.mjs  check-defined.mjs  check-ids.mjs  check-locks.mjs  check-tz.mjs
node fantasy/src/modules/*.test.mjs
node worker/fxmerge.test.mjs  worker/pushsub.test.mjs  worker/espnttl.test.mjs  worker/egypt.test.mjs
node fantasy/qa.mjs        # 261 live-browser assertions, 5 viewports x 2 languages — NEEDS CHROME (PC only)
node qa-chat.mjs           # needs Chrome too
```
Several gates lift functions straight out of the shipped HTML by name — renaming a
function can fail a gate; that is the point. Test files are post-mortems too: each case
names the incident it prevents.

## Owner decisions — constraints, not suggestions

- **Predictions are Champions League ONLY, for ever.** Weekend/league rounds were
  proposed and refused (2026-08-25). Do not re-raise.
- **Israeli clubs render the BRAND ONLY in Arabic** — مكابي / هابويل / بيتار — never a city
  or anything identifying nationality (2026-08-25). `AR_TEAMS` enforces it; keep it so.
- **No betting, odds or affiliate content, ever.** The data licence depends on it.
- **Crests:** the current friends-and-family build ships club crests (`fantasy/crests/`).
  The official/public launch must be crest-free (trademarks) — new features are built
  crest-free by construction (kit colour + three-letter code, e.g. the share card).
- **Fantasy: no full 15-club team = no score and no place in the rounds** (2026-08-28).
  `hasFullLineup` is the single question everything asks.
- **Fantasy chips are per round**: a chip is played into ONE round (`activeChipFor(gw)`)
  and consumed. Triple Captain adds one more copy of whatever the armband actually paid.
- **The homepage must not get more crowded** — new surfaces go in sheets, not on the home
  screen (~31% chrome budget). The hero card hides on days its match is pinned below.
- **Egyptian Premier League is PARKED (owner, 2026-09-02).** ESPN does not carry it and no
  free feed covers the current season; the owner chose not to pay for one league and not to
  read a publisher's pages. Everything built stays in place but hidden (see "The Egyptian
  feed") - do not delete it, and do not re-raise until the owner decides to pay for a feed,
  most likely a licensed one at the public launch. Its clubs still reach the app through the
  top-clubs dataset (`top-clubs.js`, group `egy`) and now have Arabic names.

## Competitions (v6.87): UCL, UEL, **UECL (new)**, PL, La Liga, Serie A, Bundesliga, Ligue 1, Süper Lig, SPFL

Declared in `LEAGUES` (index.html) and `LEAGUES` (worker/src/index.js) — both, always.
Fantasy reads its own `fantasy/clubs.json` (7 domestic leagues); predictions are
`pred:true` (UCL only). `coveredSlugSet()` derives from `LEAGUES`, so a promoted league
automatically leaves the "Top Clubs · Other Competitions" bucket.

## Architecture in one breath

All match data is ESPN, fetched through the worker's edge proxy `/api/espn/<path>`
(whitelist regex; TTL 45s, **15s while the payload contains a live match**, standings 300s,
schedules 3600s; stale copy served with `x-gk-stale:1` when ESPN is down) with a direct
ESPN fallback. The client repaints every 25s; a live score is typically ~20s old, worst
~41s. The worker cron runs every minute: kick-off/goal/red/FT/live-card/line-up pushes,
fantasy deadline reminders, UCL prediction-open. Goals are held ~55s on purpose (never beat
the TV). Accounts, predictions, fantasy records and kick-off times live in a Durable Object
(`worker/src/accounts.js`, SQLite); push subscriptions in `PushCoordinator` storage; chat in
`ChatRoom` + R2 media. Nightly DB export runs on the owner's PC (`backup-goallak-db.mjs`).

## The Egyptian feed (API-Football free tier — `worker/src/egypt.js`)

ESPN has no Egyptian league, so it comes from API-Football: **100 requests per UTC day, 10 per
minute**, one account, nothing paid. The design exists for two promises the owner made by name:
the league never goes dark because the quota ran out, and no score is ever shown fresher than
it is. Read the header comment of `egypt.js`; in short:

- **Phones never call the provider.** The cron tick spends at most ONE call a minute, by
  priority: today's schedule (1/day, covers +14 days) → a noon refresh on match days
  (postponements) → final results per kick-off slot, fired the minute the live feed drops a
  finished match (API-Football's `live=` endpoint lists in-play matches only — a finished one
  VANISHES, it does not turn FT; we never write FT ourselves) → line-ups (2 attempts, T-26 and
  T-10) → the live poll → the table after the last whistle.
- **The live poll paces itself:** interval = live minutes still ahead ÷ calls still
  affordable, clamped 1–10 min (≈1.4 min on a one-slot day, ≈2.7 on the usual two-slot day;
  the league kicks off only at 14:00 and 17:00 UTC, measured over 30 fixtures). Nothing is
  polled outside [KO−2, KO+115]; the dead hour between slots is free.
- **8 calls are never spent** (`RESERVE`). The provider's `x-ratelimit-requests-remaining`
  header is believed over our counter; a 200 carrying `errors.requests` means the quota is
  gone and ends the day — it is not an error to retry.
- **Output is ESPN-shaped** (`_gkSrc:"af"`, `_gkAt` = when the provider was last asked) so
  the shell, the push filter and the live card reuse unchanged. A virtual `LEAGUES` entry
  `{id:"egy", slug:"egy.af", src:"af"}` in the worker swaps the stored board into both board
  loops. Routes: `/api/egy/{board,summary?fixture=,standings,status}` — storage reads only.
- **Without the `APIFOOTBALL_KEY` secret everything is inert** (`/api/egy/status` →
  `configured:false`, empty board, cron unchanged). The shell must hide the league until it
  flips.
- **Status 2026-09-02:** worker side deployed inert (version 85024612), 58-assertion test.
  Waiting on the owner to create the API-Football account and run
  `npx wrangler secret put APIFOOTBALL_KEY` from the worker folder (PC). Then, in order:
  verify league id 233 + season 2026 with the real key; confirm the substitution
  `player`(off)/`assist`(on) order and the payload shapes the tests assume; wire the shell
  (league entry with `src:"af"`, match sheet without Facts/ratings, a freshness label that
  prints the real age «يتحدّث كل N دقائق», Arabic names for the ~18 Egyptian clubs); release
  bump.
- **Update, later the same day - the free plan is a dead end:** API-Sports answers the current
  season with "Free plans do not have access to this season, try from 2022 to 2024". Free =
  no live Egyptian data, full stop. Two more facts paid for: API-Sports refuses calls from
  Cloudflare Workers' shared egress IPs ("too many requests per minute" on the very first
  call, 0 counted on the dashboard), and RapidAPI no longer lists API-Sports at all. The IP
  problem IS solved and proven: a Google Apps Script relay in the owner's Google account
  (`worker/relay/Code.gs`, secrets `AF_RELAY_URL` + `AF_RELAY_TOKEN`); `afDoor()` picks
  relay > rapidapi > direct, and direct only with the `AF_DIRECT_OK=1` var. A per-minute
  rebuff is a 2-min block, a plan/key error a 30-min-doubling block, only `errors.requests`
  ends the day; a block is dropped when the door changes; `/api/egy/status` shows `via`,
  `blocked`, `lastError`, provider headers. What remains is a money decision for the owner:
  API-Football Pro $19/mo (works today through the relay, zero code change), Live-Score API
  EUR 11/mo (Egypt = its competition 36; needs a new adapter; 14-day trial), TheSportsDB
  $9/mo (2-minute livescores, thin events; new adapter; its free key returns 5 truncated
  events), or drop the league. The v6.88 shell wiring is built and browser-verified locally,
  and stays uncommitted until data actually flows.
- **Parked, end of the day (owner decision):** "forget the Egyptian league for now ... do not
  delete all what u did, just do not show it in the app." So: v6.88 shipped with the `egy`
  LEAGUES entry commented out (index.html, one line, with the revive note above it); the
  worker got `EGY_FEED = "off"` in `[vars]`, which makes `afDoor()` return null - configured
  false, empty board, no provider calls - while every secret (APIFOOTBALL_KEY, AF_RELAY_URL,
  AF_RELAY_TOKEN), the relay script in the owner's Google account, the scheduler, adapters,
  routes and 88 tests stay. **To revive:** pay for a door (API-Football Pro works through the
  relay with no code change; a licensed feed needs its own adapter), set `EGY_FEED = "on"`,
  redeploy, uncomment the LEAGUES line, release. FilGoal remains the documented free-but-
  unofficial option (structured JSON in its pages, Arabic names, events and line-ups;
  reachable from Workers) if the owner ever prefers it for the friends build.

## The Egyptian league is BACK, free, via FilGoal (v6.96, 2026-09-02 evening)

Owner: "think of a way to get the egyptian league for free". `worker/src/filgoal.js` reads the
JSON FilGoal embeds in its day page (`var viewModelData = [...]`: Arabic names, kick-off as
/Date(ms)/ UTC, HomeScore/AwayScore, CurrentMatchStatusText over|live|upcoming, TimeElapsed),
keeps ChampionshipId 1667, and writes API-Football-shaped fixtures into the SAME store
egypt.js serves from - so routes, adapters and shell branches were reused unchanged; the
LEAGUES `egy` line was simply uncommented and `EGY_FEED = "filgoal"` set. Polling: one page a
minute only while a match is in [KO-5, KO+125], a look every 30 min on match days, the week
ahead (8 day pages) once a day. No events/line-ups yet (the match page carries them - a later
release). Unofficial: a publisher's page, friends build only; first thing to replace with a
licensed feed at the public launch. `/api/egy/status` shows `via:"filgoal"` and the status
words seen. Status parked notes above remain as history.

## Shipped the same night (v6.101-v6.102)

Design: league-coloured rail chips (palette selectors have `.railc[data-lg]` twins), card depth,
`body.dayflip` staggered row fade set by `selectDay` for 700 ms (never on the live tick), `.tilt`
gyro parallax on the club header, Alexandria scores. Egyptian crests from FilGoal (`team.logo`).
"Watch the goals": `goalLinksHtml` - ESPN video page if the summary has `videos[]`, else a YouTube
highlights search; links only, never a stream. **Match recap**: worker `/api/recap?slug&eid&lang`
(Workers AI, `[ai] binding = "AI"`, model llama-3.3-70b-instruct-fp8-fast, facts-only prompt,
finished matches only, cached a month per match+lang at the edge); shell `recapHtml/loadRecap`
on the E tab; Arabic prompt asks for Egyptian colloquial but the model tends to MSA - tune later.

## FilGoal commentary (v6.103) and what was measured about FilGoal

- FilGoal IGNORES `?date=` (three dates returned the same 61 ids); its `/matches` page carries
  yesterday+today+tomorrow. The daily read is therefore ONE request; the "week ahead" never
  existed. The twin index (`egy:fgidx`, every competition on that page) spans those three days.
- Match pages embed `{"TimeZoneConsidered":true,"Id":<id>,...}` with `Comments` (Time, Content,
  ContentUrl = goal clip sometimes), typed `Events` (MatchEventTypeName Arabic), coaches,
  formations, squads. `fgMatch(store,id)` caches a page 60 s while live / 1 day when over.
- Routes: `/api/egy/fg?fixture=<id>` (Egyptian) or `?h=&a=&ko=` (twin by Arabic names + kick-off,
  `&probe=1` to test) -> `{comments, events, coachH/A, formH/A, over}`. Shell: tab "C"
  (`renderComm`, `fgTwinProbe` stamps `e._gkFg`); goal lines gold with "watch the goal" links.
- European coverage on FilGoal's page is whatever they list that day (seen: Coppa Italia, Saudi,
  Scottish, Egyptian divisions on a Wednesday) - the tab appears only when a twin is found.
- No standings from FilGoal: `egyStandings` falls back to a teams-only table (`_gkProvisional`)
  so the followed-club picker lists Egyptian clubs; the picker cache key moved to `gk_teams_v2`.

## v6.104 - the rest of the list (2026-09-02, night)

- Egyptian matches carry events: `filgoalTick` live branch calls `fgMatch` per started match and
  `fgEventsToAf` maps FilGoal event types (Arabic) to API-Football shapes -> `toEspnEvent` details
  (goal/penalty/own goal/missed penalty, cards) and summary keyEvents (subs). Goal pushes for
  Egypt now carry scorers. Recap for `slug === "egy.af"` is built from FilGoal's commentary lines
  (coordinator `/egy-fg`), not ESPN. Arabic recap prompt asks for Egyptian dialect with an example.
- Room's picks (`picksRowHtml`, appended inside predCard/predResultRow; `lbCache.users` kept and
  refreshed quietly on the Matches tab); discuss-in-chat (`discussMatch`, a button in the
  goal-links row - NOT a `.mshare`, a qa-chat gate asserts the first share button says "share");
  goal celebration (`celebrateGoal`: vib + `body.goalburst` wash, followed clubs only, 4 s
  throttle); global `#liveBar` (`renderLiveBar`, every view except home and chat).

## v6.110 (2026-09-02, late night) - three owner asks after a night with the app

- **Egyptian summary carries the commentary.** `commInlineHtml(eid, e, H, A)` appends FilGoal's
  minute-by-minute lines (newest first, `commRowsHtml(m)` shared with `renderComm`) under the events
  in the E tab for `_gkSrc === "af"` matches; it re-fetches every 60 s while live and repaints the E
  tab. The separate "C" tab exists ONLY for non-Egyptian matches with a FilGoal twin (`hasC = !af && e._gkFg`).
- **No goal-clip chips.** `goalLinksHtml` shows nothing during a live match except the Discuss button,
  and after FT the ESPN video / YouTube search + Discuss. `clipsFor` and the `goalClips`/`clipsSoon`/
  `commClip` strings remain but are unused. Owner: "the youtube is enough".
- **Club page opens from the match SHEET header, not from rows.** `data-club`/`data-cslug` were removed
  from `.mrow` team spans, the prediction cards and the chat live strip (a thumb aiming for the card
  landed on a crest). They now sit on the `<i>` inside each `.mvt` of the sheet header. Still present:
  standings table, line-up labels, club page lists, `tmfx` header.
- Egyptian club Results listed a match twice: `/schedule?season=yr-1` maps to the same `board?team=`
  answer. `evs` is deduped by id in `openClub`.

## Features roadmap (from the features agent, 2026-09-02) - owner picks the order

1. Reveal the room's picks after lock (leaderboard already returns every user's picks; ~5h).
2. Club Fixtures tab - SHIPPED v6.96. 1 and 4 SHIPPED v6.104; goal celebration + live bar too.  3. Friend duel card on the leaderboard (~4h).
4. Discuss-in-chat button on the match sheet, pre-seeded with the scoreline (~3h).
5. Team of the Matchday from cached ratings, in a sheet (~10h).  6. "My Table": standings
filtered to followed clubs (~5h).  7. Add-to-calendar .ics for a followed club (~4h).
8. Season share card (predictions record + badges; crest-free) (~6h).

## The club page (v6.90)

`openClub(id, slug, name)` in index.html; any element carrying `data-club` (+ `data-cslug`)
opens it - a capture-phase document listener, so a name inside a match row wins over the row.
Rows, prediction cards, the standings table, line-up labels, the chat live strip and the
followed-club sheet header carry it. Sources: ESPN team schedule + roster (edge whitelist now
allows `teams/<id>/roster` and `teams/<id>`), ESPN core season statistics via the worker's
`/api/espn-core/` route (1 h cache), `club-facts.json` in the repo root for honours (count,
last year, and the years themselves - tap a trophy), captain AND coach (20 clubs; the file
wins over ESPN's roster coach, which is years stale; owner-editable, no release needed),
`fantasy/clubs.json` for colours and codes. "Last 5" reaches into the previous season when
the current one is young. Every `years` list is checked against `n` and `last` by w17-style
self-check before shipping.
Deep link `?club=<id>&cslug=<slug>`. Every source is optional; an empty tab says so.
v6.95 dropped the captain (owner: armbands change too often) and replaced "@" with Home/Away
tags; v6.96 added the Fixtures tab (schedule `?fixture=true`).

## Conventions that gates and reviewers enforce

- **Comments are post-mortems**: say the failure the code prevents, never restate the code.
  Never leave a comment that overstates what the code does.
- **Additive DOM only** — suites assert class names (`.mrow .msc .lineup .pitch .pchip .stbar`).
- Animations: `transform`/`opacity`/`background-color` only; every keyframe in the
  `prefers-reduced-motion` kill list.
- Every user-visible string in BOTH languages via `t("key")`; Arabic is Egyptian, English
  plain. Numeric runs and scores carry `dir="ltr"`; score order flips for Arabic (`scoreTxt`).
- `esc()` every interpolation into `innerHTML`; ids travel via `data-*` + `this.dataset`.
- Gold = value, orange = interactive, green = live/positive, red = negative.

## Lessons already paid for (read before repeating them)

- **Vendoring server code into this public repo published six password hashes.** Scan before
  you copy; "already public elsewhere" is a reason to END an exposure, not duplicate it.
- **Editing `fantasy/src` without rebuilding the bundle ships nothing.**
- **A repaint default that was harmless on-open became a 25-second bounce** once pre-match
  sheets started repainting (v6.86). When you add a repaint path, re-check every default
  that runs inside it.
- **`git add -A` swept an accidental file deletion into a release** (two crests, v6.86).
  Check `git status` for unexpected deletions before every commit.
- **The edge cache is per-colo**, not one shared copy: 15 requests in 15s produced 4
  upstream fetches. Don't describe it as "one fetch per 45s".
- **ESPN facts measured, not assumed:** `passPct` is a fraction (0.9), `possessionPct` a
  percentage (51.5), in the same payload; `aggregateScore` exists from the moment a second
  leg is created (unplayed tie = `[0,0]`, not null) and leg notes read `"1st Leg"` /
  `"2nd Leg - X win Y-Z on aggregate"` — never "Leg 2 of 2"; a pre-match summary carries a
  one-keeper stub roster long before the XI; a saved penalty is logged twice.
- **Line-ups land ~45–56 min before kick-off** on ESPN (measured live); the worker polls
  T-80..20, max 3 summaries per tick.
- PC only: Bash heredocs corrupt non-ASCII and backslashes — write patch scripts to a
  file first. The deploy clone was moved OUT of `%TEMP%` on 2026-09-02 for this reason.

## Open items (owner decides order)

- Owner: rotate the six passwords exposed 2026-08-28 (still in git history); Cloudflare
  $5 Workers plan before public launch; GoDaddy auto-renew; licensed data feed + crest-free
  build for an official launch (that feed would also revive the parked Egyptian league).
- Owner: create the API-Football account and set the `APIFOOTBALL_KEY` secret is DONE and
  parked - see "The Egyptian feed"; nothing to do unless he decides to pay.
- Backup script: switch it to `Authorization: Bearer <BACKUP_TOKEN>` (the worker accepts both
  since v6.89), then delete the `?t=` fallback in `backupTokenOk()`.
- Closed in v6.89 (2026-09-02): snapTake/snapBackfill integrity, kicks rows in export/import,
  reset-password single shape, constant-time backup token, R2 orphans on chat trim, retired
  textdb importers, non-persisted `wipe`; streaks/badges, matchday chat strip, clubs of the
  round, fantasy Cairo/count-up/ramp. No product waves remain open.
