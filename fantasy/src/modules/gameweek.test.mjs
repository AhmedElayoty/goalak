/* ============================================================================
   GOALLAK FANTASY — GAMEWEEK MODULE TESTS
   Run:  node goalak/fantasy-demo/modules/gameweek.test.mjs

   Imports nothing but the module under test (plus node:fs, only to read this
   module's OWN stylesheet — the two implementation traps that spec §C.2 warns
   about live in CSS, so they cannot be verified from the markup alone).
   ============================================================================ */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import GW from "./gameweek.js";

const {
  GW_STR, gwT, gwBadge, gwCalendarHtml, gwExplainerHtml,
  gwDeadlineHtml, gwBlankSheetHtml
} = GW;

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, "gameweek.css"), "utf8");

/* ---------------------------------------------------------------- harness -- */
let pass = 0, fail = 0;
const fails = [];

function ok(cond, label) {
  if (cond) { pass++; return; }
  fail++; fails.push(label);
}
function has(hay, needle, label) {
  ok(String(hay).includes(needle), label + "  — expected to contain: " + needle);
}
function hasnt(hay, needle, label) {
  ok(!String(hay).includes(needle), label + "  — expected NOT to contain: " + needle);
}
function group(name) { console.log("\n  " + name); }

const MIN = 60000, HOUR = 3600000, DAY = 86400000;

/* Representative state: the real published December window, which spec §C.1
   calls the single most instructive gameweek of the season. */
const DEC_LEAGUES = [
  { name: { ar: "الدوري الإنجليزي", en: "Premier League" }, mine: true,
    days: [{ day: 5, n: 10, label: "26 ديسمبر" }, { day: 9, n: 10, label: "30 ديسمبر" }, { day: 12, n: 10, label: "2 يناير" }] },
  { name: { ar: "الدوري الاسكتلندي", en: "Scottish Premiership" }, mine: false,
    days: [{ day: 5, n: 6, label: "26 ديسمبر" }, { day: 9, n: 6, label: "30 ديسمبر" }, { day: 12, n: 6, label: "2 يناير" }] },
  { name: { ar: "الدوري الفرنسي", en: "Ligue 1" }, mine: false,
    days: [{ day: 12, n: 5, label: "2 يناير" }, { day: 13, n: 4, label: "3 يناير" }] },
  { name: { ar: "الدوري الإسباني", en: "La Liga" }, mine: true,
    days: [{ day: 13, n: 10, label: "3 يناير" }] },
  { name: { ar: "الدوري الإيطالي", en: "Serie A" }, mine: true,
    days: [{ day: 13, n: 10, label: "3 يناير" }] },
  { name: { ar: "الدوري الألماني", en: "Bundesliga" }, mine: true, state: "none", days: [] },
  { name: { ar: "الدوري التركي", en: "Süper Lig" }, mine: true, state: "none", days: [] }
];
const DEC = {
  lang: "ar", gw: 16, from: "21 ديسمبر", to: "4 يناير", days: 14, long: true,
  clubsPlaying: 90, clubsTotal: 126, leagues: DEC_LEAGUES
};

/* Every rendered string this suite produces, for the blanket sweeps at the end */
const ALL = [];
function render(fn, ...args) { const out = fn(...args); ALL.push(out); return out; }


/* ==========================================================================
   1. gwBadge — four states, and the fourth is the load-bearing one
   ========================================================================== */
group("gwBadge — the four fixture states");
{
  /* Playing once is the default and is NEVER badged. */
  ok(gwBadge({ lang: "ar", kind: "plays" }) === "", "plays -> empty string (kind)");
  ok(gwBadge({ lang: "ar", matches: 1 }) === "", "plays -> empty string (matches:1)");

  const blank = render(gwBadge, { lang: "ar", matches: 0 });
  has(blank, "gwb--blank", "blank badge carries its class");
  has(blank, "مالوش ماتش", "blank badge says مالوش ماتش");
  has(blank, "⊘", "blank badge carries the ⊘ shape channel, not colour alone");

  const dbl = render(gwBadge, { lang: "ar", matches: 2 });
  has(dbl, "gwb--double", "double badge carries its class");
  has(dbl, "بيلعب مرتين", "double badge says بيلعب مرتين");
  has(dbl, "●", "double badge carries the ●● shape channel");

  const tri = render(gwBadge, { lang: "ar", matches: 3 });
  has(tri, "gwb--triple", "triple badge carries its class");
  has(tri, "بيلعب 3 مرات", "triple badge says بيلعب 3 مرات");

  /* THE ONE THAT MATTERS. 30 of 228 Scottish fixtures are unpublished on day
     one. If this rendered as "مالوش ماتش" the app would state something false
     to every Celtic and Rangers owner for seven consecutive rounds. */
  const tbc = render(gwBadge, { lang: "ar", scheduled: false });
  has(tbc, "gwb--tbc", "not-yet-scheduled has its OWN visual class");
  has(tbc, "الميعاد ما اتحددش", "not-yet-scheduled says الميعاد ما اتحددش");
  hasnt(tbc, "مالوش ماتش", "not-yet-scheduled NEVER says مالوش ماتش");
  hasnt(tbc, "gwb--blank", "not-yet-scheduled is not styled as a blank");
  ok(/gwb--tbc/.test(tbc) && /border/.test(CSS.match(/\.gwb--tbc\{[^}]*\}/)[0]),
     "not-yet-scheduled is the dashed class");
  has(CSS.match(/\.gwb--tbc\{[^}]*\}/)[0], "dashed",
      "the tbc badge is dashed — provisional, never mistakable for solid blank");
  has(CSS.match(/\.gwb--blank\{[^}]*\}/)[0], "solid",
      "the blank badge is solid — the opposite reading");

  /* English mirrors */
  has(render(gwBadge, { lang: "en", matches: 0 }), "No match", "EN blank");
  has(render(gwBadge, { lang: "en", matches: 2 }), "Plays twice", "EN double");
  has(render(gwBadge, { lang: "en", matches: 3 }), "Plays 3 times", "EN triple");
  has(render(gwBadge, { lang: "en", scheduled: false }), "Date not set", "EN not scheduled");
  ok(gwBadge({ lang: "en", matches: 1 }) === "", "EN plays -> empty string");
}


/* ==========================================================================
   2. gwDeadlineHtml — the merged ladder, exact copy at every tier
   ========================================================================== */
group("gwDeadlineHtml — one ladder, seven tiers, both languages");
{
  const base = { lang: "ar", gw: 16, nextGw: 17, locksOn: "السبت 26 ديسمبر" };

  const t1 = render(gwDeadlineHtml, 10 * DAY, base);
  has(t1, 'data-gw-tier="1"', "tier 1 = > 7 days");
  has(t1, "يقفل السبت 26 ديسمبر", "tier 1 copy: the date, not a countdown");
  has(t1, 'data-gw-tick="60000"', "tier 1 ticks on load / per minute");
  hasnt(t1, "gwdot", "tier 1 does not pulse");

  const t2 = render(gwDeadlineHtml, 3 * DAY + 4 * HOUR, base);
  has(t2, 'data-gw-tier="2"', "tier 2 = 7 d → 48 h");
  has(t2, "يقفل خلال", "tier 2 copy: يقفل خلال");
  has(t2, '<span dir="ltr">3</span>', "tier 2 day count is a Western digit, dir=ltr");
  has(t2, "يوم", "tier 2 copy: يوم");

  const t2dual = render(gwDeadlineHtml, 2 * DAY + HOUR, base);
  has(t2dual, "يقفل خلال يومين", "tier 2 uses the Arabic DUAL at n=2, not '2 يوم'");
  has(render(gwDeadlineHtml, 2 * DAY + HOUR, { ...base, lang: "en" }), "Locks in 2 days",
      "tier 2 EN at n=2");

  const t3 = render(gwDeadlineHtml, 30 * HOUR, base);
  has(t3, 'data-gw-tier="3"', "tier 3 = 48 h → 24 h");
  has(t3, "يقفل خلال يوم", "tier 3 copy: يقفل خلال يوم …");
  has(t3, '<span dir="ltr">06:00</span>', "tier 3 shows hh:mm, dir=ltr");

  const t4 = render(gwDeadlineHtml, 7 * HOUR + 12 * MIN + 44000, base);
  has(t4, 'data-gw-tier="4"', "tier 4 = 24 h → 3 h");
  has(t4, "يقفل خلال", "tier 4 copy: يقفل خلال hh:mm:ss");
  has(t4, '<span dir="ltr">07:12:44</span>', "tier 4 readout is 07:12:44, dir=ltr");
  has(t4, 'data-gw-tick="1000"', "tier 4 ticks every second");

  const t5 = render(gwDeadlineHtml, 2 * HOUR + 12 * MIN + 44000, base);
  has(t5, 'data-gw-tier="5"', "tier 5 = 3 h → 1 h");
  has(t5, "باقي أقل من 3 ساعات", "tier 5 copy: باقي أقل من 3 ساعات");
  has(t5, '<span dir="ltr">02:12:44</span>', "tier 5 keeps the digits beside the words");
  hasnt(t5, "gwdot", "tier 5 does NOT pulse — the pulse starts at 10 minutes");
  has(render(gwDeadlineHtml, 2 * HOUR, { ...base, lang: "en" }), "Under 3 hours left",
      "tier 5 EN copy");

  const t6 = render(gwDeadlineHtml, 44 * MIN + 12000, base);
  has(t6, 'data-gw-tier="6"', "tier 6 = 1 h → 10 m");
  has(t6, "باقي أقل من ساعة", "tier 6 copy: باقي أقل من ساعة");
  has(t6, '<span dir="ltr">00:44:12</span>', "tier 6 readout");
  hasnt(t6, "gwdot", "tier 6 does NOT pulse");
  has(render(gwDeadlineHtml, 44 * MIN, { ...base, lang: "en" }), "Under an hour left",
      "tier 6 EN copy");

  const t7 = render(gwDeadlineHtml, 7 * MIN + 44000, base);
  has(t7, 'data-gw-tier="7"', "tier 7 = < 10 m");
  has(t7, "باقي", "tier 7 copy: باقي {n} دقايق");
  has(t7, '<span dir="ltr">7</span>', "tier 7 minute count, dir=ltr");
  has(t7, "دقايق", "tier 7 plural");
  has(t7, '<span dir="ltr">07:44</span>', "tier 7 readout is mm:ss");
  has(t7, "gwdot", "tier 7 is the ONLY countdown state that pulses");
  const t7en = render(gwDeadlineHtml, 7 * MIN + 44000, { ...base, lang: "en" });
  has(t7en, "minutes left", "tier 7 EN copy");
  has(t7en, '<span dir="ltr">7</span>', "tier 7 EN minute count is still isolated");

  /* Arabic number agreement in the most-watched sixty seconds of the week */
  has(render(gwDeadlineHtml, 2 * MIN + 5000, base), "باقي دقيقتين", "tier 7 dual: دقيقتين");
  has(render(gwDeadlineHtml, MIN + 5000, base), "باقي دقيقة واحدة", "tier 7 singular");
  has(render(gwDeadlineHtml, 30000, base), "باقي أقل من دقيقة", "tier 7 under a minute");
  hasnt(render(gwDeadlineHtml, 2 * MIN + 5000, base), "2 دقايق",
        "never renders the broken '2 دقايق'");

  const live = render(gwDeadlineHtml, 0, { ...base, live: true });
  has(live, "gwdl--live", "passed + live state");
  has(live, "الجولة شغّالة", "live copy");
  has(live, "gwdot", "live pulses");
  has(render(gwDeadlineHtml, 0, { ...base, lang: "en", live: true }), "Round in play",
      "live EN copy");

  const wait = render(gwDeadlineHtml, -1000, { ...base, confirmAt: "الاثنين 06:00" });
  has(wait, "gwdl--wait", "passed + awaiting final");
  has(wait, "مستني التأكيد", "awaiting copy");
  has(wait, "بتبقى نهائية", "awaiting names when it is confirmed");
  hasnt(wait, "gwdot", "awaiting does not pulse");

  /* §E.2 — the locked-but-running state. Without this the header shows the NEXT
     round's countdown under THIS round's title for thirteen days of a 14-day
     round, and the user concludes their team is still editable. */
  const locked = render(gwDeadlineHtml, 3 * DAY, {
    ...base, locked: true, lockedOn: "19 ديسمبر"
  });
  has(locked, "gwdl-lock", "locked state renders the lock chip");
  has(locked, "مقفلة", "locked chip says مقفلة");
  has(locked, "الجولة", "locked countdown NAMES the round it opens");
  has(locked, "تقفل خلال", "locked countdown: الجولة 17 تقفل خلال …");
  has(locked, '<span dir="ltr">17</span>', "locked countdown names round 17, not 16");
  has(locked, "جولتك أقفلت يوم", "locked state explains which round edits now apply to");
  /* the bug this guards: reusing the full 'Locks in …' label inside 'Round 17
     locks in …' printed the verb twice */
  ok((locked.match(/يقفل خلال/g) || []).length === 0,
     "locked state never prints the verb twice");

  /* > 7 d and locked: the ladder's tier-1 format is a DATE, so the locked
     sentence takes the date form too. "Round 17 locks in Saturday 26 December"
     is not a sentence, and §J.4's own argument — a 9-day countdown is
     permission to close the app — says a date is the right object this far out. */
  const lockedFar = render(gwDeadlineHtml, 10 * DAY, {
    ...base, locked: true, lockedOn: "السبت 26 ديسمبر"
  });
  has(lockedFar, "الجولة", "locked at > 7 d still names the round");
  has(lockedFar, "السبت 26 ديسمبر", "locked at > 7 d uses the date form");
  hasnt(lockedFar, "تقفل خلال", "locked at > 7 d does not say 'locks in Saturday'");

  /* the ladder is monotonic — no gaps, no overlaps */
  const tiers = [10 * DAY, 3 * DAY, 30 * HOUR, 7 * HOUR, 2 * HOUR, 40 * MIN, 5 * MIN]
    .map(ms => Number(gwDeadlineHtml(ms, base).match(/data-gw-tier="(\d)"/)[1]));
  ok(tiers.join(",") === "1,2,3,4,5,6,7", "the ladder is strictly monotonic: " + tiers.join(","));

  /* one-argument call still works, per the signature note */
  ok(typeof gwDeadlineHtml(5 * HOUR) === "string", "gwDeadlineHtml(msLeft) alone returns HTML");
}


/* ==========================================================================
   3. gwCalendarHtml — league rows, the December window
   ========================================================================== */
group("gwCalendarHtml — league rows, not club rows");
{
  const cal = render(gwCalendarHtml, DEC);

  ok((cal.match(/class="gwm-r/g) || []).length === 7, "seven LEAGUE rows, one per league");
  ok((cal.match(/class="gwm-r mine/g) || []).length === 5, "five rows marked as yours");
  has(cal, "الدوري الإنجليزي", "row label: the Premier League");
  has(cal, "الدوري التركي", "row label: the Süper Lig");
  has(cal, "--days:14", "the window length drives the day gridline");
  has(cal, "gwm-t none", "a league with zero fixtures gets the hatched track");
  has(cal, "مالوش ماتش", "the hatched track says مالوش ماتش");
  has(cal, "90", "the coverage caption carries the club count");
  has(cal, "126", "the coverage caption carries the universe size");
  has(cal, "من", "coverage reads '90 من 126 نادي'");
  hasnt(cal, "%", "coverage is a COUNT, never a percentage — §K.2 forbids the ratio");
  has(cal, "جولة طويلة", "the long-round chip renders when long:true");
  has(cal, 'role="group"', "the diagram wrapper is a labelled group");
  has(cal, 'role="img"', "every row is individually readable");
  has(cal, "3 أيام ماتشات", "a playing row's aria-label states its match days");
  has(cal, "مفيش ماتشات في الجولة دي", "an empty row's aria-label states the blank");
  has(cal, "26 ديسمبر", "aria-label lists the actual dates");

  /* dot sizing — three sizes, monotonic, so match count survives greyscale.
     The real December window has no 1–3 match day (its smallest is France's
     4-match Saturday), so the smallest dot is exercised separately. */
  has(cal, "--s:12px", "8+ matches on a day -> 12 px dot");
  has(cal, "--s:9px", "4–7 matches on a day -> 9 px dot");
  has(render(gwCalendarHtml, {
    ...DEC, leagues: [{ name: "الدوري الفرنسي", mine: true, days: [{ day: 3, n: 2 }] }]
  }), "--s:6px", "1–3 matches on a day -> 6 px dot");

  /* dot placement, centred in the day cell so it never sits on a rail */
  const ts = [...cal.matchAll(/--t:([\d.]+)/g)].map(m => Number(m[1]));
  ok(ts.length === 10, "ten match-day dots across the seven leagues, got " + ts.length);
  ok(ts.every(t => t > 0 && t < 100), "no dot is placed on either deadline rail");

  const tbc = render(gwCalendarHtml, {
    ...DEC,
    leagues: [{ name: "الدوري الاسكتلندي", mine: true, state: "tbc", days: [] }]
  });
  has(tbc, "gwm-t tbc", "an unpublished league gets the tbc track, not the blank one");
  has(tbc, "الميعاد ما اتحددش", "the tbc track says الميعاد ما اتحددش");
  hasnt(tbc, "مالوش ماتش", "the tbc track NEVER says مالوش ماتش");

  const inline = render(gwCalendarHtml, { ...DEC, density: "inline" });
  has(inline, "gwm--inline", "inline density has its own modifier");
  hasnt(inline, "gwm-l", "inline density drops the labels");
  hasnt(inline, "gwm-lg", "inline density drops the legend");
  has(inline, "يوم", "inline density still prints the day count");
  has(inline, '<span dir="ltr">14</span>', "inline day count is a Western digit, dir=ltr");

  const en = render(gwCalendarHtml, { ...DEC, lang: "en" });
  has(en, "Premier League", "EN row labels come from the {ar,en} pair");
  has(en, "Round 16", "EN title");
  has(en, "of 126 clubs have a match", "EN coverage caption");
  has(en, "no matches in this round", "EN empty-row aria");
  has(en, "Long round", "EN long-round chip");

  /* a 2-day round exercises the Arabic dual on the header range */
  has(render(gwCalendarHtml, { ...DEC, days: 2 }), "يومين", "a 2-day round uses the dual");
}


/* ==========================================================================
   4. gwExplainerHtml
   ========================================================================== */
group("gwExplainerHtml — the sentence, then the box");
{
  const x = render(gwExplainerHtml, { lang: "ar", days: 14, dots: [
    { day: 2, n: 8 }, { day: 6, n: 6 }, { day: 11, n: 9 }
  ] });
  has(x, "الجولة فترة بين إقفالين.", "the hero's first sentence — the definition");
  has(x, "كل ماتش تلعبه أنديتك جوّاها بيتحسب لك.", "the hero's second sentence — the rule");
  ok(x.indexOf("الجولة فترة بين إقفالين.") < x.indexOf("كل ماتش تلعبه"),
     "definition comes before rule");
  has(x, "gwx-hero", "the sentence is the hero");
  has(x, "الدوريات السبعة مبتلعبش في نفس المواعيد", "the obligatory companion line follows it");
  ok(x.indexOf("gwx-why") > x.indexOf("gwx-hero"),
     "fxGwOneWhy sits DIRECTLY BENEATH fxGwOne, as §A.3 requires");
  has(x, "صندوق", "the box metaphor appears");
  has(x, "gwm--inline", "the box carries the §C.4 mini diagram");
  has(x, "جدول الجولات كله متحسب ومنشور", "the §K.3 trust claim closes the panel");
  hasnt(x, "نافذة", "the window metaphor is internal and NEVER ships");
  hasnt(x, "70", "the coverage floor is never published");

  const xe = render(gwExplainerHtml, { lang: "en", days: 14 });
  has(xe, "A round is a period between two deadlines.", "EN definition");
  has(xe, "Every match your clubs play inside it counts for you.", "EN rule");
  has(xe, "Each round is a box with two dates", "EN box");
  has(xe, "does not change", "EN trust claim");

  /* it must survive with no calendar data at all */
  ok(typeof gwExplainerHtml({ lang: "ar" }) === "string", "explainer renders without a diagram");
}


/* ==========================================================================
   5. gwBlankSheetHtml — the angry Monday
   ========================================================================== */
group("gwBlankSheetHtml — why did I score nothing?");
{
  const st = {
    lang: "ar", gw: 16, nextGw: 17, points: 12, status: "final",
    clubs: [
      { name: "بايرن ميونخ", code: "BAY", league: "الدوري الألماني", blank: true,
        pausedFrom: "19 ديسمبر", pts: 0, sub: { name: "ليل", slot: 1, pts: 9 } },
      { name: "غلطة سراي", code: "GAL", league: "الدوري التركي", blank: true,
        pausedFrom: "20 ديسمبر", pts: 0, sub: { name: "بورتو", slot: 2, pts: 6 } },
      { name: "شتوتغارت", code: "VFB", league: "الدوري الألماني", blank: true,
        pausedFrom: "19 ديسمبر", pts: 0, sub: null },
      { name: "أرسنال", code: "ARS", league: "الدوري الإنجليزي", captain: true,
        matches: 3, pts: 18 }
    ],
    pausedLeagues: [{ name: "الدوري الألماني", from: "19 ديسمبر" },
                    { name: "الدوري التركي", from: "20 ديسمبر" }],
    nextDate: "6 يناير", nextMissing: 1,
    calendar: { days: 14, dots: [{ day: 2, n: 8 }, { day: 8, n: 9 }] }
  };
  const j = render(gwBlankSheetHtml, st);

  /* 1. the number first, without hedging */
  ok(j.indexOf('class="gwj-big"') < j.indexOf("gwj-answer"),
     "the score is rendered BEFORE the explanation — no softening first");
  has(j, ">12<", "the score itself");
  has(j, "نهائي", "the round state pill");

  /* 2. the cause in one line, above the fold */
  has(j, "3", "the blank count");
  has(j, "من أنديتك مكانش عندهم ماتش في الجولة دي", "the answer names the cause");
  has(j, "دخل", "the answer says how many subs came in");
  ok(j.indexOf("gwj-answer") < j.indexOf("gwj-list"),
     "the answer card sits above the club list, not behind a tap");

  /* 3. the proof, per club, with dates — and at LEAGUE level */
  has(j, "الدوري الألماني وقف من", "a blank row carries the LEAGUE-level reason");
  has(j, "19 ديسمبر", "…with the date");
  has(j, "الدوري التركي وقف من", "the second paused league too");
  ok(j.indexOf("بايرن ميونخ") < j.indexOf("أرسنال"),
     "blanked clubs are listed first — they are the question");

  /* 4. what the substitutes recovered, and where they did not */
  has(j, "دخل مكانه: ليل", "the successful substitution is named");
  has(j, "+9", "…with its points");
  has(j, "بديل", "…and its bench slot");
  has(j, "مفيش بديل عنده ماتش", "the FAILED substitution is stated just as plainly");
  ok(j.includes("gwj-nosub"), "the uncovered blank has its own row treatment");

  /* 5. a next action, naming a DATE not a countdown */
  has(j, "أنديتك هترجع تلعب في الجولة", "the next-action card");
  has(j, "6 يناير", "…names a date");
  hasnt(j, "يقفل خلال", "the next action is NOT a countdown");
  has(j, "data-gw-cta=", "the CTA is bindable by the host");
  hasnt(j, "onclick", "no inline handler — the function stays pure");

  /* the accordion, inline, terminating */
  has(j, "<details", "the why expansion is an inline accordion, not a sheet");
  has(j, "ليه ما لعبوش؟", "…with the right label");
  has(j, "gwm--inline", "…containing the §C.4 diagram");
  has(j, "الجولة فترة بين إقفالين.", "…and fxGwOne");
  has(j, "الدوريات السبعة", "…and fxGwOneWhy");

  /* what it must NEVER do */
  hasnt(j, "للأسف", "never apologises (AR)");
  hasnt(j, "آسف", "never says sorry (AR)");
  hasnt(j, "المعدل", "never compares to the average unprompted");

  /* the blank badge appears on the blanked rows, the double badge on a treble */
  has(j, "gwb--blank", "each blanked row carries the مالوش ماتش badge");
  has(j, "gwb--triple", "the club with 3 matches carries the triple badge");

  /* singular / all-covered / relief variants */
  const one = render(gwBlankSheetHtml, {
    ...st, clubs: [st.clubs[0], st.clubs[3]], relief: true
  });
  has(one, "نادي واحد من أنديتك", "singular blank uses the singular string");
  has(one, "دخل بدلاء مكانهم كلهم", "all-covered uses fxBlankSubAll");
  has(one, "gwj-relief", "the §J.6 relief card renders when the rule has fired");
  hasnt(j, "gwj-relief", "…and does not render when it has not");

  const je = render(gwBlankSheetHtml, { ...st, lang: "en" });
  has(je, "of your clubs had no match this round", "EN answer");
  has(je, "No substitute had a match", "EN failed substitution");
  has(je, "Your clubs are playing again in round", "EN next action");
  has(je, "Final", "EN state pill");
}


/* ==========================================================================
   6. ESCAPING — nothing reaches the output un-escaped
   ========================================================================== */
group("escaping — no un-escaped interpolation anywhere");
{
  const XSS = '<img src=x onerror="alert(1)">';
  const QUOTE = 'Ajax " onmouseover="alert(1)';

  const cases = [
    ["calendar league name", gwCalendarHtml({
      ...DEC, leagues: [{ name: XSS, mine: true, days: [{ day: 1, n: 2, label: XSS }] }]
    })],
    ["calendar date fields", gwCalendarHtml({ ...DEC, from: XSS, to: QUOTE })],
    ["calendar aria attribute", gwCalendarHtml({ ...DEC, from: QUOTE })],
    ["deadline locksOn", gwDeadlineHtml(10 * DAY, { lang: "ar", locksOn: XSS })],
    ["deadline confirmAt", gwDeadlineHtml(0, { lang: "ar", confirmAt: XSS })],
    ["deadline lockedOn", gwDeadlineHtml(3 * DAY, {
      lang: "ar", locked: true, nextGw: 17, lockedOn: XSS })],
    ["badge match count", gwBadge({ lang: "ar", matches: 9, kind: "triple" })],
    ["blank sheet club name", gwBlankSheetHtml({
      lang: "ar", gw: 16, nextGw: 17, points: 0, nextDate: XSS,
      clubs: [{ name: XSS, code: XSS, league: XSS, blank: true, pausedFrom: XSS, pts: 0,
                sub: { name: XSS, slot: 1, pts: 3 } }],
      pausedLeagues: [{ name: XSS, from: XSS }] })],
    ["explainer", gwExplainerHtml({ lang: "ar", days: 14 })]
  ];

  /* The escaped payload still CONTAINS the substring "onerror" — as inert text.
     What must not exist is the attribute SYNTAX: an unescaped quote that could
     close an attribute, or a live on*= handler. */
  for (const [label, out] of cases) {
    ALL.push(out);
    hasnt(out, "<img", label + ": no injected tag survives");
    ok(!/ on\w+\s*=\s*["'`]/.test(out), label + ": no live event-handler attribute");
    ok(!/onerror\s*=\s*"/.test(out), label + ": onerror= is never followed by a real quote");
    ok(!/onmouseover\s*=\s*"/.test(out), label + ": onmouseover= is never followed by a real quote");
    ok(!/javascript:/i.test(out), label + ": no javascript: URL");
  }
  has(cases[0][1], "&lt;img", "the injected string is present, but as escaped TEXT");
  has(cases[0][1], "onerror=&quot;", "…and its quotes are neutralised");
  has(cases[2][1], "&quot;", "attribute values are quote-escaped");

  /* every attribute in every rendered string is properly closed */
  for (const out of ALL) {
    ok(!/=""[^\s>]/.test(out), "no malformed attribute in a rendered string");
  }
}


/* ==========================================================================
   7. RTL — no physical direction anywhere it could hurt
   ========================================================================== */
group("RTL — logical properties only");
{
  const PHYSICAL = /(?:^|[^-\w])(left|right)\s*:/;
  for (const out of ALL) {
    ok(!PHYSICAL.test(out), "emitted markup contains no left:/right: declaration");
    ok(!/margin-left|margin-right|padding-left|padding-right|border-left|border-right/.test(out),
       "emitted markup contains no physical box property");
    ok(!/translateX/.test(out), "emitted markup contains no translateX");
    ok(!/text-align\s*:\s*(left|right)/.test(out), "emitted markup contains no physical text-align");
  }

  /* Numbers are Western and isolated */
  ok(!/[٠-٩۰-۹]/.test(ALL.join("")),
     "no Eastern-Arabic digits anywhere — Western digits are the house rule");
  has(ALL.join(""), 'dir="ltr"', "numeric runs are isolated with dir=ltr");
}

group("RTL — the stylesheet, where the two traps live");
{
  /* strip comments first: the file DISCUSSES translateX and left/right at
     length, and the point is that it never DECLARES them */
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  ok(!/(?:^|[^-\w])(left|right)\s*:/.test(css),
     "stylesheet declares no physical left:/right:");
  ok(!/margin-left|margin-right|padding-left|padding-right|border-left|border-right/.test(css),
     "stylesheet uses no physical box properties");
  ok(!/text-align\s*:\s*(left|right)/.test(css), "stylesheet uses no physical text-align");
  ok(!/float\s*:\s*(left|right)/.test(css), "stylesheet uses no physical float");

  /* TRAP 1 — spec §C.2 note 1. translateX(-50%) is a physical direction and
     reverses wrongly in RTL: it would push every dot half a diameter the wrong
     way. Invisible at 6 px in review, visible on a phone. */
  ok(!/translateX/.test(css), "TRAP 1: the dot is never centred with translateX");
  has(css, "margin-inline-start:calc(var(--s,6px) / -2)",
      "TRAP 1: the dot is centred with a negative logical margin");
  has(css, "transform:translateY(-50%)",
      "TRAP 1: only the VERTICAL centring uses a transform");

  /* TRAP 2 — spec §C.2 note 2. Gradients take a physical angle and no logical
     property helps, so the direction is switched on [dir] via a custom prop. */
  has(css, "--gwm-dir:to left", "TRAP 2: RTL is the DEFAULT gradient direction");
  has(css, '[dir="ltr"] .gwm{ --gwm-dir:to right; }',
      "TRAP 2: LTR is the override, not the other way round");
  has(css, "repeating-linear-gradient(var(--gwm-dir)",
      "TRAP 2: the day gridline runs with time, via the switch");

  /* logical properties are actually used */
  for (const p of ["inset-inline-start", "inset-inline-end", "margin-inline-start",
                   "padding-inline-start", "border-block-start", "block-size", "inline-size"]) {
    has(css, p, "stylesheet uses the logical property " + p);
  }

  /* no images, no external assets, no libraries */
  ok(!/url\(/.test(css), "no url() — no images, no fonts, no external assets");
  ok(!/@import/.test(css), "no @import");
  ok(!/<svg|canvas/.test(css), "no SVG, no canvas");

  /* reduced motion is handled for the only thing that moves */
  has(css, "@media (prefers-reduced-motion:reduce)", "prefers-reduced-motion is handled");
  const rm = css.match(/@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?\n\}/)[0];
  has(rm, "animation:none", "…the pulse stops");
  has(rm, "opacity:1", "…and the dot stays VISIBLE with animation off");
  ok((css.match(/animation:/g) || []).length <= 3,
     "only the deadline pulse animates — the calendar animates nothing");
}


/* ==========================================================================
   8. PURITY — state in, string out, nothing else
   ========================================================================== */
group("purity — pure functions, safe to drop in");
{
  const deepFreeze = o => {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.values(o).forEach(deepFreeze);
    }
    return o;
  };

  const frozen = deepFreeze(JSON.parse(JSON.stringify(DEC)));
  const a = gwCalendarHtml(frozen);
  const b = gwCalendarHtml(frozen);
  ok(a === b, "gwCalendarHtml is deterministic");
  ok(Object.isFrozen(frozen.leagues[0]), "gwCalendarHtml did not mutate its input");

  const dst = deepFreeze({ lang: "ar", gw: 16, nextGw: 17, locksOn: "السبت" });
  ok(gwDeadlineHtml(5 * HOUR, dst) === gwDeadlineHtml(5 * HOUR, dst),
     "gwDeadlineHtml is deterministic for a fixed msLeft");

  ok(gwBadge({ lang: "ar", matches: 0 }) === gwBadge({ lang: "ar", matches: 0 }),
     "gwBadge is deterministic");

  /* no globals are read: the module must work with no window, no document, and
     no LANG in scope — which is exactly the environment this test runs in */
  ok(typeof globalThis.document === "undefined", "there is no document here");
  ok(typeof globalThis.LANG === "undefined", "there is no LANG global here");
  ok(typeof globalThis.STR === "undefined", "there is no STR global here");
  ok(a.length > 500, "…and the calendar still rendered fully");

  /* defensive: garbage in, string out, never a throw */
  for (const bad of [undefined, null, {}, { lang: "zz" }, { leagues: null }, { days: -3 }]) {
    let threw = false;
    try {
      gwCalendarHtml(bad); gwExplainerHtml(bad); gwBadge(bad); gwBlankSheetHtml(bad);
      gwDeadlineHtml(NaN, bad);
    } catch (e) { threw = e; }
    ok(!threw, "no throw on degenerate state: " + JSON.stringify(bad) + " " + (threw || ""));
  }
}


/* ==========================================================================
   9. GW_STR — shape, completeness, and the spec's own key list
   ========================================================================== */
group("GW_STR — STR-shaped, bilingual, complete");
{
  const keys = Object.keys(GW_STR);
  ok(keys.length > 80, "GW_STR carries " + keys.length + " strings");

  for (const k of keys) {
    const v = GW_STR[k];
    ok(Array.isArray(v) && v.length === 2, k + " is a [ar, en] pair");
    ok(typeof v[0] === "string" && v[0].length > 0, k + " has Arabic");
    ok(typeof v[1] === "string" && v[1].length > 0, k + " has English");
    ok(v[0] !== v[1] || /^\{/.test(v[0]), k + " is actually translated");
    /* both languages must carry the same placeholders, or a substitution
       silently vanishes in one language only */
    const pa = (v[0].match(/\{\w+\}/g) || []).sort().join(",");
    const pe = (v[1].match(/\{\w+\}/g) || []).sort().join(",");
    ok(pa === pe, k + " has matching placeholders (" + pa + " vs " + pe + ")");
  }

  /* every key the spec names by STR key must exist */
  const SPEC_KEYS = [
    "fxGwOne", "fxGwOneB", "fxGwOneWhy", "fxWizGw",
    "fxCm4Ttl", "fxCm4", "fxCm8Ttl", "fxCm8", "fxSubFirst",
    "fxLocked", "fxNextLocks", "fxLockedWhy", "fxMissed",
    "fxWillBlank", "fxWillBlankWhy", "fxReliefNote", "fxTbc", "fxTbcWhy",
    "fxDecNote", "fxDecTtl", "fxDecWhyH", "fxDecWhy", "fxDecYouH",
    "fxDecP3", "fxDecP2", "fxDecP1", "fxDecP0", "fxDecCap", "fxDecCta",
    "fxCounted", "fxEarlyStart",
    "fxBlankSum", "fxBlankSub", "fxBlankSubAll", "fxBlankWhyCta",
    "fxLeaguePaused", "fxNoSubLeft", "fxBackNext", "fxBackNextD", "fxRelief",
    "fxCalOpen"
  ];
  for (const k of SPEC_KEYS) ok(GW_STR[k], "spec key present: " + k);

  /* §I glossary additions: 3', 4', 37, 38, 39, 40, 41, 44 */
  for (const n of [3, 4, 37, 38, 39, 40, 41, 44]) {
    ok(GW_STR["fxGl" + n + "Term"] && GW_STR["fxGl" + n + "Def"],
       "glossary row " + n + " ships a term and a definition");
  }
  /* 42 (coverage) and 43 (window) are deliberately NOT shipped */
  ok(!GW_STR.fxGl42Term, "glossary 42 (coverage) is deliberately not shipped");
  ok(!GW_STR.fxGl43Term, "glossary 43 (window) is deliberately not shipped");

  /* the two forms must never be swapped: مالوش ماتش on badges, يغيب in prose */
  has(GW_STR.fxNoPlay[0], "مالوش ماتش", "badge form is مالوش ماتش (present tense)");
  has(GW_STR.fxWillBlank[0], "يغيب", "forward-looking form is يغيب");
  hasnt(GW_STR.fxWillBlank[0], "مالوش ماتش", "the forward-looking string never uses the badge form");

  /* gwT is a t()-shaped lookup that takes lang instead of reading it */
  ok(gwT("fxLocked", "ar") === "مقفلة", "gwT resolves Arabic");
  ok(gwT("fxLocked", "en") === "Locked", "gwT resolves English");
  ok(gwT("nope", "ar") === "nope", "gwT falls back to the key, like t()");
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
