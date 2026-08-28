/* ============================================================================
   GOALLAK FANTASY — CHIPS MODULE TESTS
   Run:  node goalak/fantasy-demo/modules/chips.test.mjs

   These assert the RULES of design/fantasy-design.md §1.6, §1.7 and §12.2, not
   that the functions return something. Every rule in §12.2's table has at least
   one test that fails if the rule is removed:

     one chip per gameweek ......................... §3
     Wildcard / Free Hit banned in the first GW .... §4
     Free Hit not in consecutive gameweeks ......... §5
     first set expires at halfway, no carry-over ... §6
     Wildcard Pending at <2 transfers, Active at 2 . §7
     Free Hit never cancellable .................... §7
     Triple Captain passes to vice, then is wasted . §9
     Full Squad adds the four substitutes .......... §10
     chips consume this round's free transfer only . §8

   Imports nothing but the module under test, plus node:fs to read the module's
   OWN stylesheet — the logical-property rule and the reduced-motion rule live
   in CSS and cannot be verified from the markup.
   ============================================================================ */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import CH from "./chips.js";

const {
  CHIP_STR, CHIP_FAMILIES, chipT, chipState, chipFreeTransfers,
  applyChip, chipsHtml, chipCardHtml, chipConfirmHtml
} = CH;

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, "chips.css"), "utf8");
const JS  = readFileSync(join(HERE, "chips.js"), "utf8");

/* ---------------------------------------------------------------- harness -- */
let pass = 0, fail = 0;
const fails = [];

function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++; fails.push(label);
}
function eq(a, b, label) {
  ok(a === b, label + "  — expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
}
function has(hay, needle, label) {
  ok(String(hay).includes(needle), label + "  — expected to contain: " + needle);
}
function hasnt(hay, needle, label) {
  ok(!String(hay).includes(needle), label + "  — expected NOT to contain: " + needle);
}
function group(name) { console.log("\n  " + name); }

/* ---------------------------------------------------------------- fixtures -- */
/* A season with the halfway deadline at the end of round 19, which is what
   fantasy-design.md §12.2's date rule produces for 2026/27. */
const SEASON = { lang: "ar", firstGw: 1, halfwayGw: 19, lastGw: 38 };

function save(over) { return Object.assign({}, SEASON, over || {}); }
function st(over, gw) { return chipState(save(over), gw); }
function s(state, id) { return state.byId[id].state; }

/* resolveSquad()'s own arithmetic. THIS HELPER IS WHY THE TRIPLE CAPTAIN BUG
   SHIPPED GREEN. It used to read `scorer.id === captain` — the arithmetic
   index.html abandoned when the armband was moved onto the SHIRT — while
   claiming in its own comment to be "provably the same shape the app produces".
   It also took no vice-captain, so every fixture here modelled a round in which
   the armband could not move. 315 assertions passed over a chip that could lose
   you points, because the base totals they compared against were ones the app
   cannot produce. It now mirrors index.html: the wearer is decided first (vice
   inherits when the captain's club has no fixture), the double follows the shirt
   so a substitute inherits it, and armband/wearer/viceTook come back out. */
function resolve(lineup, captain, vice) {
  const starters = lineup.map(r => r.id);
  const played = id => {
    if (!id) return false;
    const i = starters.indexOf(id);
    return i >= 0 && !lineup[i].m.blank;
  };
  let wearer = captain || null, viceTook = false;
  if (captain && !played(captain) && vice && vice !== captain && played(vice)) {
    wearer = vice; viceTook = true;
  }
  let total = 0, covered = 0, uncovered = 0, armband = null;
  for (const row of lineup) {
    const scorer = row.sub || row;
    const isCap = row.id === wearer;
    total += scorer.m.pts * (isCap ? 2 : 1);
    if (isCap && !scorer.m.blank) armband = scorer.id;
    if (row.sub) covered++;
    else if (row.m.blank) uncovered++;
  }
  return { total, lineup, covered, uncovered, armband, wearer, viceTook };
}
const plays = (id, pts) => ({ id, m: { blank: false, pts }, sub: null });
const blanks = (id, sub) => ({ id, m: { blank: true, pts: 0 }, sub: sub || null });
const onBench = (id, pts) => ({ id, m: { blank: false, pts } });

/* eleven starters scoring 1..11 = 66, captain "c07" doubled -> 73 */
function xi() {
  const rows = [];
  for (let i = 1; i <= 11; i++) rows.push(plays("c" + String(i).padStart(2, "0"), i));
  return rows;
}
const BENCH4 = [onBench("b1", 5), onBench("b2", 3), onBench("b3", 0), onBench("b4", 7)]; /* 15 */


/* ==========================================================================
   1. THE CATALOGUE — four chips, eight instances, and no fifth
   ========================================================================== */
group("the catalogue — four types, two of each, eight per season");
{
  const state = st({}, 6);
  eq(state.chips.length, 8, "eight chips exist");
  eq(CHIP_FAMILIES.length, 4, "four chip types");

  const families = {};
  for (const c of state.chips) families[c.chip] = (families[c.chip] || 0) + 1;
  eq(Object.keys(families).length, 4, "exactly four distinct families");
  for (const f of CHIP_FAMILIES) eq(families[f], 2, "two of " + f);

  const halves = state.chips.filter(c => c.half === 1).length;
  eq(halves, 4, "four chips in the first half");

  /* fantasy-design.md §1.7: there is NO Assistant Manager chip. It is a stale
     memory from an older FPL season and the rules page lists exactly four. */
  const blob = JSON.stringify(CHIP_STR) + JSON.stringify(CHIP_FAMILIES) + JS;
  hasnt(blob.toLowerCase().replace(/assistant manager chip is a stale/g, ""),
        "assistantmanager", "no Assistant Manager chip anywhere in the module");
  ok(!CHIP_FAMILIES.includes("assman") && !CHIP_FAMILIES.includes("manager"),
     "no Assistant Manager family id");

  /* the four names, exactly as the rules fix them */
  eq(chipT("fxChipWildcard", "ar"), "تغيير شامل", "Wildcard is تغيير شامل");
  eq(chipT("fxChipFreehit", "ar"), "فريق مؤقت", "Free Hit is فريق مؤقت");
  eq(chipT("fxChipTripcap", "ar"), "الكابتن الثلاثي", "Triple Captain is الكابتن الثلاثي");
  eq(chipT("fxChipFullsquad", "ar"), "الفريق الكامل", "Full Squad is الفريق الكامل");
}


/* ==========================================================================
   2. AVAILABILITY IN A NORMAL, MID-SEASON ROUND
   ========================================================================== */
group("a normal round — all four first-half chips are on offer");
{
  const state = st({}, 6);
  for (const f of CHIP_FAMILIES) eq(s(state, f + "-1"), "available", f + "-1 available in round 6");
  for (const f of CHIP_FAMILIES) eq(s(state, f + "-2"), "locked", f + "-2 still locked in round 6");
  eq(state.left[1], 4, "four first-half chips left");
  eq(state.armedId, null, "nothing armed");
}


/* ==========================================================================
   3. ONE CHIP PER GAMEWEEK — never two
   ========================================================================== */
group("one chip per gameweek");
{
  const armed = st({ plays: [{ chip: "tripcap", half: 1, gw: 6, state: "pending" }] }, 6);

  eq(s(armed, "tripcap-1"), "pending", "the armed chip reads as pending");
  eq(armed.armedId, "tripcap-1", "state names the armed chip");

  /* every OTHER chip in the round is refused, and the refusal names the one
     that is already on so the user knows what to cancel */
  for (const f of ["wildcard", "freehit", "fullsquad"]) {
    eq(s(armed, f + "-1"), "locked", f + " is refused while another chip is on");
    eq(armed.byId[f + "-1"].reason, "fxChipOnePerGw", f + " is refused FOR THAT REASON");
    eq(armed.byId[f + "-1"].reasonVars.other, "الكابتن الثلاثي",
       f + "'s refusal names the chip that is blocking it");
  }

  /* and the refusal survives into the confirmation sheet: no confirm button */
  const sheet = chipConfirmHtml(armed.byId["fullsquad-1"]);
  hasnt(sheet, "data-chip-confirm", "a blocked chip's sheet offers no confirm button");
  has(sheet, 'data-level="blocked"', "a blocked chip's sheet is marked blocked");
  has(sheet, "جوكر واحد بس في الجولة", "the sheet states the one-per-round rule");

  /* cancelling frees the round again */
  const cancelled = st({ plays: [{ chip: "tripcap", half: 1, gw: 6, state: "cancelled" }] }, 6);
  eq(cancelled.armedId, null, "a cancelled chip does not occupy the round");
  eq(s(cancelled, "wildcard-1"), "available", "and another chip becomes available again");
  eq(s(cancelled, "tripcap-1"), "available", "a cancelled chip is not spent");

  /* the same chip already on this round is not ALSO blocked by itself */
  eq(armed.byId["tripcap-1"].reason, null, "the armed chip is not blocked by itself");

  /* a chip played in an EARLIER round does not block this one */
  const past = st({ plays: [{ chip: "wildcard", half: 1, gw: 5, state: "active" }] }, 6);
  eq(s(past, "tripcap-1"), "available", "last round's chip does not block this round");
  eq(s(past, "wildcard-1"), "used", "last round's chip is spent");
}


/* ==========================================================================
   4. WILDCARD AND FREE HIT ARE BANNED IN A MANAGER'S FIRST GAMEWEEK
   ========================================================================== */
group("the first gameweek — two chips exist, two do not");
{
  const first = st({ firstGw: 1 }, 1);
  eq(s(first, "wildcard-1"), "locked", "Wildcard is not available in the first round");
  eq(s(first, "freehit-1"), "locked", "Free Hit is not available in the first round");
  eq(first.byId["wildcard-1"].reason, "fxChipRsnFirstGw", "and the reason is the first round");
  eq(first.byId["freehit-1"].reason, "fxChipRsnFirstGw", "and the reason is the first round");

  /* Triple Captain and Full Squad are available immediately — §12.2 */
  eq(s(first, "tripcap-1"), "available", "Triple Captain IS available in the first round");
  eq(s(first, "fullsquad-1"), "available", "Full Squad IS available in the first round");

  /* the ban lifts in round 2 */
  const second = st({ firstGw: 1 }, 2);
  eq(s(second, "wildcard-1"), "available", "Wildcard opens in round 2");
  eq(s(second, "freehit-1"), "available", "Free Hit opens in round 2");

  /* it is the MANAGER'S first round, not the season's: a late joiner whose
     first round is 12 cannot Wildcard in 12 either */
  const late = st({ firstGw: 12 }, 12);
  eq(s(late, "wildcard-1"), "locked", "a late joiner is banned in HIS first round");
  eq(late.byId["wildcard-1"].reason, "fxChipRsnFirstGw", "for the same reason");
  eq(s(st({ firstGw: 12 }, 13), "wildcard-1"), "available", "and free in his second");

  /* the window each card advertises reflects the ban */
  eq(first.byId["wildcard-1"].fromGw, 2, "the Wildcard's first-half window opens at round 2");
  eq(first.byId["tripcap-1"].fromGw, 1, "Triple Captain's opens at round 1");
}


/* ==========================================================================
   5. FREE HIT CANNOT BE PLAYED IN CONSECUTIVE GAMEWEEKS
   ========================================================================== */
group("Free Hit — never two rounds in a row");
{
  /* With one copy per half, back-to-back Free Hits are only reachable ACROSS
     the halfway boundary: play the first-half copy in round 19 and the
     second-half copy unlocks in round 20. That is precisely the seam the rule
     exists to close, and it is the case tested here. */
  const seam = st({ plays: [{ chip: "freehit", half: 1, gw: 19, state: "active" }] }, 20);
  eq(s(seam, "freehit-2"), "locked", "Free Hit is blocked the round after a Free Hit");
  eq(seam.byId["freehit-2"].reason, "fxChipRsnConsec", "and the reason is the consecutive ban");
  eq(seam.byId["freehit-2"].reasonVars.n, 19, "naming the round it was played in");

  /* the ban is on the CHIP, not on the copy: the second Free Hit is blocked by
     the first one even though it is a different instance and a different half */
  eq(s(seam, "freehit-1"), "used", "the first-half copy is spent");

  /* nothing else is blocked by it */
  eq(s(seam, "wildcard-2"), "available", "the Wildcard is unaffected");
  eq(s(seam, "tripcap-2"), "available", "Triple Captain is unaffected");
  eq(s(seam, "fullsquad-2"), "available", "Full Squad is unaffected");

  /* one round further on it is free again */
  const clear = st({ plays: [{ chip: "freehit", half: 1, gw: 19, state: "active" }] }, 21);
  eq(s(clear, "freehit-2"), "available", "two rounds later the ban has lifted");

  /* the same seam, in the middle of a half, if a caller grants both copies to
     one half: round 9 then round 10 is still refused */
  const mid = st({ plays: [{ chip: "freehit", half: 2, gw: 9, state: "active" }] }, 10);
  eq(mid.byId["freehit-1"].reason, "fxChipRsnConsec",
     "the ban does not depend on which copy was played");

  /* and a Free Hit cancelled last round never happened, so it does not block */
  const undone = st({ plays: [{ chip: "freehit", half: 1, gw: 9, state: "cancelled" }] }, 10);
  eq(s(undone, "freehit-1"), "available", "a cancelled Free Hit blocks nothing");
}


/* ==========================================================================
   6. THE HALVES — the first set expires, and NOTHING carries over
   ========================================================================== */
group("halfway — the first set dies at the deadline, the second wakes up");
{
  /* on the last round of the first half the first set is still playable */
  const atHalf = st({}, 19);
  for (const f of CHIP_FAMILIES) eq(s(atHalf, f + "-1"), "available", f + "-1 still playable in round 19");
  for (const f of CHIP_FAMILIES) eq(s(atHalf, f + "-2"), "locked", f + "-2 not yet open in round 19");
  eq(atHalf.byId["wildcard-2"].reason, "fxChipRsnHalf2", "the second set states when it opens");
  eq(atHalf.byId["wildcard-2"].reasonVars.n, 20, "which is round 20");

  /* one round later every unused first-half chip is gone */
  const past = st({}, 20);
  for (const f of CHIP_FAMILIES) {
    eq(s(past, f + "-1"), "expired", f + "-1 has expired in round 20");
    eq(past.byId[f + "-1"].reason, "fxChipRsnExpired", f + "-1 says why");
    eq(past.byId[f + "-1"].cancellable, false, f + "-1 cannot be played after expiry");
  }
  for (const f of CHIP_FAMILIES) eq(s(past, f + "-2"), "available", f + "-2 has unlocked in round 20");
  eq(past.left[1], 0, "no first-half chips are left");
  eq(past.left[2], 4, "all four second-half chips are");

  /* NO CARRY-OVER: four unused first-half chips do not become eight in the
     second half. Exactly four are playable after the halfway deadline. */
  const playable = past.chips.filter(c => c.state === "available").length;
  eq(playable, 4, "four chips playable after halfway — nothing carried over");

  /* an expired chip cannot be confirmed */
  const sheet = chipConfirmHtml(past.byId["wildcard-1"]);
  hasnt(sheet, "data-chip-confirm", "an expired chip's sheet offers no confirm button");

  /* the boundary moves with the calendar — §12.2 sets it by DATE, not by a
     fixed round number, so a 17-round first half behaves identically */
  const early = chipState(save({ halfwayGw: 17 }), 18);
  eq(s(early, "wildcard-1"), "expired", "with halfwayGw=17, round 18 is already the second half");
  eq(s(early, "wildcard-2"), "available", "and the second set is live");
}


/* ==========================================================================
   7. THE CANCELLATION RULES — three different ones, and they differ
   ========================================================================== */
group("cancellation — Wildcard's Pending window, and Free Hit's absence of one");
{
  /* WILDCARD: Unplayed -> Pending (0 or 1 transfers) -> Active (>=2, locked) */
  const wc0 = st({ plays: [{ chip: "wildcard", half: 1, gw: 8, state: "pending", transfers: 0 }] }, 8);
  eq(s(wc0, "wildcard-1"), "pending", "Wildcard at 0 confirmed transfers is Pending");
  eq(wc0.byId["wildcard-1"].cancellable, true, "and is cancellable");

  const wc1 = st({ plays: [{ chip: "wildcard", half: 1, gw: 8, state: "pending", transfers: 1 }] }, 8);
  eq(s(wc1, "wildcard-1"), "pending", "Wildcard at 1 confirmed transfer is still Pending");
  eq(wc1.byId["wildcard-1"].cancellable, true, "and is STILL cancellable");

  const wc2 = st({ plays: [{ chip: "wildcard", half: 1, gw: 8, state: "pending", transfers: 2 }] }, 8);
  eq(s(wc2, "wildcard-1"), "active", "the SECOND confirmed transfer makes it Active");
  eq(wc2.byId["wildcard-1"].cancellable, false, "and it is locked in, forever");

  const wc9 = st({ plays: [{ chip: "wildcard", half: 1, gw: 8, state: "active", transfers: 9 }] }, 8);
  eq(wc2.byId["wildcard-1"].cancellable, wc9.byId["wildcard-1"].cancellable,
     "nine transfers is no more reversible than two");

  /* the live round's transfer count reaches the play when the play omits it */
  const wcLive = st({ transfers: 2, plays: [{ chip: "wildcard", half: 1, gw: 8, state: "pending" }] }, 8);
  eq(s(wcLive, "wildcard-1"), "active", "the round's own transfer count locks the Wildcard");

  /* FREE HIT: never cancellable, not even at zero transfers */
  const fh = st({ plays: [{ chip: "freehit", half: 1, gw: 8, state: "active", transfers: 0 }] }, 8);
  eq(s(fh, "freehit-1"), "active", "Free Hit is Active the moment it is confirmed");
  eq(fh.byId["freehit-1"].cancellable, false, "Free Hit can NEVER be cancelled");

  /* TRIPLE CAPTAIN / FULL SQUAD: cancellable any time before the deadline */
  const tc = st({ plays: [{ chip: "tripcap", half: 1, gw: 8, state: "pending" }] }, 8);
  eq(tc.byId["tripcap-1"].cancellable, true, "Triple Captain is cancellable before the deadline");
  const fs = st({ plays: [{ chip: "fullsquad", half: 1, gw: 8, state: "pending" }] }, 8);
  eq(fs.byId["fullsquad-1"].cancellable, true, "Full Squad is cancellable before the deadline");

  /* ...and locked BY the deadline */
  const shut = st({ deadlinePassed: true, plays: [{ chip: "tripcap", half: 1, gw: 8, state: "pending" }] }, 8);
  eq(s(shut, "tripcap-1"), "active", "after the deadline Triple Captain is locked");
  eq(shut.byId["tripcap-1"].cancellable, false, "and no longer cancellable");
  eq(s(shut, "wildcard-1"), "locked", "and no new chip can be armed for a locked round");
  eq(shut.byId["wildcard-1"].reason, "fxChipRsnDeadline", "for that reason");
}


/* ==========================================================================
   8. THE FREE-TRANSFER RULE — this round's, never the banked ones
   ========================================================================== */
group("free transfers — the chip eats this round's, and only this round's");
{
  const before = { banked: 2, thisGw: 1 };

  const wc = chipFreeTransfers(before, "wildcard-1");
  eq(wc.banked, 2, "Wildcard preserves the 2 banked transfers");
  eq(wc.thisGw, 0, "and consumes this round's");
  eq(wc.total, 2, "so 3 available becomes 2, not 3");

  const fh = chipFreeTransfers(before, "freehit-2");
  eq(fh.total, 2, "Free Hit behaves identically");

  const tc = chipFreeTransfers(before, "tripcap-1");
  eq(tc.total, 3, "Triple Captain costs no transfer at all");
  const fs = chipFreeTransfers(before, "fullsquad-1");
  eq(fs.total, 3, "nor does Full Squad");

  eq(chipFreeTransfers(before, null).total, 3, "no chip, no cost");
  eq(before.banked, 2, "the input is not mutated");
  eq(before.thisGw, 1, "the input is not mutated");
}


/* ==========================================================================
   9. TRIPLE CAPTAIN — x3, the armband moving, and the chip being wasted
   ========================================================================== */
group("Triple Captain — x3 not x2, and what happens when nobody plays");
{
  /* the ordinary case: captain c07 scores 7, doubled to 14 in the base total */
  const base = resolve(xi(), "c07");
  eq(base.total, 73, "base total is 66 + the captain's extra 7");

  const out = applyChip("tripcap-1", Object.assign({}, base, { captain: "c07", vice: "c11" }));
  eq(out.total, 80, "Triple Captain makes it 66 + 2x7 = 80");
  eq(out.total - base.total, 7, "which is exactly one more copy of the captain's score");
  eq(out.chip.delta, 7, "and the chip reports that delta");
  eq(out.chip.effectiveCaptain, "c07", "the armband did not move");
  eq(out.chip.wasted, false, "the chip was not wasted");
  eq(out.chip.applied, true, "the chip was applied");

  /* it is x3, not x2 twice: a 7-point captain contributes 21, never 14 or 28 */
  const solo = resolve([plays("c01", 7)], "c01");
  eq(solo.total, 14, "x2 without the chip");
  eq(applyChip("tripcap", Object.assign({}, solo, { captain: "c01" })).total, 21,
     "x3 with it — not x4, not x2 twice");

  /* THE ARMBAND MOVES. The captain's club has no fixture, so the double — and
     then the x3 — pass to the vice-captain. The base already contains the vice's
     DOUBLE: resolveSquad moves the armband before it sums, which is why the chip
     only ever adds one further copy. (This fixture used to omit the vice entirely
     while handing applyChip one, so the armband could not move and the chip was
     measured against a round the app cannot produce.) */
  const rows = xi();
  rows[6] = blanks("c07");                        /* the captain blanks, uncovered */
  const capBlank = resolve(rows, "c07", "c11");
  eq(capBlank.total, 66 - 7 + 11, "captain blank and uncovered; the vice wears it and is doubled");
  const passed = applyChip("tripcap-1", Object.assign({}, capBlank, { captain: "c07", vice: "c11" }));
  eq(passed.total, 59 + 2 * 11, "the x3 passes to the vice-captain, worth 11");
  eq(passed.chip.passedToVice, true, "and the chip says so");
  eq(passed.chip.effectiveCaptain, "c11", "naming the vice-captain");
  eq(passed.chip.wasted, false, "nothing was wasted");

  /* WASTED, AND NOT REFUNDED. Both clubs blank: the bonus is lost and the chip
     is consumed anyway. fantasy-design.md §1.7 and §12.2. */
  const rows2 = xi();
  rows2[6] = blanks("c07");
  rows2[10] = blanks("c11");
  const bothBlank = resolve(rows2, "c07", "c11");
  eq(bothBlank.total, 66 - 7 - 11, "both blank, so both score nothing");
  const wasted = applyChip("tripcap-1", Object.assign({}, bothBlank, { captain: "c07", vice: "c11" }));
  eq(wasted.total, bothBlank.total, "the total is unchanged — the bonus is lost");
  eq(wasted.chip.delta, 0, "the delta is zero");
  eq(wasted.chip.wasted, true, "the chip is marked wasted");
  eq(wasted.chip.refunded, false, "and it is NOT refunded");
  eq(wasted.chip.applied, true, "it was still consumed");
  eq(wasted.chip.effectiveCaptain, null, "nobody wore the armband");

  /* a captain who blanked but was covered by a substitute does NOT get x3 while
     a vice is available: the armband moves to the vice, and the substitute simply
     scores his own points into the round */
  const rows3 = xi();
  rows3[6] = blanks("c07", { id: "b1", m: { blank: false, pts: 9 } });
  const covered = resolve(rows3, "c07", "c11");
  eq(covered.total, 66 - 7 + 9 + 11, "the substitute's 9 replaces the captain's 7; the vice wears the armband");
  const cov = applyChip("tripcap-1", Object.assign({}, covered, { captain: "c07", vice: "c11" }));
  eq(cov.chip.effectiveCaptain, "c11", "the armband passes to the vice, not to the substitute");
  eq(cov.total, covered.total + 11, "and the vice is tripled — one more copy on top of his double");

  /* THE CASE THAT WAS LOSING PEOPLE POINTS. Captain and vice BOTH blank and both
     are covered, so neither id is among the scorers. The old chip found no
     armband, rebuilt the total with no multiplier at all, and handed back LESS
     than the round was already worth — a chip that charged you to score fewer
     points. The armband is on the captain's shirt, so his substitute inherits it. */
  const rows4 = xi();
  rows4[6] = blanks("c07", { id: "b1", m: { blank: false, pts: 5 } });
  rows4[10] = blanks("c11", { id: "b2", m: { blank: false, pts: 3 } });
  const bothCovered = resolve(rows4, "c07", "c11");
  eq(bothCovered.total, 66 - 7 - 11 + 5 + 3 + 5, "both covered; the captain's substitute inherits the double");
  const bc = applyChip("tripcap-1", Object.assign({}, bothCovered, { captain: "c07", vice: "c11" }));
  eq(bc.total, bothCovered.total + 5, "the chip ADDS a copy of what the armband earned");
  ok(bc.total > bothCovered.total, "and can never be worth less than not playing it");
  eq(bc.chip.wasted, false, "the armband was worn, so nothing was wasted");

  /* the shape survives, exactly */
  ok(Array.isArray(out.lineup), "lineup is still an array");
  eq(out.lineup.length, base.lineup.length, "Triple Captain adds no rows");
  eq(out.covered, base.covered, "covered is unchanged");
  eq(out.uncovered, base.uncovered, "uncovered is unchanged");
  ok(out.lineup[0] && out.lineup[0].id && out.lineup[0].m && "sub" in out.lineup[0],
     "rows keep the {id, m, sub} shape");
  eq(base.total, 73, "applyChip did not mutate the input's total");
  ok(base.lineup.length === 11, "applyChip did not mutate the input's lineup");
}


/* ==========================================================================
   10. FULL SQUAD — exactly the four substitutes, and each exactly once
   ========================================================================== */
group("Full Squad — the four substitutes, counted once each");
{
  const base = resolve(xi(), "c07");
  const withBench = Object.assign({}, base, { captain: "c07", bench: BENCH4 });
  const out = applyChip("fullsquad-1", withBench);

  const benchTotal = BENCH4.reduce((a, b) => a + b.m.pts, 0);
  eq(benchTotal, 15, "the four substitutes are worth 15 between them");
  eq(out.total - base.total, 15, "Full Squad adds EXACTLY the four substitutes' points");
  eq(out.chip.delta, 15, "and the chip reports that delta");
  eq(out.lineup.length, 15, "all fifteen clubs are now in the lineup");
  eq(out.lineup.filter(r => r.bench).length, 4, "four of them are the substitutes");

  /* NOBODY IS PAID TWICE. A substitute who already came on to cover a blank is
     already in the total, so he is not appended again. */
  const rows = xi();
  rows[3] = blanks("c04", { id: "b1", m: { blank: false, pts: 5 } });   /* b1 came on */
  const covered = resolve(rows, "c07");
  eq(covered.total, 73 - 4 + 5, "the auto-sub already paid b1's 5");
  const out2 = applyChip("fullsquad-1", Object.assign({}, covered, { captain: "c07", bench: BENCH4 }));
  eq(out2.total - covered.total, 10, "only the three still sitting down are added (3+0+7)");
  eq(out2.lineup.length, 14, "b1 is not listed twice");
  eq(out2.lineup.filter(r => r.bench && r.id === "b1").length, 0, "b1 is not appended");

  /* and the arithmetic reconciles: every one of the fifteen scored once */
  const all = xi().reduce((a, r) => a + r.m.pts, 0) - 4 /* c04 blanked */ + 7 /* captain again */;
  eq(out2.total, all + benchTotal, "the total is every club counted exactly once");

  /* the substitution story is preserved rather than erased */
  eq(out2.covered, covered.covered, "covered is unchanged");
  eq(out2.uncovered, covered.uncovered, "uncovered is unchanged");

  /* a captain sitting on the bench who now scores is still doubled */
  const capOnBench = applyChip("fullsquad-1",
    Object.assign({}, base, { captain: "b4", bench: BENCH4 }));
  eq(capOnBench.chip.delta, 5 + 3 + 0 + 7 * 2, "a benched captain brought in by Full Squad is doubled");

  /* no bench supplied: nothing to add, and no crash */
  eq(applyChip("fullsquad-1", Object.assign({}, base, { captain: "c07" })).total, base.total,
     "no bench data, no change");

  /* the input is untouched */
  eq(base.lineup.length, 11, "applyChip did not mutate the input's lineup");
}


/* ==========================================================================
   11. WILDCARD AND FREE HIT ARE NOT SCORING CHIPS
   ========================================================================== */
group("the two transfer chips change the squad, never the arithmetic");
{
  const base = resolve(xi(), "c07");
  for (const id of ["wildcard-1", "freehit-2"]) {
    const out = applyChip(id, Object.assign({}, base, { captain: "c07", bench: BENCH4 }));
    eq(out.total, base.total, id + " does not change the total");
    eq(out.lineup.length, 11, id + " does not add rows");
    eq(out.chip.applied, true, id + " is still recorded as applied");
    eq(out.chip.delta, 0, id + " reports a zero delta");
  }
  eq(applyChip("freehit-1", Object.assign({}, base)).chip.note, "reverts-next-deadline",
     "Free Hit flags the revert that the transfer engine has to perform");

  /* no chip at all is the identity */
  const none = applyChip(null, base);
  eq(none.total, base.total, "null chip is the identity");
  eq(none.chip.applied, false, "and is not marked applied");
  eq(applyChip("nonsense", base).chip.applied, false, "an unknown chip id changes nothing");
}


/* ==========================================================================
   12. PURITY
   ========================================================================== */
group("purity — state in, value out, nothing touched");
{
  const input = save({ plays: [{ chip: "wildcard", half: 1, gw: 8, state: "pending", transfers: 1 }] });
  const snapshot = JSON.stringify(input);
  const state = chipState(input, 8);
  chipsHtml(state);
  chipCardHtml(state.byId["tripcap-1"], state);
  chipConfirmHtml(state.byId["tripcap-1"]);
  eq(JSON.stringify(input), snapshot, "chipState and the renderers never mutate the save");

  /* the renderers are deterministic */
  eq(chipsHtml(chipState(input, 8)), chipsHtml(chipState(input, 8)),
     "the same state renders the same string twice");

  /* no ambient reads. Comments are stripped first — the header documents the
     purity contract by naming the very calls it forbids. */
  const src = JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  hasnt(src, "Date.now(", "no clock read");
  hasnt(src, "new Date", "no clock read");
  hasnt(src, "localStorage", "no storage read");
  hasnt(src, "document.", "no DOM access");
  hasnt(src, "window.", "no window access");
  hasnt(src, "fetch(", "no network");
  ok(!/\bMath\.random\b/.test(src), "nothing random");
}


/* ==========================================================================
   13. THE CONFIRMATION — irreversibility, stated DIFFERENTLY per chip
   ========================================================================== */
group("the confirmation — four chips, four different warnings");
{
  const state = st({}, 8);
  const fh = chipConfirmHtml(state.byId["freehit-1"]);
  const wc = chipConfirmHtml(state.byId["wildcard-1"]);
  const tc = chipConfirmHtml(state.byId["tripcap-1"]);
  const fs = chipConfirmHtml(state.byId["fullsquad-1"]);

  /* they are not interchangeable */
  ok(fh !== wc && wc !== tc && tc !== fs, "all four confirmations differ");
  has(fh, 'data-level="final"', "Free Hit is the final level");
  has(wc, 'data-level="conditional"', "the Wildcard is conditional");
  has(tc, 'data-level="soft"', "Triple Captain is soft");
  has(fs, 'data-level="soft"', "Full Squad is soft");

  /* FREE HIT'S WARNING MUST BE FAR STRONGER THAN TRIPLE CAPTAIN'S, and it is
     stronger on four independent axes, not just one: length, number of stated
     consequences, headline weight, and the border treatment. */
  const warnOf = h => h.slice(h.indexOf('class="fxcf-warn'), h.indexOf('fxcf-go'))
                       .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  ok(warnOf(fh).length > warnOf(tc).length * 1.4,
     "1/4 — Free Hit's warning is far longer than Triple Captain's ("
     + warnOf(fh).length + " vs " + warnOf(tc).length + ")");
  ok(warnOf(fh).length > warnOf(wc).length, "and longer than the Wildcard's");
  ok(warnOf(fh).length > warnOf(fs).length * 2, "and more than twice Full Squad's");
  eq((fh.match(/fxcf-wb/g) || []).length, 3, "2/4 — Free Hit states three consequences");
  eq((tc.match(/fxcf-wb/g) || []).length, 1, "Triple Captain states one");
  eq((fs.match(/fxcf-wb/g) || []).length, 1, "Full Squad states one");
  /* 3/4 and 4/4 live in CSS: the final level is the only one with a heavier
     headline and a border on all four sides. */
  const finalCss = CSS.slice(CSS.indexOf('.fxcf-warn[data-level="final"]'));
  has(finalCss, "font-size:15px; font-weight:900", "3/4 — only Free Hit's headline is 15px/900");
  has(finalCss, "border:2px solid var(--fx-chip)", "4/4 — only Free Hit is boxed on all four sides");
  const softBlock = CSS.slice(CSS.indexOf('.fxcf-warn[data-level="soft"]'));
  hasnt(softBlock.slice(0, softBlock.indexOf("}") + 1), "font-weight",
        "the soft level does not touch type weight at all");
  /* the escalation is monotonic in every axis, and it never reaches for a hue:
     no other colour is introduced to carry severity */
  const warnCss = CSS.slice(CSS.indexOf(".fxcf-warn{"), CSS.indexOf(".fxcf[data-level"));
  ok(!/--fx-(urgent|neg|pos|live|acc)/.test(warnCss),
     "severity is type and border, never a borrowed colour");

  /* and it says the thing that is actually true, in words */
  has(fh, "مفيش إلغاء", "Free Hit says there is no cancelling");
  has(fh, "بيرجع زي ما كان", "Free Hit says the squad reverts");
  hasnt(fh, "تقدر تلغيه قبل الإقفال", "Free Hit never claims it can be cancelled");

  /* the Wildcard states the Pending rule in the user's terms, not as a state
     name — fantasy-ui.md §D.8 */
  has(wc, "انتقالين", "the Wildcard warning talks about two transfers");
  hasnt(wc, "Pending", "and never uses the internal state name");

  /* Triple Captain warns about the thing that actually costs people the chip */
  has(tc, "الكابتن البديل", "Triple Captain names the vice-captain fallback");
  has(tc, "مبيرجعش", "and says the chip is not returned");

  /* the transfer cost is stated on the two chips that have one */
  has(fh, "بياخد انتقال الجولة دي بس", "Free Hit states the transfer it consumes");
  has(wc, "بياخد انتقال الجولة دي بس", "so does the Wildcard");
  has(tc, "مبياخدش أي انتقال", "Triple Captain states that it costs nothing");

  /* every confirmation offers a way out */
  for (const [h, n] of [[fh, "Free Hit"], [wc, "Wildcard"], [tc, "Triple Captain"], [fs, "Full Squad"]]) {
    has(h, "data-chip-dismiss", n + "'s sheet offers a way out");
    has(h, "data-chip-confirm", n + "'s sheet offers a confirm");
    has(h, "الجولة", n + "'s sheet names the round");
  }
}


/* ==========================================================================
   14. THE SCREEN
   ========================================================================== */
group("the chips screen");
{
  const html = chipsHtml(st({}, 6));

  has(html, "الجوكرات", "the screen is titled الجوكرات");
  eq((html.match(/class="fxc[ "]/g) || []).length, 8, "all eight chips are on the screen");
  eq((html.match(/fxch-half/g) || []).length, 2, "the two halves of the season are both shown");
  has(html, 'data-now="1"', "the current half is marked as now");
  has(html, "مفيش جوكر مفعّل", "the screen states that nothing is armed");
  has(html, "جوكر واحد بس في الجولة", "the one-per-round rule is on the screen");
  has(html, "مفيش ترحيل", "the no-carry-over rule is on the screen");
  has(html, "الانتقالات اللي مجمّعها من جولات فاتت بتفضل معاك",
      "the banked-transfer rule is on the screen");

  /* every offer is a button carrying its own id; nothing carries an onclick */
  eq((html.match(/data-chip-play=/g) || []).length, 4, "four chips are playable");
  hasnt(html, "onclick", "no inline handlers — the renderers are pure");

  /* the armed round says what is on, and offers a cancel */
  const armed = chipsHtml(st({ plays: [{ chip: "fullsquad", half: 1, gw: 6, state: "pending" }] }, 6));
  has(armed, "مفعّل في الجولة", "the screen names the armed chip");
  has(armed, "data-chip-cancel=", "and offers to cancel it");
  eq((armed.match(/data-chip-play=/g) || []).length, 0, "and offers nothing else to play");

  /* after halfway the first half is present but visibly over */
  const late = chipsHtml(st({}, 20));
  has(late, 'data-gone="1"', "the first half is marked as over");
  has(late, "انتهى", "and its chips read انتهى");
  has(late, "خلص", "and the half itself is tagged خلص");

  /* the six state words all exist and are distinct */
  const words = ["fxChipStAvailable", "fxChipStPending", "fxChipStActive",
                 "fxChipStUsed", "fxChipStExpired", "fxChipStLocked"].map(k => chipT(k, "ar"));
  eq(new Set(words).size, 6, "the six states have six different words");

  /* the expiry line is informative, never urgent — fantasy-engagement.md §I.3 */
  const near = chipsHtml(st({}, 17));
  has(near, "باقي جولتين", "two rounds out, the expiry is stated as a fact");
  hasnt(near, "!", "with no exclamation mark anywhere");
}


/* ==========================================================================
   15. RTL, DIGITS AND ESCAPING
   ========================================================================== */
group("Arabic-first, Western digits, nothing unescaped");
{
  const html = chipsHtml(st({}, 6));

  /* numbers are isolated so a bidi run cannot reorder them */
  has(html, '<span class="fxch-hr" dir="ltr">1–19</span>', "the round range is dir=ltr");
  has(html, 'dir="ltr">19<', "an interpolated round number is dir=ltr");
  has(chipsHtml(st({ plays: [{ chip: "tripcap", half: 1, gw: 6, state: "pending" }] }, 6)),
      'dir="ltr">6<', "so is the armed round's number");
  ok(!/[٠-٩]/.test(html), "Western digits only — no Arabic-Indic numerals");

  /* the two arithmetic glyphs are LTR; the two symbolic ones need no override */
  has(html, '<span class="fxc-glyph" dir="ltr" aria-hidden="true">×3</span>',
      "the Triple Captain glyph is the arithmetic, dir=ltr");
  has(html, "+4", "the Full Squad glyph is the arithmetic too");

  /* nothing the caller can supply reaches the output unescaped */
  const state = st({}, 6);
  state.byId["wildcard-1"].suggest = ['<img src=x onerror="alert(1)">'];
  const dirty = chipCardHtml(state.byId["wildcard-1"], state);
  hasnt(dirty, "<img", "caller-supplied text is escaped");
  has(dirty, "&lt;img", "and rendered as text");
  hasnt(dirty, "onerror=\"", "the attribute cannot break out");

  /* the same for the blocking chip's name, which is interpolated into a reason */
  const armed = st({ plays: [{ chip: "tripcap", half: 1, gw: 6, state: "pending" }] }, 6);
  const card = chipCardHtml(armed.byId["wildcard-1"], armed);
  has(card, "«الكابتن الثلاثي»", "the blocking chip is named in the refusal");

  /* every card is labelled for a screen reader */
  eq((chipsHtml(armed).match(/aria-label=/g) || []).length >= 8, true,
     "every chip carries an aria-label");
}


/* ==========================================================================
   16. CHIP_STR — the shape the app's own t() expects
   ========================================================================== */
group("CHIP_STR — bilingual pairs, STR-shaped");
{
  let bad = 0, empty = 0, unprefixed = 0;
  for (const k of Object.keys(CHIP_STR)) {
    const v = CHIP_STR[k];
    if (!Array.isArray(v) || v.length !== 2) { bad++; continue; }
    if (typeof v[0] !== "string" || typeof v[1] !== "string" || !v[0] || !v[1]) empty++;
    if (!/^fx/.test(k)) unprefixed++;
  }
  eq(bad, 0, "every entry is an [ar, en] pair");
  eq(empty, 0, "no entry is empty in either language");
  eq(unprefixed, 0, "every key is fx-prefixed, so nothing collides on merge");

  /* the four keys fantasy-ui.md §D.8 names verbatim are present under those
     exact names, so the spec and the code can be diffed by eye */
  for (const k of ["fxChipArm", "fxChipCancelable", "fxChipFinal", "fxChipOnePerGw"]) {
    ok(CHIP_STR[k], "§D.8 key " + k + " exists under its own name");
  }

  /* chipT is a t()-shaped lookup that takes lang instead of reading it */
  eq(chipT("fxChipsTtl", "ar"), "الجوكرات", "chipT resolves Arabic");
  eq(chipT("fxChipsTtl", "en"), "Chips", "chipT resolves English");
  eq(chipT("nope", "ar"), "nope", "chipT falls back to the key, like t()");

  /* English renders too, and renders differently */
  const en = chipsHtml(chipState(save({ lang: "en" }), 6));
  has(en, "Chips", "the English screen renders");
  has(en, "only one chip per round", "with the English rule");
  ok(!/[؀-ۿ]/.test(en), "and no Arabic left in it");

  /* Arabic counts a dual: `2 جوكرات` is wrong */
  has(chipT("fxChipLeft2", "ar"), "جوكرين", "the dual is written as a dual");
  hasnt(chipT("fxChipLeft2", "ar"), "2", "and carries no numeral");
  has(chipT("fxChipExpiry2", "ar"), "جولتين", "the round dual too");
}


/* ==========================================================================
   17. THE STYLESHEET — the rules that only exist in CSS
   ========================================================================== */
group("chips.css — logical properties, reduced motion, one colour");
{
  /* strip comments first: the header talks ABOUT left and right */
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  for (const bad of ["margin-left", "margin-right", "padding-left", "padding-right",
                     "border-left", "border-right", "text-align:left", "text-align:right",
                     "left:", "right:"]) {
    hasnt(code, bad, "no physical property: " + bad);
  }
  has(code, "inset-inline", "logical insets are used");

  /* The trap that a `left`/`right` grep does not catch, and that this module
     shipped once and had measured out of it: `translateX` is PHYSICAL and has
     no logical form, so pairing it with a logical inset centres correctly in
     LTR and lands a full element-width off centre in RTL. */
  ok(!/inset-inline-(start|end)\s*:\s*50%/.test(code),
     "nothing is centred with a 50% logical inset");
  for (const m of code.match(/translateX\([^)]*\)/g) || []) {
    ok(false, "no physical translateX survives — found " + m);
  }
  ok(!/translateX/.test(code), "translateX is never used to centre anything");
  has(code, "margin-inline-start", "logical margins are used");
  has(code, "border-inline-start", "logical borders are used");
  has(code, "border-block-start", "logical block borders are used");
  has(code, "inline-size", "logical sizing is used");

  /* it consumes tokens, it never declares them */
  ok(!/--fx-[a-z0-9-]+\s*:/.test(code), "chips.css declares no --fx-* tokens of its own");

  /* violet is the signature and no other hue is borrowed for emphasis */
  has(code, "--fx-chip", "the chip colour is used");
  hasnt(code, "--fx-urgent", "--fx-urgent is not borrowed as a warning colour");
  hasnt(code, "--fx-neg", "--fx-neg is not borrowed as a warning colour");
  hasnt(code, "--fx-live", "--fx-live is not borrowed");
  hasnt(code, "--fx-pos", "--fx-pos is not borrowed");

  /* every text/background pair carries its measured ratio beside it */
  const lines = CSS.split("\n");
  let unmeasured = [];
  for (const line of lines) {
    if (!/(^|[\s;{])color:\s*(var\(--fx-|#)/.test(line)) continue;
    if (!/\d\.\d\d/.test(line)) unmeasured.push(line.trim());
  }
  eq(unmeasured.length, 0,
     "every colour declaration states its measured ratio — missing on: " + unmeasured.join(" | "));

  /* the forbidden pair from fantasy-color.md §A.4.3 / §E.7 */
  ok(CSS.includes("FORBIDDEN on the card"),
     "the ink-mute-on-the-card pair is documented as forbidden");
  const cardBlock = CSS.slice(CSS.indexOf(".fxc{"), CSS.indexOf("3.1 THE SIX STATES"));
  hasnt(cardBlock.replace(/\/\*[\s\S]*?\*\//g, ""), "--fx-ink-mute",
        "and --fx-ink-mute never appears on the clipboard ground");

  /* the six states each have a rule */
  for (const s of ["pending", "active", "used", "locked", "expired"]) {
    has(code, 'data-st="' + s + '"', "the " + s + " state is styled");
  }

  /* motion: everything animated is switched off */
  has(code, "@media (prefers-reduced-motion:reduce)", "reduced motion is honoured");
  const rm = code.slice(code.indexOf("prefers-reduced-motion"));
  const animated = (code.match(/animation:[^;}]+/g) || []).filter(a => !/none/.test(a));
  ok(animated.length > 0 && rm.includes("animation:none"),
     "every animation is switched off under reduced motion");
  ok(rm.includes("transition:none"), "and every transition is too");

  /* only transform / opacity / box-shadow are animated — §F.2 */
  const keyframeBodies = code.match(/@keyframes[^{]+\{[\s\S]*?\n\}/g) || [];
  const props = new Set();
  for (const kf of keyframeBodies) {
    for (const m of kf.matchAll(/([a-z-]+)\s*:/g)) props.add(m[1]);
  }
  for (const p of props) {
    ok(["transform", "opacity", "box-shadow"].includes(p),
       "only transform/opacity/box-shadow are animated — found: " + p);
  }

  /* 360 px is a supported width, not a fallback */
  has(code, "@media (max-width:365px)", "the 360 px phone has its own rules");

  /* fantasy-ui.md §I.2: 48 x 48 minimum for EVERY interactive element, with at
     least 8 px between them. Every control this module introduces clears it. */
  const blockOf = sel => {
    const i = code.indexOf(sel);
    return i < 0 ? "" : code.slice(i, code.indexOf("}", i) + 1);
  };
  has(blockOf(".fxc-act{"), "min-block-size:48px", "the play button clears the 48 px floor");
  has(blockOf(".fxcf-go,"), "min-block-size:48px", "so do the confirmation's two buttons");
  has(blockOf(".fxc-ft{"), "gap:10px", "and controls are spaced by more than 8 px");
  /* the floor is on the CONTROL, never faked by shrinking the graphic */
  hasnt(code, "transform:scale(1.4", "no hit area is faked with a transform");
}


/* ---------------------------------------------------------------- report -- */
console.log("\n" + "=".repeat(60));
if (fail) {
  console.log("FAILED  " + fail + " of " + (pass + fail));
  fails.forEach(f => console.log("  ✗ " + f));
  process.exit(1);
}
console.log("PASSED  " + pass + " assertions, 0 failures");
console.log("=".repeat(60));
