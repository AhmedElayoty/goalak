# Goallak - process improvement plan

Staff-engineer audit of how Goallak (goallak.com) is built and shipped, written 2026-08-15
against v3.8 / `goalak-v32`. Scope: process only. No app source was modified.

**The situation in one line:** 32 service-worker versions and 3.8 app versions shipped in about
36 hours, straight to production, with the owner acting as the only QA gate.

That is a deploy roughly every 68 minutes to a live site, with no test suite for the site, no
staging, and no rollback procedure. The velocity is not the problem and should not be slowed
down. The problem is that **nothing between the edit and the owner's phone is automated**, so
every regression has exactly one detector: the owner.

Sources mined: `site/sw.js` changelog (32 entries), `LESSONS_LEARNED.md` (the predecessor World
Cup app), `PRE_DEPLOY_CHECKLIST.md`, `GOALAK_BUILD_PLAN.md`, `deploy_goalak.mjs`, `worker/`.

---

## 1. Recurring failure classes

Every fix recorded in the `sw.js` changelog plus every incident in `LESSONS_LEARNED.md`,
categorised. 60 distinct defects, 9 classes. Four classes account for 63% of them.

| # | Class | Count | What it looks like |
|---|-------|-------|--------------------|
| A | **i18n wiring and coverage** | 11 | A string exists but is wired into one code path only, or is not in the dictionary at all |
| B | **CSS stacking, overflow, RTL** | 10 | Two layers occupy the same pixels on a phone; a physical margin mirrors wrong in Arabic |
| F | **Cache / service worker / deploy delivery** | 9 | The code is correct but the client is not running it |
| D | **Upstream data-shape and domain-logic assumptions** | 8 | ESPN's payload is not what the code assumed it was |
| C | **loading / failed / empty conflation** | 6 | A transient failure renders as "nothing here" and destroys good UI |
| I | **Spec literalism and owner trust** | 6 | Built something wider, narrower, or fancier than what was asked |
| G | **Cross-origin, worker config, session** | 4 | The browser or the worker refuses a call the client makes |
| E | **Time, date, timezone arithmetic** | 3 | The day boundary is computed in the wrong frame of reference |
| H | **Navigation and view-state machine** | 3 | Back button, deep links, and re-renders fight the current view |

### Class A - i18n wiring and coverage (11)

| # | Defect | Where |
|---|--------|-------|
| A1 | Bottom-nav labels stayed Arabic on a fresh **English** load: repainted only on a language CHANGE, never at boot | v3.3 / `goalak-v27` |
| A2 | Alerts toggle not localised (إيقاف/تشغيل hardcoded) | v3.6 / `goalak-v30` |
| A3 | `aria-label`s not localised | v3.6 / `goalak-v30` |
| A4 | Settings gear had no accessible name at all | v3.6 / `goalak-v30` |
| A5 | 9 top-division clubs missing from the Arabic name map | v3.6 / `goalak-v30` |
| A6 | Removing one line of copy took 4 edits: string, markup, and **both** JS setters | v3.4 / `goalak-v28` |
| A7 | Arabic wordmark wrong until v2.1 (should be جولك) | v2.1 / `goalak-v15` |
| A8 | Wrong Arabic for "extra time", already persisted into a live chat message | WC 2.3 |
| A9 | Lone-letter translation leak: Group D rendered as "المجموعة تعادل" on the bracket poster | WC 2.6 |
| A10 | Same leak recurred on the match-tab group label because the guard was per-render-path, not in the translator | WC 2.6 |
| A11 | **Latent today:** 15 Arabic literals live in inline `LANG === "ar" ? …` branches outside `STR` (preflight `i5b`) | v3.8 |

The signature of this class: **there is more than one place a language decision is made.**
`STR` pairs cannot drift, but an inline ternary can, and a boot path can diverge from a change path.

### Class B - CSS stacking, overflow, RTL (10)

| # | Defect | Where |
|---|--------|-------|
| B1 | Mobile chat/header overlap | v2.2 / `goalak-v16` |
| B2 | Stats hero tiles: the big number painted over the team name (owner screenshot) | v1.8 / `goalak-v12` |
| B3 | Chat badge clipped its own icon | v3.6 / `goalak-v30` |
| B4 | Subs lists required sideways reading on phones | v3.5 / `goalak-v29` |
| B5 | Pitch chips (z2) and rating badges (z4) painted straight over the match-detail tab bar while scrolling (owner screenshot; fixed with `z-index:30` + opaque background) | v3.2 area |
| B6 | Pitch overlapping the sticky tab bar (owner-reported, current) | live |
| B7 | `.msg` collision centred every chat message | WC 2.1 |
| B8 | Same `.msg` collision recurred at v2.91 on a new render path | WC 2.1 note |
| B9 | Physical `margin-left:auto` collided with the centred round label in Arabic | WC 2.7 |
| B10 | Overlay family: hit-testing during reveal, base-opacity vs animation-fill, handler arg | WC 2.5 |

Note B5 and B6 are the **same bug twice**: a new full-height panel introduced into a page that
already has 9 fixed/sticky layers, without checking it against them.

### Class C - loading / failed / empty conflation (6)

| # | Defect | Where |
|---|--------|-------|
| C1 | Tapping a date flashed "no matches / retry" before that day's fetch landed | v3.2 / `goalak-v26` |
| C2 | Leaderboard showed a generic load error instead of "results unavailable" | v3.6 / `goalak-v30` |
| C3 | A pre-match summary with no XI yet was cached **empty for the whole session** | v3.7 / `goalak-v31` |
| C4 | Login gave one generic error for wrong username and wrong password | v2.1 / `goalak-v15` |
| C5 | Background to resume blanked matches and chat (outer catch) | WC 2.2 |
| C6 | `.catch(()=>({events:[]}))` turned a network failure into a confident "No matches" | WC 2.2 |

### Class D - upstream data-shape and domain-logic assumptions (8)

| # | Defect | Where |
|---|--------|-------|
| D1 | ESPN published Liverpool v Como twice (ghost 10:30Z record with no venue) | v3.8 / `goalak-v32` |
| D2 | **BLOCKER:** penalty-shootout kicks counted as goals (5 "goals" beside a 1-1 scoreline) | v3.6 / `goalak-v30` |
| D3 | Player ratings derived goal difference per player instead of from the scoreline | v3.6 / `goalak-v30` |
| D4 | A keeper with 11 saves in a 4-1 defeat outranked a brace | v3.0 / `goalak-v24` |
| D5 | Named TV channels shown for non-exact fixture matches | v2.5 / `goalak-v19` |
| D6 | League-rights fallback claimed a specific broadcaster it could not confirm | v2.5 / `goalak-v19` |
| D7 | Friendlies flooded the day view until a tracked-league filter was added | v2.7 / `goalak-v21` |
| D8 | Stale "Greece" as Egypt's R32 opponent | WC 1.2 |

D2 is the archetype: the timeline renderer already excluded shootout kicks, but the per-club
scorer list did not. **The same upstream quirk handled correctly in one consumer and wrongly in
another** is exactly LESSON 2.6 in a data costume.

### Class E - time, date, timezone arithmetic (3)

E1 day-key arithmetic in local time shifted the date strip by a day for zones west of the device
(v3.6). E2 the day did not auto-advance at midnight (v3.6). E3 day-rollover is a standing lifecycle
risk carried over from the WC app (rule 4).

### Class F - cache, service worker, deploy delivery (9)

| # | Defect | Where |
|---|--------|-------|
| F1 | Shell matching vs SW scope was imprecise | v1.1 / `goalak-v2` |
| F2 | Non-ok responses were used and cached instead of falling back | v1.1 / `goalak-v2` |
| F3 | Redirected responses replayed for navigations | v1.1 / `goalak-v2` |
| F4 | Cache writes not tied to event lifetime | v1.1 / `goalak-v2` |
| F5 | textdb responses were being cached, so live data and subscriptions went stale | v1.2 / `goalak-v6` |
| F6 | No `FORCE_RELOAD` token, so already-open clients never picked up a deploy | v3.3 / `goalak-v27` |
| F7 | Social cover served stale, needed a filename cache-bust | v2.2 / `goalak-v16` |
| F8 | GitHub Pages `max-age=600` plus a SW riding the HTTP cache: "i did not get the hard refresh" | WC 1.3 |
| F9 | **Live today:** the settings sheet ships `v3.2` in static markup at v3.8 (preflight `v1`) | v3.8 |

### Class G - cross-origin, worker config, session (4)

G1 `DELETE` missing from `Access-Control-Allow-Methods` blocked the CORS preflight, so message
deletion silently failed (owner-caught; the fix comment is still in `worker/src/index.js:370`).
G2 chat sessions could not be renewed (v2.2). G3 signed-out users were reading the room (v1.8).
G4 structural: `APP_ORIGINS` is a hardcoded 2-entry allowlist, so **any** new origin (staging,
preview, a renamed domain) 403s every API call with no client-side clue.

### Class H - navigation and view-state machine (3)

H1 Android Back exited the app from Predictions/Fantasy/Chat/Settings (v3.6). H2 a deep link while
Chat or Settings was open rendered two panes (v3.6). H3 selecting alert leagues closed Settings
when the buttons re-rendered (v2.4).

### Class I - spec literalism and owner trust (6)

I1 predictions tab did not say it was UCL (v1.7). I2 the UI name-dropped data sources (v3.1).
I3 the "unofficial app" line the owner did not want (v3.4). I4 preview pushed to both live sites
(WC 1.1, the worst incident). I5 celebration on both cards (WC 2.4). I6 over-engineering a fix the
owner had scoped as one line (WC 2.8).

This class cannot be automated away. It is a **read-back ritual** problem, addressed in the gate.

---

## 2. Cheapest mechanism that would have caught each class before production

Constraints respected: single-file vanilla JS, no build step, no npm install for the site, must
run on Windows in seconds.

| Class | Cheapest mechanism | Cost | Catches |
|---|---|---|---|
| A | **`preflight.mjs` i18n checks** (already written and running): every `t("k")` resolves; no Arabic in an English `STR` slot; no unguarded Arabic literal in JS; every Arabic string in the static markup is owned by an id JS repaints | 0.2 s, done | A2, A3, A4, A6, A7, A11 |
| A | **`?selfcheck=1` DOM sweep** (about 25 lines in the app, dev-flag gated): force `LANG="en"`, walk every text node, flag any node containing `[؀-ۿ]` unless it carries `lang="ar"` or `.notr`. Run it once per deploy in the browser | half a day once | **A1 exactly** (the boot-path bug), A9, A10 |
| B | **z-index scale enforcement**: every `position:fixed/sticky` rule must declare a `z-index` from a named `--z-*` token; preflight fails otherwise. Preflight already prints the full layer inventory (`c2`) | 1 hour to extend | B1, B3, B5, B6 |
| B | **Overlap probe in `?selfcheck=1`**: `getBoundingClientRect()` on `.bnav`, the sticky header, and every `.card/.pitch/.sheet/.mdtabs`; log any intersection with a fixed bar | 20 lines | **B5, B6 exactly** |
| B | **Bare-class collision check** (preflight `c1`, running): the same class declared bare in two feature sections | done | B7, B8 |
| B | **Physical-property check** (preflight `r1`, running) | done | B9 |
| C | **Three-state contract**: one `renderState(el, {loading, failed, empty, data})` helper, and a preflight rule that fails any `catch` block containing `innerHTML =` or returning an empty collection | 2 hours | C1, C2, C5, C6 |
| C | **Never cache a negative**: a rule that any cache write of an empty result must carry a short TTL | code review question | C3 |
| D+E | **Pure-function harness** (proved working, see below): slice `index.html`'s `<script>` up to the boot banner, run it in `node:vm` with a 20-line DOM stub, then unit-test the pure functions against saved ESPN payloads | 40 lines, no deps | **D1, D2, D3, D4, E1, E2** |
| F | **`preflight.mjs` version ritual** (running): APP_VERSION vs footer vs settings line vs sw.js CACHE vs changelog, plus a real diff against the deployed repo | done | F6, F9, and the whole ritual |
| F | **Post-deploy curl proof** (gate 11) | 5 s | F5, F7, F8 |
| G | **Client/worker CORS contract check** (preflight `w1`, running): every HTTP method and custom header the client sends must appear in the worker's `Access-Control-Allow-*` lists, and the CNAME domain must be in `APP_ORIGINS` | done | **G1 exactly**, G4 |
| H | **History invariant**: every full-screen view pushes exactly one history entry; assert view count == pushState call-site count | grep in review | H1, H2 |
| I | **Read-back**: restate the request in one sentence and get a yes before writing code | free | I1-I6 |

The harness for D+E is the single highest-leverage unproven-until-now item, so it was proved
during this audit:

```js
// ~40 lines, zero dependencies. Loads every pure function out of the single file.
const js   = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
const pure = js.slice(0, js.indexOf("/* ============ boot ============ */"));
vm.runInContext(pure, ctx);              // ctx = tiny localStorage + Proxy DOM stub
vm.runInContext(`LANG="en"`, ctx);       // note: `let` bindings need runInContext, not ctx.LANG=
ctx.countLine(5, 2);                     // -> "5 matches · 2 competitions"
```

Verified working against the real `site/index.html` during this audit: it loads `countLine`,
`clubAr`, `statVal`, `esc` and friends and evaluates them in about a second. Every Class D and E
defect listed above is a pure-function bug and would have been a one-line assertion in this
harness. Save one real ESPN payload per awkward shape into `goalak/fixtures/` (a finished match
with a shootout, a duplicate fixture pair, a pre-match summary with no XI, a pre-season stats
response) and the regression suite writes itself.

---

## 3. The Goallak pre-deploy gate

The WC app's 9 gates were correct but entirely manual, so under a 68-minute deploy cadence they
were not run. This version pushes 6 of them into a script that finishes before you can read the
checklist, and keeps only what genuinely needs a human.

### Automated - one command, under 3 seconds

```powershell
node "goalak\scripts\preflight.mjs"          # exits 1 on any FAIL
cd goalak\worker; npm run check              # only when the worker changed
```

`preflight.mjs` covers gates 2, 3 (partially), 5, 8, 10 and the whole version ritual.
`npm run check` runs `node --check` on all three worker sources plus the broadcast parser tests.

### The 11 gates

| # | Gate | Who | Fails if |
|---|------|-----|----------|
| 1 | **Go-ahead** | human | The owner has not explicitly approved a LIVE deploy. Previews go to staging, never to `goallak.com`. |
| 2 | **Preflight green** | `preflight.mjs` | Any FAIL. WARNs must be read aloud, not silently accepted. |
| 3 | **Read-back** | human | You cannot restate the request in one sentence and point at the exact diff that does it, and nothing more. |
| 4 | **Staging on the owner's phone** | human | Any visual, layout, RTL or copy change that has not been seen on a real phone in **Arabic first**. |
| 5 | **Three states** | human | Any new fetch path cannot distinguish loading, failed and genuinely empty, or blanks good content on failure. |
| 6 | **i18n both directions** | human | Not loaded fresh in EN **with storage cleared** (boot path) as well as toggled. The v3.3 bug lives in the gap between those two. |
| 7 | **Layers** | human + `c2` | A new fixed/sticky/full-height element has not been checked against the header, the tab bar and the bottom nav while scrolling. |
| 8 | **Data shape** | human + harness | A new upstream field has no answer for missing / duplicated / zero / shootout / not-yet-published. |
| 9 | **Lifecycle** | human | Not exercised: background to resume, offline to online, first visit vs returning, midnight rollover, Android Back, installed PWA. |
| 10 | **Worker parity** | `npm run check` + human | The worker changed and was not deployed **before** the site, or a new method/header is not in the CORS lists (preflight `w1` catches this). |
| 11 | **Post-deploy proof** | human | You have not curled the live URL, grepped for the new version marker, and tagged the commit. |

### The out-loud format

```
GOALLAK DEPLOY GATE (v3.9 / goalak-v33)
1  Go-ahead ........ owner said "deploy"
2  Preflight ....... PASS (0 fail, 3 warn: i3 dead keys, i5b inline AR, c2 layers)
3  Read-back ....... "make the pitch stop covering the tab bar" - one CSS change, nothing else
4  Staging phone ... verified AR then EN on the owner's phone
5  Three states .... n/a (no new fetch path)
6  i18n both ways .. n/a (no new copy)
7  Layers .......... pitch z2/z4 vs .mdtabs z30 vs .bnav z60 re-checked while scrolling
8  Data shape ...... n/a
9  Lifecycle ....... resume + Back tested
10 Worker .......... unchanged
11 Proof ........... will curl goallak.com, grep v3.9, tag v3.9
```

`n/a` is allowed only with the reason stated. A gate that fails stops the deploy.

### Post-deploy proof (gate 11), verbatim

```powershell
curl.exe -s "https://goallak.com/?cb=$(Get-Random)" | Select-String 'APP_VERSION = "3.9"'
curl.exe -s "https://goallak.com/sw.js?cb=$(Get-Random)" | Select-String 'CACHE = "goalak-v33"'
gh api repos/AhmedElayoty/goalak/git/refs -f ref=refs/tags/v3.9 -f sha=<commitSha>
node "goalak\scripts\preflight.mjs" --record
```

Honest client expectation to give the owner: the shell is fetched `no-store` network-first, so a
**fresh open** shows the new version immediately; an **already-open** tab only hard-reloads if
`FORCE_RELOAD` was bumped. Do not promise more than that.

---

## 4. Staging: three options, one recommendation

### Option A - a second GitHub Pages repo (recommended)

`AhmedElayoty/goallak-staging` serving at `https://ahmedelayoty.github.io/goallak-staging/`.

- **Zero cost, zero new tooling.** `deploy_goalak.mjs` already pushes a whole directory to a repo
  with the GitHub API; a `--repo` argument is a two-line change.
- **A genuinely different origin from production.** Since the cutover to `goallak.com`, the
  `github.io` host shares nothing with production: separate service worker, separate cache
  storage, separate `localStorage`, separate installed PWA. A broken staging build cannot reach a
  single real user, and cannot corrupt production's stored state. This is the pattern that already
  worked in the WC app (the isolated `egypt-win-celebration-demo` repo, LESSON 5).
- **One stable URL** the owner bookmarks or adds to his home screen once. That matters more than
  it sounds: he tests on his phone, and a URL that changes per commit will not get used.
- **Cost to set up honestly stated:** the worker's `APP_ORIGINS` must gain
  `https://ahmedelayoty.github.io`, or every chat/media/session call 403s (this is failure G4).
  Staging must also point at a **separate chat room key and separate `goalak_*` textdb namespace**
  so staging traffic never writes into production state (LESSON 5 gate 7).

### Option B - Cloudflare Pages preview branch

Free, and it gives a per-commit URL. Rejected: a new hostname per commit means either a new
`APP_ORIGINS` entry per deploy or a wildcard origin rule, and a wildcard weakens the worker's only
origin defence. It also adds a second deploy pipeline next to a `deploy_goalak.mjs` that already
works, and no home-screen-installable stable URL.

### Option C - `?preview=1` flag on production

Rejected as a staging substitute, though useful for something else. The risky code is already
inside the production HTML: a syntax error, a CSS regression, or a service-worker mistake ships to
every user whether or not the flag is set. A flag cannot protect against the classes that actually
bite here (B, F, G).

**Where `?preview=1` does belong:** gating a large unfinished *feature* (Fantasy) inside an
otherwise-shipped build. Use it for feature flags, not for testing builds.

**Recommendation: Option A, with Option C for big features.** Add a `STAGING` ribbon to the
staging build (a fixed corner label driven by `location.hostname`) so the owner can never confuse
the two on his phone, and disable push registration there.

---

## 5. Should the 3,656-line file be split?

**No. Keep it as one deployed file.** This is not inertia; splitting it makes the worst failure
class worse.

Current shape (2026-08-15 22:19): 3,755 lines / 224 KB of text. Lines 38-582 CSS (544), 583-714
markup (131), 715-3,753 JS (3,038). One document, ~36 banner-delimited sections. It grew by 99
lines during this audit, which is the cadence the process has to survive.

### The argument against splitting

The only no-build split is `<link rel="stylesheet" href="app.css">` plus
`<script src="app.js">`. That trades one problem for a worse one:

- The service worker serves the shell **network-first with `cache: "no-store"`** but serves every
  other asset **cache-first**. Split the file and a deploy produces a window where the browser has
  the **new `index.html` and the old `app.js`**. That is not a hypothetical: GitHub Pages sets
  `max-age=600` on assets, `sw.js` itself is subject to it, and the app has already been burned by
  exactly this mechanism (F8, F6, F5, F1-F4). A version query string (`app.js?v=3.9`) fixes it, at
  the price of a **fourth place the version must be bumped by hand** - and preflight just caught a
  live version-marker drift in the three places that already exist (F9).
- A single HTML document is **atomic**. There is no state in which the markup, the CSS and the
  logic disagree with each other. For an app that deploys 20+ times a day with no staging soak,
  that property is worth more than tidy directories.
- The deploy script pushes whole files in one commit and the SW caches one shell. Both are simpler,
  and rollback (section 6) is a single tree swap.

### The real pain is navigation and collision, not line count. Fix that instead.

1. **Section manifest.** A comment block at the top of `index.html` listing every banner in order.
   Extend preflight to assert the file has exactly three regions and that every banner in the
   manifest exists, in order. Editing by grep then becomes reliable.
2. **One prefix per feature.** Every new feature registers a CSS/id prefix (`gkChat*`, `gkPitch*`).
   Preflight already fails a bare class declared in two feature sections (`c1`); tighten it to
   require new bare classes to carry a registered prefix. This is LESSON 2.1 and 2.6 made mechanical.
3. **Split by PAGE, never by module.** When a feature is big enough to hurt (Fantasy is the next
   one), give it its own document: `fantasy.html`, its own shell entry in the SW `SHELL` list, its
   own cache-coherency story. Multi-page splitting is cache-safe because each page is atomic.
   Module splitting inside one page is not.
4. **A measured trigger, not a feeling.** Revisit only when the file exceeds ~500 KB or parse time
   on a mid-range Android exceeds ~250 ms. At 224 KB it is not close.

---

## 6. Versioning and rollback

Today: one commit per deploy on `main`, no tags, no local git clone, no rollback path. When the
owner says "revert", there is currently nothing to revert to by name.

### The ritual (three additions, all cheap)

1. **Tag every deploy.** One extra API call in `deploy_goalak.mjs` after the commit:
   `gh api repos/AhmedElayoty/goalak/git/refs -f ref=refs/tags/v3.9 -f sha=<commitSha>`.
   A tag is the thing the owner's words map onto: "go back to 3.7".
2. **Record the baseline** after every successful deploy: `node goalak\scripts\preflight.mjs --record`.
   This is what lets the next preflight prove the cache was actually bumped even with no local git.
3. **Keep a one-line deploy log** (`goalak/DEPLOYS.md`): version, cache, commit sha, one sentence.
   The `sw.js` changelog already does 90% of this; the missing 10% is the commit sha.

### Rollback in under 2 minutes

**Never force-push.** The correct rollback re-applies an old *tree* as a *new* commit, so history
stays linear and the deploy mechanism is the one already trusted.

```powershell
# 1. find the good commit (10 s)
gh api repos/AhmedElayoty/goalak/commits --jq '.[0:6][] | .sha[0:9] + "  " + .commit.message'

# 2. re-apply that commit's tree as a new commit on main (20 s)
$good = "<sha-of-good-commit>"
$head = gh api repos/AhmedElayoty/goalak/git/ref/heads/main --jq .object.sha
$tree = gh api repos/AhmedElayoty/goalak/git/commits/$good --jq .tree.sha
$body = @{ message = "ROLLBACK to $($good.Substring(0,9))"; tree = $tree; parents = @($head) } | ConvertTo-Json
$body | Out-File -Encoding utf8 rb.json
$new  = gh api repos/AhmedElayoty/goalak/git/commits -X POST --input rb.json --jq .sha
'{"sha":"' + $new + '"}' | Out-File -Encoding utf8 rbref.json
gh api repos/AhmedElayoty/goalak/git/refs/heads/main -X PATCH --input rbref.json

# 3. prove it (20 s)
curl.exe -s "https://goallak.com/?cb=$(Get-Random)" | Select-String 'APP_VERSION'
```

Worth turning into `goalak/scripts/rollback.mjs` (about 25 lines, same `gh api` calls as
`deploy_goalak.mjs`) so it is one command: `node goalak\scripts\rollback.mjs v3.7`.

**Worker rollback is separate and already supported:** `wrangler deployments list` then
`wrangler rollback [id]` from `goalak/worker`. Deploy order matters: **worker first, site second**
on the way out, **site first, worker second** on the way back, so the client is never newer than
the API it calls.

### Two client-side truths to state honestly when rolling back

- The rolled-back `index.html` carries an **older** `FORCE_RELOAD`. Clients holding the newer token
  see a mismatch and hard-reload once. That is the desired behaviour, not a bug.
- The rolled-back `sw.js` carries an older `CACHE` name; `activate` deletes every cache that is not
  the current name, so going backwards is safe. Local caches self-heal on next open.

---

## 7. `goalak/scripts/preflight.mjs` - written, tested, and already failing on a real bug

```powershell
node "goalak\scripts\preflight.mjs"              # ~2.5 s (fetches the live repo as baseline)
node "goalak\scripts\preflight.mjs" --offline    # ~0.2 s (local snapshot baseline)
node "goalak\scripts\preflight.mjs" --json       # machine-readable
node "goalak\scripts\preflight.mjs" --record     # save baseline, run after a successful deploy
```

Exit code 0 = clear, 1 = blocked, 2 = could not run. No dependencies, no install.

Baseline for "was the cache bumped" resolves in order: **git HEAD** (if ever cloned), then
**`gh api` against the live repo** (authoritative today, since there is no local clone), then a
**local snapshot** at `scripts/.preflight-baseline.json`.

### What it checks

| id | Check | Level |
|---|---|---|
| `v1` | `APP_VERSION` == footer `#appVer` == settings `#shVer` == newest `sw.js` changelog line == `CACHE` | FAIL |
| `v2` | `CACHE` and `APP_VERSION` bumped vs the deployed baseline, and the cache number did not go backwards | FAIL |
| `v2b` | `FORCE_RELOAD` unchanged since the last deploy | WARN |
| `a1` | `CNAME` present and equals `goallak.com`; every `sw.js` `SHELL` entry exists on disk; every local `src`/`href` in the page exists | FAIL |
| `d1` | Duplicate `id=` in the static markup | FAIL |
| `d2`/`d3` | ids that exist statically **and** are re-emitted from JS; ids emitted from two JS templates | WARN |
| `i1` | `STR` integrity: no duplicate keys, no non-pair entries, no empty slot, **no Arabic in an English slot** | FAIL |
| `i2` | Every `t("key")` has a `STR` entry | FAIL |
| `i3` | `STR` keys defined but never referenced anywhere (including dispatch tables) | WARN |
| `i4` | Count of dynamic `t(expr)` calls that static analysis cannot verify | INFO |
| `i5` | **Unguarded** Arabic string literals in JS outside `STR` and the bilingual data maps | FAIL |
| `i5b` | Arabic inside inline `LANG === "ar" ? …` branches (a second translation system) | WARN |
| `i6` | Arabic in the static markup that no JS repaint owns | WARN |
| `s1`/`s2`/`s3` | Inline JS parses, `sw.js` parses, `manifest.json` is valid JSON | FAIL |
| `h1` | Every inline `on*=` handler resolves to a defined function | FAIL |
| `c1` | The same bare class declared in two feature sections (the `.msg` collision) | WARN |
| `c2` | Inventory of every fixed/sticky layer with its z-index, flagging any with none | WARN |
| `r1` | Physical `left`/`right`/`margin-left` CSS instead of logical properties | WARN |
| `w1` | Every HTTP method and custom header the client sends is in the worker's `Access-Control-Allow-*`, and `CNAME` is in `APP_ORIGINS` | FAIL |

Escape hatches, both documented and both leaving a trace: a `/* i18n-ok */` marker on a line, and
`scripts/.preflight-allow.json` (`{ "arabicStrings": [], "unusedStrKeys": [], "duplicateIds": [],
"undefinedHandlers": [] }`).

### Result on the current tree (v3.8 / goalak-v32, run 2026-08-15 22:19)

`index.html` was being edited by another session during this audit (a player-card feature landed
mid-run), which is itself a useful demonstration: the same command gave a correct read of both
states.

```
FAIL [v1] settings #shVer shows "v3.2" but APP_VERSION is "3.8"
FAIL [v2] CACHE and APP_VERSION unchanged vs the deployed baseline (nothing new to ship yet)
WARN [v2b] FORCE_RELOAD unchanged
WARN [d3]  #mdBody emitted from two JS templates
WARN [i3]  8 STR keys defined but never referenced
WARN [i5b] 15 Arabic literals inside inline LANG === "ar" branches
WARN [i6]  1 Arabic literal in static markup that no JS repaint owns (<title>)
WARN [c1]  .pchip and .lnrow declared bare in two feature sections each (NEW, player card)
WARN [c2]  10 fixed/sticky layers, 1 with no z-index (.mx)
WARN [r1]  1 physical left/right declaration (.tl::before { left: 50% })
PASS  a1 d1 i1 i2 i5 s1 s2 s3 h1 w1   (192 STR entries, 149 t() keys, 107 ids)
```

**One real defect found on the first run:** the settings sheet ships `جولك · v3.2 · الجول جولك`
in the markup while the app is on 3.8. JS overwrites it at boot, so it is invisible today; it
becomes visible the moment boot throws before `setLang()` runs, and it is the exact drift class
that produced F6 and F9.

**And one live catch in the brand-new code:** `c1` flagged `.pchip` and `.lnrow` as bare classes
declared in two different feature sections of the player-card work that landed during this audit.
That is precisely the `.msg` collision (B7/B8) forming again, caught before deploy rather than
after an owner screenshot. Eight warnings in total, each one a named failure class above.

The detector was verified against deliberately broken copies: a stale footer version, a removed
`DELETE` from the worker's CORS list, a duplicated `id`, a `t()` call with no `STR` entry, a dead
`onclick` handler, and a JS syntax error were all caught, with exit code 1.

---

## 8. What to do, in order

**Today (about 30 minutes)**
0. Rename `.pchip` / `.lnrow` in the player-card work to carry the feature prefix (preflight `c1`).
1. Fix the `#shVer` static version line so preflight goes green.
2. Run `node goalak\scripts\preflight.mjs --record` after the next successful deploy.
3. Add the preflight call to the top of the deploy ritual. Never deploy on a FAIL.

**This week (about half a day)**
4. Stand up `goallak-staging` (option A), add its origin to `APP_ORIGINS`, give it a separate room
   key and textdb namespace, add the STAGING ribbon, send the owner one URL for his home screen.
5. Add tagging + `DEPLOYS.md` to `deploy_goalak.mjs`, and write `scripts/rollback.mjs`.
6. Add the `?selfcheck=1` DOM sweep and the overlap probe. These two cover classes A and B, which
   together are 35% of all defects and nearly all of the owner-caught ones.

**Next (about a day)**
7. Save the awkward ESPN payloads into `goalak/fixtures/` and stand up the `node:vm` pure-function
   harness as `scripts/units.mjs`. Start with the four assertions that would have caught D1-D4.
8. Extend preflight with the z-index scale rule and the `catch`-block rule (classes B and C).

The single behavioural change that matters most: **the owner stops being the first person to see a
change.** Staging plus preflight plus the DOM sweep puts three detectors ahead of him, and none of
them cost more than three seconds of a deploy that currently happens every 68 minutes.

---

_Written 2026-08-15 against v3.8 / `goalak-v32`. No app source was modified by this audit._
