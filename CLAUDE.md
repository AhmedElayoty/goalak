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

## Gates — all must pass before a commit (1,868 assertions as of 2026-09-02)

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
- **Egyptian Premier League is NOT on ESPN** (checked 2026-09-02: no `egy.*` slug in its
  full catalogue). It comes from API-Football's free tier instead (`worker/src/egypt.js`,
  100 calls/day) - see "The Egyptian feed" below. **NOT in fantasy, NOT in predictions.**
  Its clubs also reach the app through the top-clubs dataset (`top-clubs.js`, group `egy`).

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

- Owner: create the API-Football account and set the `APIFOOTBALL_KEY` secret — the Egyptian
  league stays hidden until then (see "The Egyptian feed").
- Owner: rotate the six passwords exposed 2026-08-28 (still in git history); Cloudflare
  $5 Workers plan before public launch; GoDaddy auto-renew; licensed data feed + crest-free
  build for an official launch.
- Fantasy integrity: `snapTake` returns instead of deleting, so a sold club can score a
  sealed round; `snapBackfill` fabricates history from round 1 when `join` is unstamped.
- Restore path: the DB export saves `kicks` as a COUNT, not rows — a restore would turn the
  prediction deadline off until the cron refills it.
- Security, lower: reset-password returns three distinguishable shapes (account oracle);
  `BACKUP_TOKEN` travels in a query string and is compared non-constant-time; R2 media
  objects orphan when chat history is trimmed.
- Waves still planned: streaks/badges (no weekend rounds), matchday chat mode, Team of the
  Week, fantasy fonts/rating ramp/count-up.
