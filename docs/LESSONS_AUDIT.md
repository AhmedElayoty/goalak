# Goallak — lessons-learned compliance audit

Read-only audit of `goalak/site/index.html` (v4.4, 3,963 lines), `goalak/site/sw.js` (`goalak-v38`)
and `goalak/worker/src/*.js` against every rule in the World Cup app's
`LESSONS_LEARNED.md`, the 9 gates in `PRE_DEPLOY_CHECKLIST.md`, the 11 gates and 9 failure
classes in `goalak/PROCESS.md`, and the 60-entry bug changelog inside the WC app's `site/sw.js`.

No application file was modified. Findings marked **[reproduced live]** were confirmed against
`https://goallak.com` in a browser on 2026-08-16; no production write of any kind was performed.

---

## Executive summary

**41 distinct lessons/rules checked. 7 violated, 12 partially applied, 18 compliant, 4 not verifiable.**

The owner is right, and it is worse than one bug. The midnight live-strip regression was not an
isolated slip — it is the *third* time in this app that a fix was landed on some of the surfaces
that needed it and not all of them, and the current tree still ships two live instances of that
exact pattern, one of which is the midnight bug itself, only one layer deeper.

### The 5 most urgent items

| # | Finding | Why it is urgent |
|---|---------|------------------|
| 1 | **F-01 BLOCKER — the midnight live bug is still live, one layer down.** The LIVE strip, chip and count were fixed in v4.2; the LIVE **list** and the **match sheet** were not. A match that kicked off before midnight has no `_gkLeagueId` (that field is written only inside `mrow()`, which only runs for the *browsed* day), so tapping the LIVE chip renders "لا توجد مباريات في هذا اليوم" while the chip next to it says "● مباشر (1)", and opening that match from the strip gives no timeline, no line-ups, no stats, no Star of the Match and no TV channel. | **[reproduced live at 2026-08-16]**: `liveNowSet()` returned 1 match (La Liga, day 20260815) with `_gkLeagueId: UNDEFINED`; `setChip('live')` produced `0` rows and the empty-day message; `slugForEvent(e)` returned `null`. This is the owner's own bug, still shipping. |
| 2 | **F-02 HIGH — the `.msg` class collision, for the third time.** `.pname` is declared bare in the pitch section (line 305, `color:#fff`) and reused by the leaderboard podium (`.pod .pname`, line 485, no colour). | **[reproduced live]**: in light theme the podium's 2nd- and 3rd-place names compute to `rgb(255,255,255)` on a `rgb(255,255,255)` card. Invisible. `preflight c1` passes because it only compares *bare-vs-bare* selectors. |
| 3 | **F-03 HIGH — Serie A was added to the app but never to the push worker.** `worker/src/index.js:25-36` has 8 league ids; the site has 9. A user who selects only Serie A in "بطولات التنبيهات" gets **zero notifications, forever, silently.** | Client/worker parity is PROCESS gate 10 and it was not run when `ita.1` landed in v4.2. |
| 4 | **F-04 / F-05 HIGH — "failed" is still being rendered as "empty" in two places.** The leaderboard scores a user whose prediction file failed to read as **0 points** (`.catch(() => null)`, line 3177). `ensureTeams()` turns a failed standings fetch into `[]` and then **persists that emptiness to localStorage for 7 days** (lines 3250-3253). | This is WC lesson 2.2 / standing rule 3 verbatim, and the second one poisons the favourite-club picker and the friendlies filter for a week from one bad request. |
| 5 | **F-07 HIGH — not one of the six ESPN scoreboard calls sends `&limit=`.** WC v3.31 documents that ESPN silently caps a scoreboard response at 100 events without it, and that bug cost the owner the entire semi-final round. | **[measured live]** `club.friendly` over the app's own 3-day range already returns **60 events** in a quiet mid-August week. The margin to a silent, invisible truncation is 40 matches. |

---

## Compliance table

Sources: `LL` = `LESSONS_LEARNED.md`; `CL` = `PRE_DEPLOY_CHECKLIST.md`; `PR` = `goalak/PROCESS.md`;
`WCSW` = the WC app's `site/sw.js` changelog.

| # | Lesson (source) | Verdict | Evidence | Fix |
|---|---|---|---|---|
| 1 | Never deploy previews to live repos (LL 1.1 / rule 1 / CL 1) | **NOT VERIFIABLE** | No staging repo exists yet (PR §4 recommends `goallak-staging`; not built). Everything ships straight to `goallak.com`. | Stand up option A in PR §4. |
| 2 | Grep for every class/id before injecting CSS; scope under a unique container (LL 2.1 / rule 2 / CL 2) | **VIOLATED** | `.pname` bare @305 (pitch) vs `.pod .pname` @485 (podium) — **F-02** | Rename the pitch class to `.gkPname` (CSS 305, JS 2269). |
| 3 | Never blank rendered UI on a transient error; tell "failed" from "empty" (LL 2.2 / rule 3 / CL 3 / PR class C) | **PARTIAL** | Day view, league tabs, club hero and chat cache are correct. Leaderboard (**F-04**), `ensureTeams` (**F-05**) and `loadChat` (**F-12**) are not. | See detail sections. |
| 4 | Test lifecycles incl. day-rollover (rule 4 / CL 4 / PR gate 9) | **PARTIAL** | Midnight auto-advance is gated on `document.hidden`, `mainView==="scores"` and `view==="home"` (line 3846) — **F-08** | Call the follow-to-today block from `visibilitychange` too. |
| 5 | Validate Arabic to a native standard; fix persisted copies (LL 2.3 / rule 5 / CL 5) | **NOT VERIFIABLE** (structure: **PARTIAL**) | ~180 club spellings cannot be adjudicated here; the file itself carries an "OWNER: please review spellings" note (line 843). Structurally, national-team names are not Arabised at all — **F-11** | Owner review + add `AR_NATIONS`. |
| 6 | Read the spec literally; nothing wider (LL 2.4 / rule 6 / CL 6 / PR class I) | **NOT VERIFIABLE** | Process gate, no artifact in the tree. | Read-back ritual (PR gate 3). |
| 7 | Overlay hit-testing during reveal, base-vs-animation opacity, handler args (LL 2.5) | **COMPLIANT** | No entrance animation on `#modal`/`#playerCard`/`#authModal`; no `on*="fn"` handler receives a stray `Event` (grep: zero matches); `toggleFold(id, this)` and `refreshChatMedia(this)` pass real args. | — |
| 8 | **Fix a class of bug at the lowest common layer, not per render path** (LL 2.6 / rule 2.6) | **VIOLATED** | The single most-broken rule here: **F-01** (live fix on 3 of 4 surfaces), **F-02** (collision guard on 2 of 3 name classes), **F-03** (league added to 1 of 2 systems), **F-10** (aria-labels on 4 of 12 sites), **F-13** (version marker driven from `APP_VERSION` in 1 of 2 places). | Per-finding below. |
| 9 | Lone-letter / homograph translation collisions (LL 2.6) | **PARTIAL** | No live DOM translator exists in Goallak, so the `_tNode` mechanism cannot recur (structurally safe). But `AR_TEAMS` is keyed on lowercased short names and contains generic tokens — `"racing"`, `"sporting"`, `"milan"`, `"basel"`, `"sabah"`, `"nec"`, `"celje"` — which will mistranslate an unrelated club from any newly-added competition. **F-11** | Key the map on ESPN team **id** where known; keep name keys as fallback only. |
| 10 | Logical CSS for anything that mirrors in RTL (LL 2.7 / rule 11) | **COMPLIANT** | `preflight r1` passes; manual sweep of lines 38-601 found only `.tlside.l/.r{text-align:right/left}` (331-332), which is explicitly mirrored at 345-346. `.mx{float:inline-end}`, `.tl::before{inset-inline:0;margin-inline:auto}`, `.lgarrow{margin-inline-start:auto}` all correct. The pitch's `style="left:%"` (2267) is a deliberately physical diagram. | — (see recurrence risk: `r1` does not scan JS-emitted styles). |
| 11 | Do not over-engineer a fix the owner scoped as simple (LL 2.8 / rule 12) | **NOT VERIFIABLE** | Process gate. | — |
| 12 | Adversarial QA before any production deploy touching logic/persisted data (rule 7 / CL 7) | **NOT VERIFIABLE** | No QA artifact in the tree; `preflight.mjs` exists and is green (14 pass / 5 warn / 0 fail), but it is a linter, not QA. | PR §8 item 7 (`node:vm` harness) still unbuilt. |
| 13 | Own the deploy→cache→client path (LL 1.3 / rule 8 / CL 8-9 / PR class F) | **COMPLIANT** | `updateViaCache:"none"` (3953), `registration.update()` on resume/focus + 5-min interval (3936-3942), independent `gkVersionCheck()` no-store version poll with a per-version `sessionStorage` guard (3876-3892), SW `activate` deletes every non-current cache and claims clients (52-58 of `sw.js`). A client cannot be trapped on an old build. | — |
| 14 | Bump version + FORCE_RELOAD + SW CACHE on every deploy (rule 9 / CL 8) | **PARTIAL** | All five markers currently agree (`preflight v1` PASS: 4.4 / `goalak-v38` / `2026-08-16-v44`), but the footer marker `#appVer` (line 726) is a **hand-typed literal that no JS repaints** — the same drift class that already shipped a stale `v3.2` in `#shVer`. Fixed in one place only. **F-13** | `$("appVer").textContent = "v" + APP_VERSION;` in `refreshBrandUI()`. |
| 15 | Tournament-phase UI data-driven, never hardcode dates (rule 13) | **VIOLATED** | `Date.UTC(2026, 7, 1)` + `Math.min(150, …)` (3003), `< 2026` (2002, 2083), `statsSeason === 2025` (2052), and "2025-2026" baked into three STR strings (976, 980, 982). **F-09** | Derive from `j.season.year`; drop the 150-day cap. |
| 16 | ESPN silently caps a scoreboard at 100 events without `&limit=` (WCSW v3.31) | **VIOLATED** | Zero of 6 calls send it: index.html 1519, 1538, 1920, 3010, 3327 and worker/src/index.js:209. **F-07** | Append `&limit=300` to all six. |
| 17 | Shootout kicks are not goals — exclude everywhere, not in one consumer (WCSW / PR D2) | **COMPLIANT** | `!d.shootout` in **both** `scorerListHtml` (2323) and `mdEventsHtml` (2342); shootout score shown separately via `shootTxt` in `mrow` (1683) and `renderMatchModal` (2698). | — |
| 18 | `subbedIn`/`subbedOut` are objects, not booleans (v4.0 / `goalak-v34`) | **COMPLIANT** | Single helper `didSub()` (2144) used at every read site: 2154, 2155, 2163, 2167. No raw truthiness test remains. | — |
| 19 | Arabic score orientation consistent on every surface (v4.0) | **COMPLIANT** | `scoreTxt` (1200) used by `mrow`, live chips, match header, `predResultRow` and the timeline's FT marker (2379); `shootTxt` (1204), `pickTxt` (3031), the running score (2346) and the prediction input pair (3082) all follow the same away-home order in AR. Home team renders first in DOM and lands right in RTL, so digits sit under their own club. | — |
| 20 | Arabic club name used on every surface (v3.6 / A5) | **PARTIAL** | `clubAr` is used in rows, table, stats, chat clubs, podium, player card and MOTM. But it is now also applied to the 21 national-team/friendly competitions added in v2.6-v2.7, and `AR_TEAMS` contains **zero** national teams — every country renders in Latin inside the Arabic UI. **F-11** | Add `AR_NATIONS`, consulted when `_gkCompetition.group === "national"`. |
| 21 | Every user-visible string comes from `STR` via `t()` (PR class A) | **PARTIAL** | `preflight i5` passes for Arabic literals, but there is **no check for hardcoded English**, and 5 attribute sites + 3 JS sites are never localised or repainted. **F-10**. Also 15 Arabic literals in inline `LANG === "ar" ?` branches (`i5b` WARN, lines 1151-1152, 1241-1242, 3054). | Add the strings to `STR`; extend preflight with an English-literal check. |
| 22 | Every element repainted on language change **and** at cold boot (v3.3 / A1) | **PARTIAL** | Boot (3895-3926) calls `refreshBrandUI`, `refreshSettingsUI`, `paintNavLabels`, `refreshChatNote`, `refreshChatBar`, `$("fantSoon")` — the v3.3 bug is genuinely fixed. Gaps: the never-repainted attributes in **F-10**, and `setLang` repaints the match sheet (1265) but **not an open player card** — **F-15**. | Repaint `#playerCard` in `setLang`. |
| 23 | Alerts OFF/ON toggle localised (v3.6 / A2) | **COMPLIANT** | `t("offLab")`/`t("onLab")` set in `refreshSettingsUI` (1358-1359), which boot calls. | — |
| 24 | `aria-label`s localised; settings gear has an accessible name (v3.6 / A3, A4) | **VIOLATED** | Fixed for `#setBtn`, `#hdrAuth`, `#tzSel`, `#setSheet` (1361-1364) and the 4 chat tools (3526-3528). **Never fixed** for the theme button (`aria-label="Light / dark theme" title="Light / dark"`, line 661), `#rail` (`aria-label="Leagues"`, 679), the install-bar dismiss (`aria-label="Dismiss"`, 771), the fold button (`aria-label="fold"`, 1762) and the prediction inputs (`aria-label="home"`/`"away"`, 3080-3081). **F-10** | See detail. |
| 25 | Never cache a negative result (PR class C, C3) | **PARTIAL** | Done for the pre-match summary (`ensureSummary` re-checks every 120 s, 2117-2121) and for the ratings failure counter. **Not** done for `ensureTeams`, which persists an empty league for 7 days — **F-05** | Do not persist `gk_teams_v1` unless every league returned rows. |
| 26 | Wipe guard + verify-after-write on every shared-store write (WC chat rules, `goalak-v9`) | **PARTIAL** | `doAuth` (2879-2899), `savePushSub` (3798-3811), `removePushSub` (3816-3830) and `submitPredGk` (3137-3149) all have both. **`saveClubToAccount` (3304-3316) has neither** and writes the whole accounts object. **F-06** | Give it the same guarded loop. |
| 27 | Server-side authority: never trust the client (rule / PR class G) | **PARTIAL** | Chat is exemplary: password verified server-side with `timingSafeEqual` (chat.js 147-149), HMAC-signed sessions with `exp` (chat.js 79-88), delete re-checks ownership in the DO (`chat.js:511`), media served behind a signed, expiring URL. **But** accounts, predictions and the leaderboard live in a world-writable textdb store, and the worker's own `/tdb` proxy re-exposes it with `Access-Control-Allow-Origin: *` for **POST** on any `goalak_*` key (index.js 437-453). Anyone can rewrite anyone's predictions. | Accepted design inherited from the WC app; at minimum restrict `/tdb` POST to the app origin so the proxy is not a *wider* hole than textdb itself. |
| 28 | CORS contract: every method/header the client sends is allowed (G1, PR `w1`) | **COMPLIANT** | `preflight w1` PASS; `GET,POST,DELETE,OPTIONS` + `Authorization,Content-Type,X-Media-Duration` (index.js 370-371) match the client exactly. | — |
| 29 | Worker/client parity of the league registry | **VIOLATED** | Site has 9 league ids, worker has 8 — `seriea` missing. **F-03** | Add it to `worker/src/index.js:36`. |
| 30 | Android Back / history state machine (v3.6 / H1-H3) | **PARTIAL** | Tabs push exactly one entry and replace on tab→tab (2960-2966); `gotoLeague` guards the deep-link double-pane (1838); `popstate` closes overlays before leaving. **But** `openMatch` pushes a history entry while `openPlayerCard` (2618) and `openAuth` (2834) do not, so Back with those open consumes the *tab's* entry; and Escape closes the player card **and** the match sheet in one press (2743). **F-14** | Push an entry in both, and make Escape close only the topmost sheet. |
| 31 | Scroll chaining / body lock released by every closing path (v4.2) | **COMPLIANT** | `overscroll-behavior:contain` + `body.gk-lock` with exact scroll restore (2660-2673); every close routes through `hideSheet()` (2731-2735), which releases the lock only when no sheet remains. | — |
| 32 | Layer inventory: new fixed/sticky panels checked against the bars (B5/B6, PR `c2`) | **PARTIAL** | `.pitch{isolation:isolate;z-index:0}` (301) correctly traps the chips, and `.mdtabs{z-index:30}` is opaque. `preflight c2` still reports `.mx` (sticky, 369) with **no z-index** — paint order alone decides whether the sheet close button survives a future overlapping element. | Give `.mx` an explicit z-index from a named scale. |
| 33 | Cache/deploy: nothing can serve a stale build; SW cannot trap users (F1-F8) | **COMPLIANT** | See row 13. One omission vs the WC app: goalak's `sw.js` has no explicit `if (url.pathname.endsWith("sw.js")) return;` bypass (WC `sw.js:21`). Harmless today (worker-script fetches are not passed to `fetch` events) — **F-18**, LOW. | Add the guard for parity. |
| 34 | Honest hedging on upstream data (D5/D6) | **COMPLIANT** | `tvUnconfirmed` for non-exact fixture matches (1693), `lastSeasonData`/`lastSeasonShown` season notes (2002, 2083), `motmClose` near-tie label (2565), `motmTag` always says "اختيار جولك". | — |
| 35 | ESPN duplicate-fixture handling without collapsing real double-headers (v3.8 / D1) | **COMPLIANT** | `fixtureKey`/`fixtureScore`/`sameFixture`/`dedupeFixtures` (1453-1492) with the venue+3h escape hatch. | — |
| 36 | Day-key arithmetic must not involve a timezone (v3.6 / E1) | **COMPLIANT** | `keyToDate` anchors at 12:00 UTC and `addDaysKey` steps in UTC (1172-1180), with the reason in the comment. | — |
| 37 | Live set gated on state, never on the calendar day (WCSW v2.66 / v4.2 / E2) | **VIOLATED** | `liveNowSet()` (1801-1814) is correct, and the strip, chip and count consume it correctly. The **filtered list** (1742-1750) and the **match sheet** (2110, 2693) both depend on `_gkLeagueId`, which is written only inside `mrow()` (1666). **F-01** | Tag events at cache time, not render time. |
| 38 | Predictions gated on state, not date | **COMPLIANT** | `predLocked` uses kickoff time (3030); `predCache.up/.res` split on `evState` (3018-3019); `submitPredGk` re-checks lock server-of-record side (3129). | — |
| 39 | Push worker gated on state, not date | **COMPLIANT** | `runOnce` transitions on `rec.st` → `st` with real time windows (index.js 233-251); a failed subs or ledger read **aborts the run** rather than proceeding on empty (195, 202) — this is the rule-3 pattern applied correctly. | — |
| 40 | Club hero gated on state | **PARTIAL** | Filters on `evState(e) === "post"` (3329), which is right, but the fetch window starts at `todayKey()` (3327), so a fixture that kicked off before midnight and is still running is invisible to the hero. Low impact. | Use `rangeParam(todayKey(), 1, 30)`. |
| 41 | Refresh tick keeps both live-relevant days warm (v4.2) | **COMPLIANT** | 3851-3859 refreshes today and yesterday whatever day is on screen, then repaints the strip. (It is precisely this correct code that surfaces **F-01**: the events it warms have never been through `mrow`.) | — |

---

## Detailed findings

### F-01 · BLOCKER · The midnight live bug is still shipping, one layer below the fix

**Files:** `goalak/site/index.html:1666`, `:1742-1750`, `:2110`, `:2693`, `:1522`, `:1563`

The v4.2 changelog says the live set "is now gated on STATE ONLY and spans today + yesterday, for
the strip, the LIVE chip, the count **and the filtered list**". The first three are true. The
fourth is not, because the filtered list does not group by the live set — it groups by a field
that only exists on events the day view happened to render:

```js
// 1660  function mrow(e, lg){
// 1666    e._gkLeagueId = lg.id;          <-- the ONLY writer of this field, at RENDER time
```

```js
// 1742  if(chip === "live"){
// 1745    const id = e._gkLeagueId || "";
// 1746    (byLg[id] = byLg[id] || []).push(e);
// 1748  sections = SCORE_GROUPS.filter(lg => byLg[lg.id] && byLg[lg.id].length)
```

An event from *yesterday* reaches `liveNowSet()` through the cache warmed by the refresh tick
(3851-3859) and is painted into the strip by `renderLiveStrip()` — which never calls `mrow`. So
its `_gkLeagueId` is `undefined`, it lands in `byLg[""]`, and no `SCORE_GROUPS` entry has id `""`.

Two more consumers read the same field:

```js
// 2110  const lg = SCORE_GROUPS.find(l => l.id === (e && e._gkLeagueId));   // slugForEvent
// 2693  const eventLeague = SCORE_GROUPS.find(l => l.id === e._gkLeagueId); // broadcastFor
```

**Reproduced live on production, 2026-08-16:**

```
liveNowSet()  ->  [{ id:"401882918", day:20260815, gkLeagueId:"UNDEFINED" }]
selDay        ->  20260816
setChip('live') -> chips: "الكل  ● مباشر (1)  إسبانيا 2  تركيا 3"
                   #mlist: 0 rows, text = "🗓️ لا توجد مباريات في هذا اليوم"
slugForEvent(liveNowSet()[0]) -> null
SCORE_GROUPS.find(l => l.id === e._gkLeagueId) -> undefined
```

Also measured: of 6 cached events for yesterday, **6 had no `_gkLeagueId`**; of 11 for today, **0**.

**User-visible consequence.** Between local midnight and full-time of any late kick-off:
the LIVE chip advertises a match, tapping it says there are no matches; opening that match from
the strip shows no timeline, no line-ups, no stats, no Star of the Match and no TV channel. This
is the owner's reported bug with the visible half fixed.

**Fix (one line, at the lowest common layer).** Tag events where they are cached, not where they
are drawn — in `fetchDayInto` (index.html:1522) write
`dayCache[ck] = {at: Date.now(), events: evs.map(e => (e._gkLeagueId = lg.id, e))};`
and mirror it in `fetchExtrasInto`'s group assembly (index.html:1563). Then delete the assignment
at line 1666 so there is exactly one writer.

---

### F-02 · HIGH · `.pname` collision — the `.msg` lesson, third occurrence

**Files:** `goalak/site/index.html:305` (pitch), `:485-486` (podium), `:2269`, `:3199-3200`

```css
/* 305 — pitch/formation section */
.pname{display:block;font-size:8.5px;color:#fff;margin-top:2px;line-height:1.1;
       text-shadow:0 1px 2px rgba(0,0,0,.95);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 485 — predictions/podium section, ~180 lines later, no colour declared */
.pod .pname{font-size:12px;font-weight:800;max-width:100%;…}
/* 486 */
.pod.p1 .pname{font-size:13.5px;color:var(--gold)}
```

`.pod .pname` (0,2,0) wins on the properties it declares, but it declares no `color`, so ranks
**#2 and #3** inherit `color:#fff` and a hard black text-shadow from the pitch rule.

**Reproduced live on production (light theme):**

```
podium background : rgb(255, 255, 255)
.pod.p1 .pname    : rgb(148, 100, 0)     <- gold, fine
.pod.p2 .pname    : rgb(255, 255, 255)   <- white on white
.pod.p3 .pname    : rgb(255, 255, 255)   <- white on white
.pod.p2 .pname text-shadow : rgba(0,0,0,.95) 0 1px 2px
```

**User-visible consequence.** In light mode — the mode the WC app deliberately made the default
for 60+ readability — the silver and bronze names on the prediction leaderboard podium are
invisible except as a faint smudge from the shadow. Nobody caught it because in dark mode white
on `#121d44` looks correct.

**Fix.** Rename the pitch class to a feature-prefixed one: `.gkPname` in the CSS at line 305 and
in the pitch chip template at line 2269. (A one-property patch — adding `color:var(--txt)` to
`.pod .pname` — hides the symptom but leaves the collision in place for the next feature.)

---

### F-03 · HIGH · Serie A exists in the app and not in the push worker

**Files:** `goalak/worker/src/index.js:25-36` vs `goalak/site/index.html:795-807`

Site league ids: `ucl, uel, epl, liga, seriea, bun, fl1, tsl, spl`.
Worker league ids: `ucl, uel, epl, liga, bun, fl1, tsl, spl` — **no `seriea`**.

`renderPushLgs()` (3738-3743) builds the alert-league chips from the site's `LEAGUES`, so Serie A
is offered. `savePushSub()` stores `lgs:pushLgs`. The worker filters with
`lgs.includes(q.lg.id)` (index.js:262) and never produces `q.lg.id === "seriea"`.

**User-visible consequence.** No Serie A kick-off, goal, red-card or full-time alert is ever sent
to anyone. Worse: a user who picks **only** Serie A silently receives **zero notifications of any
kind**, with the toggle showing ON.

**Fix.** `worker/src/index.js:36` — add
`{ id: "seriea", slug: "ita.1", en: "Serie A", ar: "الدوري الإيطالي" },` and redeploy the worker
**before** the next site deploy (PROCESS gate 10 ordering).

---

### F-04 · HIGH · A failed prediction read is scored as zero points

**File:** `goalak/site/index.html:3177-3183`

```js
const packs = await Promise.all(users.map(u => tdbRead(predKeyFor(u.uid), null).catch(() => null)));
const rows = packs.map((pk, i) => { … if(pk && pk.p) for(const eid in pk.p){ … } return {name, pts, exact}; });
```

This is `.catch(() => ({events:[]}))` from WC lesson 2.2 wearing different clothes: a transient
network failure on one user's file is indistinguishable from "that user has never predicted".

**User-visible consequence.** One flaky request drops a real player from the top of the
leaderboard to 0 points, with no indicator; the wrong podium is then cached in `lbCache` for
60 seconds and shown to everyone who opens the tab.

**Fix.** Keep the failure distinguishable:
`tdbRead(...).then(v => ({ok:true, v})).catch(() => ({ok:false}))`, exclude `!ok` users from the
board, and show the existing `t("lbNoResults")` banner when any were excluded.

---

### F-05 · HIGH · A failed standings fetch is cached as "this league has no teams" for 7 days

**File:** `goalak/site/index.html:3245-3253`

```js
try{ … out[l.id] = entries.map(…); }
catch(_){ out[l.id] = []; }          // 3250 — failure becomes emptiness
…
_teamsCache = out;
localStorage.setItem("gk_teams_v1", JSON.stringify({at:Date.now(), lgs:out}));  // 3253 — and it is persisted
```

`ensureTeams()` is read back for 7 days (3239).

**User-visible consequence.** Two of them. (1) The favourite-club picker in Settings and at signup
silently loses an entire league for a week — a Premier League fan who signed up during one bad
request cannot pick his club and has no way to know why. (2) `trackedClubIds()` (3260-3269) is
built from the same object, so the club-friendlies filter (1543-1548) drops every friendly
involving that league for a week.

**Fix.** On a per-league failure keep the previous value
(`out[l.id] = (_teamsCache && _teamsCache[l.id]) || []`) and skip the `localStorage.setItem`
entirely unless every tracked league returned a non-empty list.

---

### F-06 · HIGH · One shared-store write path has no wipe guard and no verify-after-write

**File:** `goalak/site/index.html:3304-3316`

```js
async function saveClubToAccount(){
  …
  const accts = await tdbRead(ACCT_KEY, null);
  if(!accts || typeof accts !== "object" || !accts[k]) return;
  accts[k].club = myClub ? {…} : null;
  await tdbWrite(ACCT_KEY, accts);     // whole shared object, no guard, no read-back
  return;
}
```

Compare `doAuth` (2883-2898), which for the same key does a fresh re-read, a wipe guard
(`if(cnt === 0 && seen > 0) continue`), a write, and a verify that nobody else's account
disappeared. `savePushSub` and `removePushSub` do the same for the subscription list. Three of the
four writers to shared textdb keys are hardened; this one is not.

**User-visible consequence.** Every time a user changes their favourite club, the entire accounts
object is rewritten from a possibly-stale snapshot. A signup that landed between the read and the
write is erased — that user's account, password hash and prediction identity are gone.

**Fix.** Wrap the body in the same 3-attempt loop `doAuth` uses: re-read, refuse to write over a
suspiciously empty/shrunken read, write, `sleep(300)`, re-read and confirm
`Object.keys(chk).length >= want`.

---

### F-07 · HIGH · No ESPN scoreboard call sends `&limit=`

**Files:** `goalak/site/index.html:1519, 1538, 1920, 3010, 3327`; `goalak/worker/src/index.js:209`

WC `sw.js` v139 changelog, entry v137/v3.31 — the fix that recovered the semi-finals:

> ROOT CAUSE = ESPN silently caps a scoreboard response at 100 events when no limit param is sent…
> `seasonEvents` now sends `&limit=300` (the push Worker always had `&limit=200`, which is why
> notifications were unaffected).

Goallak sends none, anywhere. The widest windows are `rangeParam(tk, 0, 45)` and
`rangeParam(tk, 45, 0)` for league Upcoming/Results (1917), `rangeParam(tk, resDays, 0)` with
`resDays` up to 150 for predictions (3003), and a 3-day window across 21 extra competitions
including `club.friendly` (1538).

**Measured live, 2026-08-16 (a quiet mid-August week):**

```
club.friendly 3-day  (fetchExtrasInto)  -> 60 events   (with &limit=300: 60 — not truncated yet)
eng.1 45-day upcoming (renderLgMatches) -> 50 events
```

**User-visible consequence (latent).** When any window crosses 100, matches silently vanish from
the day list, the league page, the predictions tab or the club hero, with no error and no clue —
exactly the failure mode that hid an entire knockout round in the WC app. `club.friendly` is at
60% of the cap in the quietest week of the year.

**Fix.** Append `&limit=300` to all six URLs. One-line each.

---

### F-08 · MEDIUM · Midnight auto-advance only fires if the app is visible at 00:00

**File:** `goalak/site/index.html:3843-3846` vs `:3863-3870`

```js
setInterval(function(){
  if(document.hidden) return;                                     // 3844
  (function(){ const tk = todayKey();
    if(stripBuiltFor && stripBuiltFor !== tk && selDay === stripBuiltFor
       && mainView === "scores" && view === "home"){ selectDay(tk); } })();   // 3846
```

The `visibilitychange` handler (3863) rebuilds the strip and reloads, but never re-checks
`selDay`.

**User-visible consequence.** An installed PWA backgrounded overnight — the normal case — resumes
in the morning with **yesterday** still selected: yesterday's fixtures, yesterday's counts, and
the date strip highlighting the wrong day. It only self-corrects if the user taps a date. The same
applies to a user who was on the Chat, Predictions or a league page at midnight.

**Fix.** Extract lines 3846 into `function followToday(){…}` (dropping the
`mainView`/`view` conditions, since `selectDay` is safe from any view) and call it from both the
tick and the `visibilitychange` handler.

---

### F-09 · MEDIUM · Hardcoded season dates; leaderboard totals start decaying on 2026-12-29

**File:** `goalak/site/index.html:3002-3003` (plus 976, 980, 982, 2002, 2052, 2083)

```js
/* results window reaches back to season start (2026-08-01) so leaderboard points never decay */
const resDays = Math.min(150, Math.max(14, Math.floor((Date.now() - Date.UTC(2026, 7, 1)) / 86400000) + 2));
```

The comment states the invariant; the `Math.min(150, …)` breaks it. From 150 days after
2026-08-01 — **2026-12-29** — every match older than 150 days falls out of `predCache.res`, and
`renderLeaderboard` scores only what is in `doneMap` (3175-3181).

**User-visible consequence.** From late December, every player's total silently drops a little
each day as their earliest correct predictions stop counting. The champion changes for no visible
reason. This is a dated time bomb in the app's only competitive feature.

Secondary: standing rule 13 ("never hardcode dates"). The season-year comparisons `< 2026`
(2002, 2083), the `statsSeason === 2025` chip (2052) and the literal "2025-2026" in three STR
entries (976, 980, 982) all go wrong at the July 2027 rollover — the "previous season" chip will
still fetch 2025 and the honesty note will still claim 2025-26.

**Fix.** Drop the cap (`Math.max(14, daysSinceSeasonStart)`), and derive both the season anchor and
the season labels from the feed's `j.season.year` / `j.season.displayName` rather than literals.

---

### F-10 · MEDIUM · The aria-label localisation fix reached 4 of 12 sites

**File:** `goalak/site/index.html`

Localised and repainted at boot (1361-1364, 3526-3528): `#setBtn`, `#hdrAuth`, `#tzSel`,
`#setSheet`, `#chatPhoto`, `#chatVideo`, `#chatVoice`, `#chatSend`.

Never localised, never repainted:

| line | element | text |
|---|---|---|
| 661 | theme toggle | `aria-label="Light / dark theme"` and `title="Light / dark"` |
| 679 | league rail | `aria-label="Leagues"` |
| 771 | install-bar close | `aria-label="Dismiss"` |
| 1762 | league fold button (JS) | `aria-label="fold"` |
| 3080 / 3081 | prediction score inputs (JS) | `aria-label="home"` / `aria-label="away"` |

**User-visible consequence.** An Arabic screen-reader user hears five English labels in an
otherwise fully Arabic app, and the theme button — the single control the WC app went to v3.17
lengths to make discoverable — announces itself in English. `STR` already contains `themeLab`,
`darkLab` and `lightLab`, so the strings exist and are simply not wired.

**Fix.** Add `railLab`, `dismissLab`, `foldLab`, `homeLab`, `awayLab` to `STR`; set the theme
button from `t("themeLab")` and the rail/dismiss labels inside `refreshSettingsUI()`; use `t()` in
the two JS templates.

---

### F-11 · MEDIUM · National-team names are never Arabised, and the club map keys on generic tokens

**File:** `goalak/site/index.html:844-931`, `:815-837`

v2.6/v2.7 added 21 national-team and friendly competitions (`fifa.world`, `caf.nations`,
`uefa.euro`, `conmebol.america`, all six World Cup qualifying confederations, …) whose team names
flow through `teamName()` → `clubAr()` → `AR_TEAMS`. `AR_TEAMS` contains **zero** country names,
so every national team renders in Latin script inside the Arabic UI.

Second, the map is keyed on lowercased ESPN short names and holds generic tokens —
`"racing"`, `"sporting"`, `"milan"`, `"basel"`, `"celje"`, `"sabah"`, `"nec"`, `"paok"`. Any
newly-added competition containing a club with one of those short names will be labelled as an
unrelated European club in Arabic. This is the structural half of WC lesson 2.6: a mapping keyed
on an ambiguous token, consulted by a single util that every surface funnels through.

**User-visible consequence.** In the "مباريات المنتخبات" section an Arabic reader sees
`Egypt`, `Morocco`, `Argentina` in Latin next to fully Arabised club fixtures — the v3.6 defect
"9 top-division clubs missing from the Arabic name map", recurring at whole-category scale.

**Fix.** Add an `AR_NATIONS` map consulted by `clubAr` when the event carries
`_gkCompetition.group === "national"`, and prefer ESPN team **id** keys over short-name keys in
`AR_TEAMS` so a short-name collision cannot mislabel a club.

---

### F-12 · MEDIUM · An empty chat history overwrites the local cache

**File:** `goalak/site/index.html:3454-3457`

```js
if(r.ok && j.ok && Array.isArray(j.messages)){
  chatMsgs = normChat(j.messages);
  cacheChat();                       // and persists the emptiness to localStorage
}
```

`chatHistory` (worker `chat.js:224-229`) always returns `ok:true`, so any condition that makes the
Durable Object return an empty list — a room migration, a storage reset, a bad `getHistory` — is
indistinguishable from "the room is empty". The instant-open cache added in v3.10 for exactly this
reason is then destroyed.

**Fix.** `if(r.ok && j.ok && Array.isArray(j.messages) && (j.messages.length || !chatMsgs.length))`.

---

### F-13 · MEDIUM · The footer version marker is a hand-typed literal

**File:** `goalak/site/index.html:726` vs `:1245`

```html
<footer>… <span id="appVer">v4.4</span></footer>          <!-- 726: nothing repaints this -->
```
```js
$("shVer").textContent = t("brand") + " · v" + APP_VERSION + " · " + t("motto");   // 1245
```

The `goalak-v33` changelog records that `#shVer` shipped a stale `v3.2` while the app was on 3.8.
The fix drove `#shVer` from `APP_VERSION` and stopped there; `#appVer` is still maintained by hand
and is the marker the owner actually looks at.

**Fix.** Add `$("appVer").textContent = "v" + APP_VERSION;` to `refreshBrandUI()`.

---

### F-14 · MEDIUM · Overlay history is asymmetric

**File:** `goalak/site/index.html:2618, 2656, 2834, 2743`

`openMatch` pushes `{gkm:1}`; `openPlayerCard` and `openAuth` push nothing, yet the `popstate`
handler (1846-1856) closes all three. Pressing Back with a player card or the auth modal open
therefore closes it **and** consumes the tab's history entry, so the next Back leaves the tab (or
the app) one press earlier than the user expects. Separately, Escape (2743) calls
`closePlayerCard()` **and** `closeModal()` unconditionally, so one press closes two sheets.

**Fix.** Push a history entry in `openPlayerCard` and `openAuth` as `openMatch` does; make the
Escape handler close only the topmost open sheet.

---

### Low-severity

- **F-15** `setLang` repaints an open match sheet (1265) but not an open **player card**; `setTheme`
  does not refresh the kit variant chosen by `jerseyUrlFor` (2528). Same class as row 22, small blast radius.
- **F-16** `#h12b` / `#h24b` ("AM·PM" / "24H", line 673) have no `STR` entry and are never repainted.
- **F-17** `lgMatchesHtml` (1940-1943) shows a live match in **both** Upcoming and Results.
- **F-18** goalak `sw.js` lacks the WC app's explicit `sw.js` fetch bypass (`site/sw.js:21`).
- **F-19** `broadcastFor` (1633) reads `broadcastCache[dkey(e.date)]`, but only `selDay`'s pack is
  fetched — a cross-midnight live match loses its TV channel even after F-01 is fixed.
- **F-20** `preflight c2` still reports `.mx` (sticky, line 369) with no z-index.
- **F-21** `allowedOrigin` (worker index.js:361) accepts any `http://localhost` origin against
  production; and `/tdb` POST is `Access-Control-Allow-Origin: *` (437) — see table row 27.

---

## Recurrence risk — currently compliant, structurally easy to break again

These are the places where the *guard* is weaker than the *rule*, which is how every one of the
findings above got through a green preflight.

| Rule now held | How it breaks again | Guard that would make it permanent |
|---|---|---|
| **Class collisions** (row 2) | `preflight c1` compares only **bare-vs-bare** selectors. It passed while `.pname` (bare) collided with `.pod .pname` (descendant) — a live, reproduced bug. | Extend `c1`: for every bare `.x` rule, flag any *other* rule mentioning `.x` in a different banner section, descendant selectors included. That single change catches F-02 today. |
| **Logical CSS / RTL** (row 10) | `preflight r1` scans only the `<style>` block. `style="left:…"` emitted from JS (2267) and `style="position:absolute;left:-9999px"` (603) are invisible to it. | Extend `r1` to scan JS string literals for `style="` … `left:`/`right:`/`margin-left`. |
| **Everything comes from `STR`** (row 21) | `i5`/`i6` only detect **Arabic** literals. There is no detector for hardcoded **English** — which is why all five never-localised `aria-label`s (F-10) sit inside a green run. Arabic is the default language, so English is the leak direction that matters. | Add `i7`: any `aria-label=`/`title=`/`placeholder=`/`alt=` with a Latin-letter literal, in markup or in a JS template, that is not assigned from `t()`. |
| **Worker/client parity** (rows 28-29) | `w1` checks CORS methods and headers only. Nothing compares the two league registries, the two `evState` implementations, or the two `slug` lists. Serie A slipped through (F-03). | Add `w2`: assert the site's `LEAGUES[].id` set is a subset of the worker's, and that every site `slug` appears in the worker. |
| **Upstream caps** (row 16) | Nothing enforces the `&limit=` rule and nothing will notice a truncated response, because a capped response looks identical to a real one. | Add `d1`: fail any `"/scoreboard?dates="` URL without `&limit=`. Add a runtime `console.warn` when `events.length >= 100`. |
| **"failed" vs "empty"** (row 3) | PROCESS §2 already proposes exactly this and it is unbuilt: "a preflight rule that fails any `catch` block containing `innerHTML =` or returning an empty collection". F-04 and F-05 are both single-line `catch` clauses. | Implement it. Both findings are literally `catch(_) { … = [] }` / `.catch(() => null)`. |
| **Never cache a negative** (row 25) | `ensureTeams` persists an empty result for 7 days. Nothing forbids a `localStorage.setItem` inside or downstream of a `catch`. | Code-review question in the gate, or a preflight rule: any `localStorage.setItem` whose value can be produced by a `catch` branch must carry a short TTL. |
| **Live set is state-gated** (row 37) | `_gkLeagueId` is a render-time side effect that three unrelated readers depend on. Any new consumer of `liveNowSet()` inherits the bug. | After the F-01 fix, add a one-line comment at the single writer, and a preflight assertion that `_gkLeagueId` is assigned in exactly one place. |
| **Version ritual** (row 14) | Two of the five markers are hand-typed literals (`#appVer` line 726, `#shVer` line 676). `v1` catches drift *after* it is typed, not the fact that a human has to type it. | Drive both from `APP_VERSION` at boot (F-13); then `v1` has only three things left to compare. |
| **Day-rollover lifecycle** (row 4) | The follow-to-today logic lives inline inside a `setInterval` that returns early when hidden, and is gated on two view variables. | One `followToday()` helper, called from the tick, `visibilitychange`, and `showMain("scores")`. |

---

## Lessons that could NOT be verified, and why

1. **Rule 1 / CL 1 — "never deploy to live without an explicit go".** Process gate; nothing in the
   tree records approvals. Compounding it: `PROCESS.md` §4 recommends a `goallak-staging` repo and
   it does not exist, so "previews go to staging" cannot be satisfied as written today.
2. **Rule 5 / CL 5 — Arabic validated to a native standard.** I can verify the *wiring* (done
   above) but not the *correctness* of ~180 Arabic club spellings or the tone of the copy. The
   source itself defers this: `index.html:843` — "OWNER: please review spellings". I also did not
   read the production chat room, so I cannot say whether any wrong copy is already persisted
   there (the second half of the rule).
3. **Rule 6 / 12 and CL 6 — spec literalism and no over-engineering.** Requires the original
   requests; not in the repo.
4. **Rule 7 / CL 7 and PR gate 8 — adversarial QA and the data-shape harness.** `preflight.mjs`
   runs and is green, but the `node:vm` pure-function harness and the saved ESPN fixtures
   (`goalak/fixtures/`) proposed in PROCESS §2 do not exist, so the Class D/E assertions cannot be
   executed. `goalak/worker` has `npm run check`, which I did not run (it would touch
   `node_modules`).
5. **PR gates 4 and 7 — "seen on the owner's real phone, Arabic first" and the physical layer
   check while scrolling.** Requires a device. Note that F-02 is precisely the kind of defect that
   gate would have caught, and that the owner's phone is currently the only detector for it.
6. **Post-deploy proof (CL 9 / PR gate 11).** I verified the *deployed* build matches this tree
   (`APP_VERSION 4.4`, footer `v4.4` read from goallak.com), but there are no git tags and no
   `DEPLOYS.md`, so I cannot verify the deploy log or the rollback path.

---

_Audit performed 2026-08-16 against v4.4 / `goalak-v38`. No application file was modified; no
production write was made. Live verification was read-only DOM/CSS inspection and public ESPN
reads in an isolated browser tab._

---

## Resolution log — v4.5 / `goalak-v39` (built 2026-08-16, NOT yet deployed)

Every finding below was fixed **and re-tested in a browser against the real ESPN feed**, using the
same match the audit used to reproduce the blocker (`401882918`, La Liga, kicked off 2026-08-15).

| # | Status | Verification |
|---|---|---|
| F-01 BLOCKER | **FIXED** | `_gkLeagueId` now written in `fetchDayInto`/`fetchExtrasInto` (cache time), one writer. 88/88 cached events tagged, 0 untagged. The cross-midnight live match: `lg:"liga"`, `slugForEvent → "esp.1"`. LIVE chip list renders **1 row** (was 0 + "no matches this day"); its sheet renders 15 timeline rows, 22 pitch players, 10 stat rows. |
| F-02 HIGH | **FIXED** | Pitch class renamed `.gkPname`; **0 bare `.pname` rules** remain. Light theme podium: p1 `rgb(148,100,0)`, p2/p3 `rgb(13,21,51)` (were `rgb(255,255,255)` on white). Dark unchanged. |
| F-03 HIGH | **FIXED** | `seriea`/`ita.1` added to the worker. New preflight `w2` asserts parity: "all 9 site leagues exist in the push worker". **Worker must deploy before the site.** |
| F-04 HIGH | **FIXED** | Failed reads excluded, not scored 0; partial boards never cached; `lbPartial` banner. Simulated 1-of-3 failure: old → Sami 0 pts at the bottom; new → Sami excluded + banner. |
| F-05 HIGH | **FIXED** | Simulated total standings outage: EPL keeps **20** clubs (was `[]`), `localStorage` **not** written, `_teamsComplete=false` allows retry, recovers to 20 + persisted on the next healthy call. |
| F-06 HIGH | **FIXED** | `saveClubToAccount` now uses `doAuth`'s 3-attempt loop: re-read, wipe guard, write, `sleep(350)`, verify no account was dropped. |
| F-07 HIGH | **FIXED** | All 6 calls go through one `sbUrl()` helper carrying `&limit=300`. New preflight `d2` fails any un-limited scoreboard URL. |
| F-08 MED | **FIXED** | `followToday()` extracted, called from the tick **and** `visibilitychange`. Simulated overnight resume: `selDay` 20260815 → 20260816. |
| F-09 MED | **FIXED** | `Math.min(150,…)` removed; `curSeasonYear()`/`seasonStartMs()`/`seasonLabel()` derive everything. `t()` gained `{S}` interpolation; the three "2025-2026" literals are now data-driven. |
| F-10 MED | **FIXED** | 5 aria-labels + AM·PM/24H localised and repainted. New preflight `i7` detects hardcoded **English** (the leak direction Arabic-default made invisible) and now passes. |
| F-11 MED | **FIXED** | `AR_NATIONS` ported from the WC app (owner-reviewed there) — **178 countries**. Verified Arabic for Egypt/Morocco/Argentina/Saudi Arabia/Japan/Türkiye/Ivory Coast/Cape Verde…, with clubs unaffected including the generic tokens (`Sporting → سبورتينغ لشبونة`, `Racing → راسينغ سانتاندير`). |
| F-12 MED | **FIXED** | Empty history rejected when a cache exists, accepted when the room is genuinely empty. |
| F-13 MED | **FIXED** | `#appVer` driven from `APP_VERSION`; footer reads v4.5 with no hand-typing. |
| F-14 MED | **FIXED** | `openPlayerCard`/`openAuth` push `{gkp:1}`/`{gka:1}`. Escape closes only the topmost sheet — verified: 1st Escape closed the card with the sheet still open, 2nd closed the sheet, lock released. |
| F-15/16/17/18/19/20 LOW | **FIXED** | Player card follows a language change (`إشبيلية · G` → `Sevilla · G`); AM·PM/24H localised; a live match is no longer in both Upcoming and Results; `sw.js` fetch bypass added; cross-midnight broadcasts kept warm; `.mx` given `z-index:40`. |
| F-21 / row 27 | **OPEN** | Worker `/tdb` POST is still `Access-Control-Allow-Origin: *` and `allowedOrigin` accepts any localhost. Inherited from the WC app; needs an owner decision (see below). |
| Rows 1, 5, 6, 11, 12 | **OPEN** | Process/staging/native-Arabic gates — not code. |

### Recurrence guards added to `preflight.mjs`

The audit's central point was that **every one of these bugs passed a green preflight**. Four guards
now close the gaps that let them through:

- **`w2`** — site `LEAGUES[].id`/`slug` must be a subset of the worker's. Catches F-03's class.
- **`d2`** — fails any `/scoreboard?dates=` URL with no `&limit=`. Catches F-07's class.
- **`i7`** — flags hardcoded **English** in `aria-label`/`title`/`placeholder`/`alt`, skipping
  anything repainted at runtime. Catches F-10's class.
- **`c3`** — flags a bare `.x` rule reused as a descendant `.y .x` in another feature section
  (`c1` only compared bare-vs-bare). Catches F-02's class.

Preflight is now **17 pass / 5 warn / 0 fail**.
