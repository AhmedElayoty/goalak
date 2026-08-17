/* ============================================================================
   GOALLAK FANTASY — TUTORIAL TESTS  (v2: teach by doing)
   Run:  node modules/tutorial.test.mjs      (from fantasy/src/)
   or:   node fantasy/src/modules/tutorial.test.mjs

   These run against the REAL data — clubs.json (126 clubs, 7 leagues) and
   prices.json — because a rule engine that is correct against a fixture is not
   evidence of anything.

   ----------------------------------------------------------------------------
   WHAT CHANGED FROM THE v1 SUITE, AND WHY
   ----------------------------------------------------------------------------
   v1 had 54 assertions, ~25 of which tested tutBuildSquad() — the generator that
   invented a fifteen-club squad and showed it to the player. That generator is
   DELETED in v2 (the owner's instruction: the pitch starts empty and the player
   builds his own team), so its tests are deleted with it. Nothing they protected
   is unprotected now; every guarantee moved to the thing that replaced it:

     v1 assertion (dropped)                     v2 assertion that covers it
     ------------------------------------------ -------------------------------
     the built squad is legal for all 126       §4 "the guided walk ends legal
     favourites                                 for every one of the 126 first
                                                clubs" — the same 126 iterations,
                                                against the squad the PLAYER
                                                builds instead of one we invent
     no league exceeds 3 / no duplicates /      §4 the referee tests: the 4th club
     budget never exceeded / the floor          from a league is refused, the 4th
                                                superclub is refused, a duplicate
                                                and a phantom PICK are inert
     the price ladder is visible, not a          gone with the generator. There is
     barbell                                    no generated shape left to audit;
                                                the player's shape is his own
     the build is deterministic for a seed      gone with the generator. v2 has no
                                                randomness at all
     the favourite grid is 12 clubs spanning     gone with the grid. The first pick
     every league                                is made in the real picker, and §12
                                                asserts the league filter reaches
                                                all 7 leagues
     the swap drill (7 assertions)              gone with the drill. v2 teaches the
                                                bench RULE instead of a gesture,
                                                and DROP is tested in §8

   Everything else from v1 is kept, and the suite grew: the gate rule (§1), the
   empty pitch (§3), the referee (§4), the chips (§7), the anti-drift check
   against chips.js (§6) and the dead-end guard (§9, §12) are all new.
   ============================================================================ */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "..", "..");

const TUT = require(join(HERE, "tutorial.js"));
const {
  TUT_STR, TUT_STEPS, TUT_CHIPS, tutInit, tutReduce, tutHtml, tutT, tutFill,
  tutIsLegal, tutBudget, tutBlockReason, tutGateMet
} = TUT;
/* the two modules the tutorial deliberately duplicates copy from */
const CHIPS = require(join(HERE, "chips.js"));
const GW = require(join(HERE, "gameweek.js"));

const CLUBS_JSON  = JSON.parse(readFileSync(join(SITE, "clubs.json"), "utf8"));
const PRICES_JSON = JSON.parse(readFileSync(join(SITE, "prices.json"), "utf8"));
const CLUBS   = CLUBS_JSON.clubs;
const LEAGUES = CLUBS_JSON.leagues;
const PRICE   = {};
for (const p of PRICES_JSON.clubs) PRICE[p.id] = p.price;
const priceOf = id => (PRICE[id] != null ? PRICE[id] : 8);

/* the constants the app itself declares, mirrored so a change there fails here */
const CTX = {
  clubs: CLUBS, leagues: LEAGUES, price: priceOf,
  size: 15, startSize: 11, budget: 120.0, maxPerLeague: 3, minPrice: 4.5
};

const GWOPT = {
  no: 1,
  from:       ["21 أغسطس", "21 August"],
  to:         ["28 أغسطس", "28 August"],
  lock:       ["يقفل 21 أغسطس", "Locks 21 August"],
  seasonFrom: ["21 أغسطس 2026", "21 August 2026"],
  seasonTo:   ["10 يونيو 2027", "10 June 2027"],
  rounds: 36
};

const baseOpts = lang => Object.assign({}, CTX, { lang, gw: GWOPT });

/* ---------------------------------------------------------------------------
   tiny harness
   --------------------------------------------------------------------------- */
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; failures.push(name + " -> " + e.message); console.log("  FAIL " + name + "\n         " + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || "expected truthy"); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || "") + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); }
function group(n) { console.log("\n" + n); }

/* ---------------------------------------------------------------------------
   THE FOCUS WALK — this suite's most important primitive.
   qa.mjs drives the real page by clicking nothing but [data-tut-focus]; this
   does the same thing in Node, off the rendered string. If the tutorial can be
   completed this way then there is always exactly one visible way forward, which
   is the property that a first-run user's entire experience rests on.
   --------------------------------------------------------------------------- */
const buttons = html => html.match(/<button[^>]*>/g) || [];
function focusTag(html) {
  for (const tag of buttons(html)) if (tag.indexOf("data-tut-focus") >= 0) return tag;
  return null;
}
function attrOf(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
}
function focusAction(html, where) {
  const tag = focusTag(html);
  ok(tag, "no [data-tut-focus] control on " + where);
  ok(!/\sdisabled/.test(tag), "the focus control on " + where + " is disabled: " + tag);
  return { type: attrOf(tag, "data-tut-act"), arg: attrOf(tag, "data-tut-arg") };
}
/* walk to the end, clicking only the focus control. firstPick lets a test choose
   its own opening club (the focus control always offers the dearest legal one). */
function walk(opts, firstPick, limit) {
  let s = tutInit(opts);
  const trail = [], gallery = {};
  let taps = 0;
  while (!s.done && taps < (limit || 80)) {
    const html = tutHtml(s);
    if (!gallery[s.step]) gallery[s.step] = { html: html, s: s, lang: s.lang };
    let a;
    if (firstPick && s.step === "first" && s.squad.length === 0) a = { type: "PICK", arg: firstPick };
    else a = focusAction(html, s.step);
    trail.push(s.step + ":" + a.type);
    s = tutReduce(s, a);
    taps++;
  }
  ok(s.done, "the walk never finished — " + taps + " taps, ended on " + s.step);
  return { s: s, taps: taps, trail: trail, gallery: gallery };
}

/* two galleries, built ONCE: one render of every step in every language. Ten
   tests read them, so the suite pays for 2 walks instead of 20. */
const WALK = { ar: walk(baseOpts("ar")), en: walk(baseOpts("en")) };
const GALLERY = [];
for (const lang of ["ar", "en"])
  for (const id of TUT_STEPS) if (WALK[lang].gallery[id]) GALLERY.push(WALK[lang].gallery[id]);
function forEachStep(fn) { for (const g of GALLERY) fn(g.html, g.s, g.lang); }

/* park the machine on a given step with its gate deliberately UNMET */
function atStepUnmet(id, lang) {
  let s = tutInit(baseOpts(lang || "ar"));
  if (id === "welcome") return s;
  s = tutReduce(s, { type: "NEXT" });                       /* -> first, 0 clubs */
  if (id === "first") return s;
  s = tutReduce(s, { type: "PICK", arg: "364" });           /* -> budget, 1 club */
  if (id === "budget") return s;
  s = tutReduce(s, { type: "NEXT" });                       /* -> eleven, 1 club */
  if (id === "eleven") return s;
  /* fill to 11 (auto-advances to bench), then drop one so the bench gate fails */
  while (s.step === "eleven") {
    const c = dearestLegal(s); ok(c, "ran out of legal clubs filling the eleven");
    s = tutReduce(s, { type: "PICK", arg: c.id });
  }
  if (id === "bench") return tutReduce(s, { type: "DROP", arg: s.squad[0] });
  while (s.step === "bench") {
    const c = dearestLegal(s); ok(c, "ran out of legal clubs filling the bench");
    s = tutReduce(s, { type: "PICK", arg: c.id });
  }
  if (id === "captain") return s;                            /* arrives with no armband */
  s = tutReduce(s, { type: "CAP", arg: s.squad[0] });
  s = tutReduce(s, { type: "NEXT" });                        /* -> chips, none opened */
  if (id === "chips") return s;
  s = tutReduce(s, { type: "CHIP", arg: "wildcard" });
  s = tutReduce(s, { type: "NEXT" });                        /* -> done */
  return s;
}
/* park on a picking step having bought exactly these clubs, in this order. It
   walks the way a player does — the reducer only accepts PICK on a step that
   actually shows a picker, so a test cannot buy a club from the welcome screen
   any more than a user can. */
function withClubs(ids) {
  let s = tutInit(baseOpts("ar"));
  s = tutReduce(s, { type: "NEXT" });                          /* -> first */
  for (const id of ids) {
    s = tutReduce(s, { type: "PICK", arg: id });
    ok(s.squad.includes(id), "withClubs could not buy " + id);
    if (s.step === "budget") s = tutReduce(s, { type: "NEXT" }); /* the first pick moves him on */
  }
  return s;
}
/* the same club the rendered focus control offers: the dearest one that is legal
   right now. Used state-side so the 126-club sweep does not render 1,890 lists. */
function dearestLegal(s) {
  let best = null, bp = -Infinity;
  for (const c of s.clubs) {
    if (s.squad.indexOf(c.id) >= 0) continue;
    if (tutBlockReason(s, c)) continue;
    const p = priceOf(c.id);
    if (p > bp) { bp = p; best = c; }
  }
  return best;
}

/* ===========================================================================
   1. THE GATE RULE — a step that teaches an action does not advance without it
   This section is the whole point of v2. If any of it goes red, the tutorial has
   gone back to being a slideshow.
   =========================================================================== */
group("1. the gate rule");

const GATED = ["first", "eleven", "bench", "captain", "chips"];
const UNGATED = ["welcome", "budget", "done"];

test("there are eight steps, in the order the design declares", () => {
  eq(TUT_STEPS.join(","), "welcome,first,budget,eleven,bench,captain,chips,done");
  eq(TUT_STEPS.length, 8);
});

test("every gated step reports its gate unmet on arrival", () => {
  for (const id of GATED) {
    const s = atStepUnmet(id);
    eq(s.step, id, "could not park on " + id);
    eq(tutGateMet(s), false, id + " arrives with its gate already satisfied");
  }
});

test("NEXT on a gated step with the action undone changes NOTHING", () => {
  for (const id of GATED) {
    const s = atStepUnmet(id);
    const after = tutReduce(s, { type: "NEXT" });
    eq(after.step, id, "NEXT escaped " + id + " without the action");
    eq(JSON.stringify(after.squad), JSON.stringify(s.squad), "NEXT altered the squad on " + id);
    eq(after.captain, s.captain, "NEXT altered the captain on " + id);
  }
});

test("a gated step renders NO primary button until its action is done", () => {
  for (const id of GATED) {
    const html = tutHtml(atStepUnmet(id));
    eq((html.match(/class="tut-cta"/g) || []).length, 0, id + " offers a CTA before the lesson is done");
  }
});

test("an ungated step always offers exactly one primary button", () => {
  for (const id of UNGATED) {
    const html = tutHtml(atStepUnmet(id));
    eq((html.match(/class="tut-cta"/g) || []).length, 1, "CTA count on " + id);
  }
});

test("doing the action reveals the way forward, on every gated step", () => {
  /* first: one club */
  let s = atStepUnmet("first");
  s = tutReduce(s, { type: "PICK", arg: "364" });
  eq(s.step, "budget", "the first pick did not move the player on");

  /* eleven: the eleventh club */
  s = atStepUnmet("eleven");
  let guard = 0;
  while (s.step === "eleven" && guard++ < 30) s = tutReduce(s, { type: "PICK", arg: dearestLegal(s).id });
  eq(s.step, "bench", "the eleventh club did not move the player on");
  eq(s.squad.length, 11, "advanced on the wrong count");

  /* bench: the fifteenth */
  guard = 0;
  while (s.step === "bench" && guard++ < 30) s = tutReduce(s, { type: "PICK", arg: dearestLegal(s).id });
  eq(s.step, "captain", "the fifteenth club did not move the player on");
  eq(s.squad.length, 15);

  /* captain: an armband reveals the CTA but does NOT auto-advance — a tap on a
     card is also how you read it, and hurling the player forward for reading is
     the one place auto-advance would be a punishment */
  eq(s.captain, null, "the tutorial pre-assigned an armband the player did not choose");
  s = tutReduce(s, { type: "CAP", arg: s.squad[3] });
  eq(s.step, "captain", "the captain step auto-advanced");
  eq(tutGateMet(s), true);
  eq((tutHtml(s).match(/class="tut-cta"/g) || []).length, 1, "no CTA after the armband was set");
  s = tutReduce(s, { type: "NEXT" });
  eq(s.step, "chips");

  /* chips: opening one card */
  eq(tutGateMet(s), false);
  s = tutReduce(s, { type: "CHIP", arg: "tripcap" });
  eq(s.step, "chips", "the chips step auto-advanced");
  eq(tutGateMet(s), true, "opening a chip did not satisfy the chips gate");
  s = tutReduce(s, { type: "NEXT" });
  eq(s.step, "done");
});

test("BACK reaches every step from the end and never goes below welcome", () => {
  let s = WALK.ar.gallery.done.s;
  const seen = [s.step];
  for (let i = 0; i < 20; i++) { s = tutReduce(s, { type: "BACK" }); seen.push(s.step); }
  eq(s.step, "welcome", "BACK floors at welcome");
  for (const id of TUT_STEPS) ok(seen.includes(id), "BACK never visited " + id);
});

test("BACK never traps: a gated step re-entered with its work already done offers the CTA", () => {
  /* the trap this guards: gate the CTA, then let BACK drop the player onto a
     gated step whose action is in the past. Every one of them must show the way
     forward again rather than demanding the action twice. */
  let s = WALK.ar.gallery.done.s;
  for (let i = 0; i < TUT_STEPS.length - 1; i++) {
    s = tutReduce(s, { type: "BACK" });
    const html = tutHtml(s);
    ok(focusTag(html), "no way forward after BACK onto " + s.step);
    if (GATED.includes(s.step) && tutGateMet(s))
      eq((html.match(/class="tut-cta"/g) || []).length, 1, "no CTA on a satisfied " + s.step);
  }
});

test("every step renders non-empty markup in both languages", () => {
  let n = 0;
  forEachStep(html => { ok(html.length > 200, "markup too short"); n++; });
  eq(n, TUT_STEPS.length * 2, "rendered step count");
});

test("the whole tutorial completes by clicking only the highlighted control", () => {
  for (const lang of ["ar", "en"]) {
    const w = WALK[lang];
    ok(w.s.done, lang + ": never finished");
    ok(!w.s.skipped, lang + ": finishing by the front door is not a skip");
    eq(w.s.squad.length, 15, lang + ": the walk did not end with fifteen clubs");
    ok(w.s.captain, lang + ": the walk ended with no captain");
    ok(tutIsLegal(w.s.squad, CTX).ok, lang + ": the walk produced an illegal squad — "
      + tutIsLegal(w.s.squad, CTX).errors.join("; "));
    ok(w.taps <= 25, lang + ": " + w.taps + " taps is over the 25-tap budget");
  }
  console.log("         " + WALK.ar.taps + " taps ar / " + WALK.en.taps + " taps en, following the highlight only");
});

/* ===========================================================================
   2. SKIP WORKS FROM EVERY STEP — one tap, always, and it never invents a team
   =========================================================================== */
group("2. skip");

test("SKIP from every step finishes, marks skipped, and hands over EXACTLY what he picked", () => {
  for (const lang of ["ar", "en"]) {
    for (const id of TUT_STEPS) {
      const before = atStepUnmet(id, lang);
      const after = tutReduce(before, { type: "SKIP" });
      ok(after.done, "SKIP from " + id + " did not finish");
      ok(after.skipped, "SKIP from " + id + " did not mark skipped");
      eq(after.squad.join(","), before.squad.join(","),
         "SKIP from " + id + " changed the squad — it must commit what he had, no more and no less");
      ok(!after.captain || after.squad.slice(0, 11).includes(after.captain),
         "SKIP from " + id + " left a captain on the bench");
    }
  }
});

test("SKIP on the first screen hands over an EMPTY pitch, not a generated team", () => {
  /* THE REGRESSION THIS EXISTS FOR: v1's SKIP called ensureSquad() and handed the
     player fifteen clubs he had never seen. The owner's instruction is that the
     pitch starts empty; skipping the lesson cannot secretly fill it. */
  const s = tutReduce(tutInit(baseOpts("ar")), { type: "SKIP" });
  eq(s.squad.length, 0, "SKIP invented a squad");
  eq(s.captain, null, "SKIP invented a captain");
  ok(s.done && s.skipped);
});

test("SKIP after eleven picks keeps all eleven, and no more", () => {
  const s = atStepUnmet("bench");            /* 10 clubs, mid-build */
  const after = tutReduce(s, { type: "SKIP" });
  eq(after.squad.length, s.squad.length, "the partial squad was padded");
  ok(after.squad.every((id, i) => id === s.squad[i]), "the order of his own picks changed");
});

test("the skip control is present in the markup of every step", () => {
  forEachStep((html, s) => {
    ok(html.includes('data-tut-act="SKIP"'), "no skip control on " + s.step);
  });
});

/* ===========================================================================
   3. THE PITCH STARTS EMPTY — the owner's instruction, asserted directly
   =========================================================================== */
group("3. the empty pitch");

test("tutInit builds nothing: no squad, no captain, in either language", () => {
  for (const lang of ["ar", "en"]) {
    const s = tutInit(baseOpts(lang));
    eq(s.squad.length, 0, "tutInit produced a squad");
    eq(s.captain, null, "tutInit produced a captain");
    eq(s.step, "welcome");
    eq(s.filter, "all");
    eq(s.chipsSeen.length, 0);
  }
});

test("the first picking screen shows eleven EMPTY slots and not one club on the board", () => {
  const html = tutHtml(atStepUnmet("first"));
  eq((html.match(/class="tut-slot tut-slot--e/g) || []).length, 11,
     "the empty board is not eleven empty slots");
  eq((html.match(/tut-slot tut-slot--on/g) || []).length, 0, "a club is already on the pitch");
});

test("an empty slot is never a tap target", () => {
  /* a board full of tappable holes that do nothing is how a beginner concludes
     the app is broken */
  forEachStep((html, s) => {
    for (const tag of buttons(html))
      ok(tag.indexOf("tut-slot--e") < 0, "an empty slot is a button on " + s.step + ": " + tag);
  });
});

test("at most one slot is marked as the next one to fill, and it is not interactive", () => {
  forEachStep((html, s) => {
    const n = (html.match(/tut-slot--next/g) || []).length;
    ok(n <= 1, n + " slots marked --next on " + s.step + " — exactly one highlighted target, ever");
    for (const tag of buttons(html))
      ok(tag.indexOf("tut-slot--next") < 0, "the next-slot marker is on a button on " + s.step);
  });
});

test("REPLAYING the lesson keeps the team he already has", () => {
  /* index.html has carried the rule since long before v2: "replaying the lesson
     must not cost you your team". v2 commits whatever the tutorial holds, so a
     replay that started empty would delete fifteen clubs for the crime of wanting
     to read the walkthrough again. Handed his squad, every gate is already
     satisfied and he can tap straight out with the team intact. */
  const mine = WALK.ar.s.squad, cap = WALK.ar.s.captain;
  const s = tutInit(Object.assign({}, baseOpts("ar"), { squad: mine.slice(), captain: cap }));
  eq(s.squad.join(","), mine.join(","), "the replay lost his order");
  eq(s.captain, cap, "the replay lost his armband");
  eq(s.step, "welcome");
  const w = walk(Object.assign({}, baseOpts("ar"), { squad: mine.slice(), captain: cap }));
  eq(w.s.squad.join(","), mine.join(","), "walking a replay changed his squad");
  eq(w.s.captain, cap, "walking a replay changed his captain");
  ok(w.taps <= 10, "a replay should be a read-through, not a rebuild: " + w.taps + " taps");
});

test("a handed-over squad is cleaned, never trusted — it comes from localStorage", () => {
  const good = WALK.ar.s.squad.slice(0, 4);
  const s = tutInit(Object.assign({}, baseOpts("ar"), {
    squad: good.concat(["ghost", good[0], "also-not-real"]), captain: "ghost" }));
  eq(s.squad.join(","), good.join(","), "phantom or duplicate ids survived");
  eq(s.captain, null, "a captain who is not in the squad survived");
  const over = tutInit(Object.assign({}, baseOpts("ar"), { squad: CLUBS.map(c => c.id) }));
  eq(over.squad.length, 15, "an over-long squad was not clamped to the size");
  const benched = tutInit(Object.assign({}, baseOpts("ar"),
    { squad: WALK.ar.s.squad.slice(), captain: WALK.ar.s.squad[13] }));
  eq(benched.captain, null, "a substitute arrived wearing the armband");
});

test("a long Arabic name takes the CARD form on the board and the full form in the list", () => {
  /* a board slot is at most 82px wide and twelve Arabic names do not fit at any
     legible size — «باريس سان جيرمان» needs 81px of 66. Measured live in the
     tutorial before this existed: PSG ellipsed on the board. The app already owns
     the rule (clubNameShort / arShort) and the tutorial must not fork it. */
  const long = CLUBS.filter(c => c.arShort && c.arShort !== c.ar);
  ok(long.length >= 10, "clubs.json lost its arShort forms: only " + long.length);
  const c = long[0];
  const s = withClubs([c.id]);
  const html = tutHtml(s);
  ok(html.includes('<span class="tut-nm">' + c.arShort + "</span>"), "the board does not use the card form for " + c.ar);
  ok(!html.includes('<span class="tut-nm">' + c.ar + "</span>"), "the full name is on the board and will ellipse: " + c.ar);
  ok(html.includes('<span class="tut-rn">' + c.ar + "</span>"), "the list dropped the full name for " + c.ar);
});

test("no counter ever reads zero — the finished state gets its own sentence", () => {
  /* «باقي 0» is not a count, it is a bug with a number in it. Both counters can
     reach zero: the eleven when he comes BACK to it, the bench at fifteen. */
  const full = tutReduce(WALK.ar.gallery.captain.s, { type: "BACK" });   /* -> bench, 15 clubs */
  const html = tutHtml(full);
  ok(!/باقي 0/.test(html), "the bench counter says باقي 0");
  ok(html.includes(tutT("tutBnFull", "ar")), "the completed bench has no sentence of its own");
  const en = tutHtml(tutReduce(full, { type: "LANG", arg: "en" }));
  ok(!/\b0 more\b|\b0 to go\b/.test(en), "the English counter reads zero");
  forEachStep(h => ok(!/باقي 0|\b0 to go\b|\b0 more for\b/.test(h), "a zero counter reached the screen"));
});

test("the squad builder is GONE and must not come back", () => {
  /* v1 exported tutBuildSquad() and tutFavouritePool(). Both invented a team for
     the player, which is the thing the owner asked twice to have removed. This
     assertion is the only thing stopping a future edit from restoring them "as a
     fallback" and quietly reinstating the throwaway squad. */
  eq(typeof TUT.tutBuildSquad, "undefined", "tutBuildSquad is back");
  eq(typeof TUT.tutFavouritePool, "undefined", "tutFavouritePool is back");
  for (const k of Object.keys(TUT))
    ok(!/build|auto|generate|random|seed/i.test(k), "a generator-shaped export reappeared: " + k);
  eq(typeof TUT.TUT.tutBuildSquad, "undefined", "tutBuildSquad is back on the namespace");
});

/* ===========================================================================
   4. THE REFEREE — 120.0M, 15 clubs, max 3 per league, 4.5M floor
   The generator is gone, so these test the rules as the PLAYER meets them.
   =========================================================================== */
group("4. the referee");

test("a fresh state reports the real money: 120.0M, 15 slots", () => {
  const b = tutBudget(tutInit(baseOpts("ar")));
  eq(b.spend, 0);
  eq(b.remaining, 120.0);
  eq(b.slotsLeft, 15);
  /* the cheapest legal fourteen is what the fifteenth slot may not spend */
  ok(b.maxNext > 0 && b.maxNext < 120.0, "maxNext is not a real number: " + b.maxNext);
  console.log("         opening position: 120.0M, 15 slots, dearest first club " + b.maxNext + "M");
});

const dearestOf = lg => CLUBS.filter(c => c.lg === lg).sort((a, b) => priceOf(b.id) - priceOf(a.id));

test("the fourth club from one league is refused, and says why", () => {
  const four = dearestOf("epl").slice(0, 4);
  const s = withClubs(four.slice(0, 3).map(c => c.id));
  eq(s.squad.length, 3, "three from one league should be legal");
  eq(tutBlockReason(s, four[3]), "tutWhyLeague", "a fourth club from a league was not refused");
  const after = tutReduce(s, { type: "PICK", arg: four[3].id });
  eq(after.squad.length, 3, "the reducer let a fourth club from one league through");
});

test("three superclubs fit and a fourth never can — measured, not asserted by hand", () => {
  /* the four dearest are BAY 19.5, PSG 19.5, ARS 18.0, BAR 18.0. Three of them
     plus the cheapest legal completion is 112.0M; four is 125.5M against a
     120.0M budget. The pricing is deliberate (fantasy-pricing.md) and this is the
     assertion that proves the guard actually expresses it. */
  const top = CLUBS.slice().sort((a, b) => priceOf(b.id) - priceOf(a.id)).slice(0, 4);
  let s = withClubs([]);
  for (const c of top.slice(0, 3)) {
    eq(tutBlockReason(s, c), null, "superclub " + c.code + " was refused and should not be");
    s = tutReduce(s, { type: "PICK", arg: c.id });
    if (s.step === "budget") s = tutReduce(s, { type: "NEXT" });
  }
  eq(s.squad.length, 3, "three superclubs did not fit");
  eq(tutBlockReason(s, top[3]), "tutWhyMoney", "a fourth superclub was allowed");
  /* and the squad is still finishable — refusing the fourth is not a dead end */
  let guard = 0;
  while (s.squad.length < 15 && guard++ < 30) { const c = dearestLegal(s); ok(c, "stranded at " + s.squad.length); s = tutReduce(s, { type: "PICK", arg: c.id }); }
  ok(tutIsLegal(s.squad, CTX).ok, "the three-superclub squad could not be legally finished");
});

test("a full squad refuses a sixteenth club", () => {
  const s = WALK.ar.gallery.captain.s;
  eq(s.squad.length, 15);
  const spare = CLUBS.find(c => s.squad.indexOf(c.id) < 0);
  eq(tutBlockReason(s, spare), "tutWhyFull");
  eq(tutReduce(s, { type: "PICK", arg: spare.id }).squad.length, 15, "a sixteenth club got in");
});

test("a duplicate, a phantom and a blocked PICK are all inert", () => {
  const s = atStepUnmet("eleven");
  eq(tutReduce(s, { type: "PICK", arg: s.squad[0] }).squad.length, s.squad.length, "a duplicate got in");
  eq(tutReduce(s, { type: "PICK", arg: "not-a-club" }).squad.length, s.squad.length, "a phantom got in");
  eq(tutReduce(s, { type: "PICK" }).squad.length, s.squad.length, "an argument-less PICK did something");
});

test("the guided walk ends with a LEGAL squad for every one of the 126 first clubs", () => {
  /* the v1 suite made this claim 126 times about a squad the module invented.
     It now makes it 126 times about a squad the PLAYER builds, one club at a
     time, through the same guard the picker uses — which is the only version of
     the claim that matters, because it is the only one a user can experience.
     It also asserts the walk is never STRANDED: at every one of the fifteen
     picks there is at least one club the rules still allow. */
  let checked = 0, minSpend = Infinity, maxSpend = -Infinity, worst = null;
  for (const first of CLUBS) {
    let s = tutReduce(tutInit(baseOpts("ar")), { type: "NEXT" });   /* -> the empty picker */
    s = tutReduce(s, { type: "PICK", arg: first.id });
    eq(s.squad[0], first.id, "the first pick did not land for " + first.id);
    eq(s.step, "budget", "the first pick did not move the player on, for " + first.id);
    s = tutReduce(s, { type: "NEXT" });                              /* -> eleven */
    let guard = 0;
    while (s.squad.length < 15 && guard++ < 40) {
      const c = dearestLegal(s);
      ok(c, "STRANDED at " + s.squad.length + " clubs with " + first.code + " as the first pick");
      s = tutReduce(s, { type: "PICK", arg: c.id });
    }
    const legal = tutIsLegal(s.squad, CTX);
    ok(legal.ok, "illegal squad from first pick " + first.code + ": " + legal.errors.join("; "));
    eq(s.squad.length, 15, "size for " + first.code);
    eq(new Set(s.squad).size, 15, "duplicates for " + first.code);
    ok(s.squad.includes(first.id), first.code + " fell out of the squad it started");
    if (legal.spend < minSpend) { minSpend = legal.spend; worst = first.code; }
    maxSpend = Math.max(maxSpend, legal.spend);
    checked++;
  }
  eq(checked, 126, "clubs checked");
  /* a walk that spends 70M of 120M is legal and useless. Following the
     highlighted club must use the money it is given — measured, every one of the
     126 walks lands on exactly 120.0M, and the floor here is set well under that
     so a price re-run does not fail the suite for a rounding error. */
  ok(minSpend >= 110.0, "worst-case spend " + minSpend + "M (" + worst + ") is too far under 120M");
  console.log("         guided-walk spend across all 126 first clubs: " + minSpend + "M .. " + maxSpend + "M");
});

test("dropping a club refunds the money and reopens the slot", () => {
  let s = atStepUnmet("eleven");
  const b0 = tutBudget(s);
  const c = dearestLegal(s);
  s = tutReduce(s, { type: "PICK", arg: c.id });
  const b1 = tutBudget(s);
  eq(b1.remaining, +(b0.remaining - priceOf(c.id)).toFixed(1), "the price was not charged");
  eq(b1.slotsLeft, b0.slotsLeft - 1);
  s = tutReduce(s, { type: "DROP", arg: c.id });
  eq(tutBudget(s).remaining, b0.remaining, "the refund did not land");
  eq(tutBudget(s).slotsLeft, b0.slotsLeft, "the slot did not reopen");
  eq(tutReduce(s, { type: "DROP", arg: "not-owned" }).squad.length, s.squad.length, "dropping a club he does not own did something");
});

/* ===========================================================================
   5. NO PHYSICAL DIRECTIONS, AND NOTHING UNTAPPABLE
   =========================================================================== */
group("5. RTL discipline and the hit region");

test("no left: / right: anywhere in the emitted markup", () => {
  forEachStep((html, s) => {
    ok(!/left\s*:/i.test(html),  "found `left:` on step " + s.step);
    ok(!/right\s*:/i.test(html), "found `right:` on step " + s.step);
  });
});

test("no physical-direction utility classes, float, or gradient angle in the markup", () => {
  forEachStep((html, s) => {
    ok(!/\bfloat\s*:/i.test(html), "found float on " + s.step);
    ok(!/margin-left|margin-right|padding-left|padding-right|border-left|border-right/i.test(html),
       "found a physical box property on " + s.step);
    ok(!/\d+deg/.test(html), "found a physical gradient angle on " + s.step);
    ok(!/linear-gradient/i.test(html), "found a gradient in the markup on " + s.step);
  });
});

test("the stylesheet itself contains no left:/right: and no directional gradient", () => {
  const css = readFileSync(join(HERE, "tutorial.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");           /* strip comments — prose may say "left" */
  ok(!/(^|[;{\s])left\s*:/i.test(css),  "tutorial.css declares left:");
  ok(!/(^|[;{\s])right\s*:/i.test(css), "tutorial.css declares right:");
  ok(!/linear-gradient\s*\(\s*-?\d/i.test(css), "tutorial.css uses a physical gradient angle");
  ok(/inset-inline|margin-inline|padding-inline|border-inline/i.test(css), "tutorial.css uses no logical properties at all");
});

test("the stylesheet declares NO 3D transform and no perspective context", () => {
  /* NEVER AGAIN. translateZ/rotateX inside a perspective context removed the hit
     region of every card in the affected rows — elementFromPoint returned nothing
     on 9 of 11 — and it shipped, because the checks measured geometry and
     contrast, neither of which notices that a control has stopped existing. */
  const css = readFileSync(join(HERE, "tutorial.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const bad of ["translateZ", "translate3d", "rotateX", "rotateY", "rotate3d", "matrix3d", "perspective", "preserve-3d"])
    ok(css.indexOf(bad) < 0, "tutorial.css uses " + bad + " — that removes the hit region of everything inside it");
});

test("every animation and transition is inside the reduced-motion guard", () => {
  /* MOTION IS OPT-IN, not merely reduced. A user who asked their phone for
     stillness gets a completely static tutorial. */
  const css = readFileSync(join(HERE, "tutorial.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const guard = css.indexOf("prefers-reduced-motion: no-preference");
  ok(guard > 0, "there is no no-preference guard at all");
  const before = css.slice(0, guard);
  for (const bad of ["transition:", "animation:", "transform:", "@keyframes"])
    ok(before.indexOf(bad) < 0, "`" + bad + "` is declared outside the reduced-motion guard");
});

test("the primary button is pinned, so it can never fall below the fold", () => {
  /* v2's picking steps are a 126-row list; the CTA sits under it. The shipped
     wizard already buried its own button 343px and 498px below the fold on far
     shorter steps. This assertion is what stops that regressing. */
  const css = readFileSync(join(HERE, "tutorial.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const at = css.indexOf(".tut-cta{");
  ok(at > 0, ".tut-cta has no rule at all");
  const block = css.slice(at, at + 400);
  ok(/position\s*:\s*sticky/.test(block), ".tut-cta is not pinned");
  ok(/inset-block-end/.test(block), ".tut-cta pins with a physical inset");
});

test("every numeric run on a picking step is dir=ltr wrapped", () => {
  forEachStep((html, s) => {
    if (s.step === "first" || s.step === "eleven" || s.step === "bench") {
      ok(/class="tut-rp" dir="ltr"/.test(html), "unwrapped list price on " + s.step);
      ok(/class="tut-bud__big" dir="ltr"/.test(html), "unwrapped remaining-budget figure on " + s.step);
    }
    if (s.squad.length && /tut-slot--on/.test(html))
      ok(/class="tut-pr" dir="ltr"/.test(html), "unwrapped board price on " + s.step);
  });
});

/* ===========================================================================
   6. STRINGS
   =========================================================================== */
group("6. strings");

test("every TUT_STR entry is a non-empty [ar, en] pair", () => {
  const keys = Object.keys(TUT_STR);
  ok(keys.length > 50, "suspiciously few strings: " + keys.length);
  for (const k of keys) {
    const v = TUT_STR[k];
    ok(Array.isArray(v), k + " is not an array");
    eq(v.length, 2, k + " is not a pair");
    ok(typeof v[0] === "string" && v[0].trim().length > 0, k + " has no Arabic");
    ok(typeof v[1] === "string" && v[1].trim().length > 0, k + " has no English");
  }
  console.log("         " + keys.length + " keys, both languages");
});

test("the two languages are actually different strings", () => {
  for (const k of Object.keys(TUT_STR)) {
    const v = TUT_STR[k];
    ok(v[0] !== v[1], k + " has an identical ar and en value — a missing translation");
  }
});

test("no string contains markup — emphasis is a separate element", () => {
  for (const k of Object.keys(TUT_STR)) {
    const v = TUT_STR[k];
    ok(!v[0].includes("<") && !v[1].includes("<"), k + " contains markup");
  }
});

test("Western digits only — no Arabic-Indic numerals anywhere", () => {
  /* the study found two numeral systems on the first screen: the header reads
     "١١ + ٤ بدلاء · ١٢٠ مليون" while the budget bar directly beneath it reads
     "120.0 / 120.0M". The tutorial contributes to neither half of that. */
  for (const k of Object.keys(TUT_STR))
    for (const v of TUT_STR[k])
      ok(!/[٠-٩۰-۹]/.test(v), k + " uses Arabic-Indic digits: " + v);
  forEachStep((html, s) => {
    ok(!/[٠-٩۰-۹]/.test(html), "Arabic-Indic digits rendered on " + s.step);
  });
});

test("the placeholders in ar and en match, key by key", () => {
  const ph = t => (t.match(/\{[a-zA-Z]+\}/g) || []).sort().join(",");
  for (const k of Object.keys(TUT_STR))
    eq(ph(TUT_STR[k][0]), ph(TUT_STR[k][1]), k + " placeholder mismatch");
});

test("the strings the usability audit condemned are not reintroduced", () => {
  const banned = [
    ["تخطى",        "past-tense third-person; reads as a grammatical error (§F.1)"],
    ["اجعله",       "classical MSA imperative; the app's own coach tip uses خليه (§F.1)"],
    ["لا يلعب",     "MSA machine status flag; مالوش ماتش is the app's own correct phrase (§F.1)"],
    ["بدون تغطية",  "insurance calque (§F.1)"],
    ["جهزنا لك",    "stilted; natural Egyptian contracts the pronoun (§F.1)"],
    ["جهزنالك",     "v1's own headline. v2 does not build him a team, so it must not say it did"],
    ["بداية صحيحة", "the developer's concept, not the user's (§F.1)"],
    ["المؤشر",      "technical MSA for cursor (§F.1)"],
    ["100 مليون",   "the pre-migration 100M fossil; the budget is 120M (§F.2)"],
    ["هذه نسخة",    "MSA contamination; the app says دي elsewhere (§F.1)"]
  ];
  for (const k of Object.keys(TUT_STR))
    for (const [bad, why] of banned)
      ok(!TUT_STR[k][0].includes(bad), k + ' contains "' + bad + '" — ' + why);
});

test("no rendered step claims a score, because the season has not started", () => {
  /* the season is 36 rounds from 21 Aug 2026, and on the day this ships nobody
     has a single point. A tutorial that shows "24 نقطة" as a fact is a lie the
     points screen will contradict thirty seconds later. */
  const banned = /نقطة الجولة|إجمالي النقاط|Total points|your points so far/i;
  forEachStep((html, s) => ok(!banned.test(html), "a score-shaped claim on " + s.step));
});

test("the chip copy is byte-identical to chips.js — the duplicate cannot drift", () => {
  /* the tutorial carries its own copy of the four chip names because chips.js is
     a separate bundle entry and the tutorial is the FIRST thing a user sees. A
     copy with no equality check is a copy that will diverge. */
  const map = [
    ["tutChipWc", "fxChipWildcard"], ["tutChipWcEff", "fxChipWildcardEff"], ["tutChipWcWhen", "fxChipWildcardWhen"],
    ["tutChipFh", "fxChipFreehit"],  ["tutChipFhEff", "fxChipFreehitEff"],  ["tutChipFhWhen", "fxChipFreehitWhen"],
    ["tutChipTc", "fxChipTripcap"],  ["tutChipTcEff", "fxChipTripcapEff"],  ["tutChipTcWhen", "fxChipTripcapWhen"],
    ["tutChipFs", "fxChipFullsquad"],["tutChipFsEff", "fxChipFullsquadEff"],["tutChipFsWhen", "fxChipFullsquadWhen"]
  ];
  for (const [mine, theirs] of map) {
    ok(CHIPS.CHIP_STR[theirs], "chips.js no longer has " + theirs);
    eq(TUT_STR[mine][0], CHIPS.CHIP_STR[theirs][0], mine + " has drifted from " + theirs + " (ar)");
    eq(TUT_STR[mine][1], CHIPS.CHIP_STR[theirs][1], mine + " has drifted from " + theirs + " (en)");
  }
  eq(TUT_STR.tutGwLine[0], GW.GW_STR.fxWizGw[0], "tutGwLine has drifted from gameweek.js fxWizGw (ar)");
  eq(TUT_STR.tutGwLine[1], GW.GW_STR.fxWizGw[1], "tutGwLine has drifted from gameweek.js fxWizGw (en)");
});

test("TUT_STR collides with nothing in CHIP_STR or GW_STR", () => {
  /* they are all merged into one STR bag by the host, so a shared key means one
     module silently overwrites the other's copy. */
  for (const k of Object.keys(TUT_STR)) {
    ok(!(k in CHIPS.CHIP_STR), k + " collides with CHIP_STR");
    ok(!(k in GW.GW_STR), k + " collides with GW_STR");
    ok(/^tut/.test(k), k + " is not tut-prefixed, so a collision is only a matter of time");
  }
});

test("tutT falls back to the key rather than throwing or printing undefined", () => {
  eq(tutT("noSuchKey", "ar"), "noSuchKey");
  eq(tutT("tutSkip", "en"), "Skip");
  eq(tutT("tutSkip", "ar"), "بعدين");
  eq(tutT("tutSkip"), "بعدين", "no lang defaults to Arabic — the product is Arabic-first");
});

/* ===========================================================================
   7. THE CHIPS — the owner's explicit ask, taught nowhere in v1
   =========================================================================== */
group("7. the chips");

test("there are exactly four families, and no fifth", () => {
  eq(TUT_CHIPS.length, 4, "the catalogue is not four families");
  eq(TUT_CHIPS.map(c => c.id).join(","), "wildcard,freehit,tripcap,fullsquad");
  /* four families x two halves = the eight chips the copy claims */
  ok(TUT_STR.tutChBody[0].includes("8"), "the chips step does not state the number 8");
  ok(TUT_STR.tutChBody[1].includes("Eight"), "the English chips step does not state eight");
  eq(TUT_CHIPS.map(c => c.id).join(","), CHIPS.CHIP_FAMILIES.join(","),
     "the tutorial's chip catalogue no longer matches chips.js");
});

test("the chips step names all four and shows each one's effect once opened", () => {
  let s = atStepUnmet("chips");
  for (const lang of ["ar", "en"]) {
    let t = tutReduce(s, { type: "LANG", arg: lang });
    const closed = tutHtml(t);
    for (const k of TUT_CHIPS) ok(closed.includes(tutT(k.name, lang)), k.id + " is not named on the chips step (" + lang + ")");
    for (const k of TUT_CHIPS) {
      ok(!closed.includes(tutT(k.when, lang)), k.id + "'s when-to-use is shown before it is opened");
      const open = tutHtml(tutReduce(t, { type: "CHIP", arg: k.id }));
      ok(open.includes(tutFill(k.eff, lang)), k.id + " does not show its effect when opened (" + lang + ")");
      ok(open.includes(tutFill(k.when, lang)), k.id + " does not show WHEN to use it when opened (" + lang + ")");
      ok(/aria-expanded="true"/.test(open), k.id + " does not report itself expanded");
    }
  }
});

test("opening a chip is remembered; closing it again does not un-teach it", () => {
  let s = atStepUnmet("chips");
  s = tutReduce(s, { type: "CHIP", arg: "freehit" });
  eq(s.chipOpen, "freehit");
  eq(s.chipsSeen.join(","), "freehit");
  s = tutReduce(s, { type: "CHIP", arg: "freehit" });         /* tap again = collapse */
  eq(s.chipOpen, null, "the card did not collapse");
  eq(s.chipsSeen.join(","), "freehit", "collapsing forgot that he read it");
  eq(tutGateMet(s), true, "the gate closed again after he collapsed the card");
  s = tutReduce(s, { type: "CHIP", arg: "nope" });
  eq(s.chipsSeen.join(","), "freehit", "a phantom chip id was recorded");
});

test("only one chip card is open at a time", () => {
  let s = atStepUnmet("chips");
  s = tutReduce(s, { type: "CHIP", arg: "wildcard" });
  s = tutReduce(s, { type: "CHIP", arg: "tripcap" });
  eq(s.chipOpen, "tripcap");
  eq((tutHtml(s).match(/aria-expanded="true"/g) || []).length, 1, "two chip cards are open at once");
  eq(s.chipsSeen.length, 2, "the second card was not recorded");
});

/* ===========================================================================
   8. THE CAPTAIN
   =========================================================================== */
group("8. the captain");

test("the armband can only go to one of the eleven", () => {
  const s = WALK.ar.gallery.captain.s;
  eq(s.squad.length, 15);
  const bench = s.squad[12];
  eq(tutReduce(s, { type: "CAP", arg: bench }).captain, null, "a substitute took the armband");
  const starter = s.squad[4];
  eq(tutReduce(s, { type: "CAP", arg: starter }).captain, starter);
  eq(tutReduce(s, { type: "CAP", arg: "not-a-club" }).captain, null, "a club he does not own took the armband");
});

test("the captain screen offers the eleven and NOT the four substitutes", () => {
  const g = WALK.ar.gallery.captain;
  eq((g.html.match(/data-tut-act="CAP"/g) || []).length, 11, "the captain grid is not exactly eleven cards");
  for (const id of g.s.squad.slice(11))
    ok(!g.html.includes('data-tut-arg="' + id + '"'), "a substitute is on the captain grid: " + id);
});

test("dropping the captain out of the eleven removes the armband rather than hiding it", () => {
  /* the shipped build kept drawing the C on a benched club, which pays exactly
     nothing: measured 302 points against 348 for the best legal captain. */
  let s = WALK.ar.gallery.captain.s;
  s = tutReduce(s, { type: "CAP", arg: s.squad[2] });
  eq(s.captain, s.squad[2]);
  s = tutReduce(s, { type: "BACK" });                    /* -> bench, where DROP lives */
  s = tutReduce(s, { type: "DROP", arg: s.squad[2] });
  eq(s.captain, null, "the armband survived its club leaving the eleven");
});

test("the armband is drawn on the board as well as claimed in the sentence", () => {
  let s = WALK.ar.gallery.captain.s;
  s = tutReduce(s, { type: "CAP", arg: s.squad[0] });
  const html = tutHtml(s);
  ok(/aria-pressed="true"/.test(html), "the chosen card does not report itself pressed");
  ok(html.includes("tut-ok"), "the choice is not confirmed in the live region");
  const back = tutHtml(tutReduce(s, { type: "BACK" }));
  ok(/tut-slot tut-slot--on cap/.test(back), "the armband is not drawn on the board");
});

/* ===========================================================================
   9. PURITY AND THE HOST CONTRACT
   =========================================================================== */
group("9. purity and contract");

test("tutReduce never mutates the state it is given", () => {
  const s = atStepUnmet("eleven");
  const snapshot = JSON.stringify({ step: s.step, squad: s.squad, cap: s.captain, seen: s.chipsSeen, f: s.filter });
  tutReduce(s, { type: "PICK", arg: dearestLegal(s).id });
  tutReduce(s, { type: "DROP", arg: s.squad[0] });
  tutReduce(s, { type: "SKIP" });
  tutReduce(s, { type: "FILTER", arg: "liga" });
  tutReduce(s, { type: "CHIP", arg: "wildcard" });
  eq(JSON.stringify({ step: s.step, squad: s.squad, cap: s.captain, seen: s.chipsSeen, f: s.filter }), snapshot,
     "the original state was mutated");
});

test("tutHtml is pure — the same state renders identically twice", () => {
  for (const g of GALLERY) eq(tutHtml(g.s), g.html, "render is not deterministic on " + g.s.step);
});

test("an unknown action returns the state unchanged", () => {
  const s = tutInit(baseOpts("ar"));
  eq(tutReduce(s, { type: "WAT" }), s);
  eq(tutReduce(s, {}), s);
  eq(tutReduce(s, null), s);
});

test("an action a step does not offer is inert, exactly as if it were unknown", () => {
  /* a reducer that accepts every action from every step is a state machine that
     is only a suggestion: PICK on the captain screen would buy a sixteenth club
     no screen had shown, and CAP on the bench screen would appoint an armband
     before the captain lesson happened. Neither is reachable by a user, which is
     precisely why nobody would notice it shipping. */
  const cases = [
    ["welcome", { type: "PICK", arg: "364" }],
    ["budget",  { type: "PICK", arg: "364" }],
    ["captain", { type: "PICK", arg: "349" }],
    ["chips",   { type: "PICK", arg: "349" }],
    ["done",    { type: "PICK", arg: "349" }],
    ["eleven",  { type: "CAP",  arg: null }],
    ["bench",   { type: "CHIP", arg: "wildcard" }],
    ["welcome", { type: "FILTER", arg: "liga" }],
    ["captain", { type: "DROP", arg: null }]
  ];
  for (const [id, act] of cases) {
    const s = atStepUnmet(id);
    const a = Object.assign({}, act, { arg: act.arg == null ? s.squad[0] : act.arg });
    const after = tutReduce(s, a);
    eq(after, s, a.type + " was accepted on the " + id + " step");
  }
});

test("LANG flips the render without disturbing the squad", () => {
  const s = atStepUnmet("eleven");
  const squad = s.squad.join(",");
  const ar = tutHtml(s);
  const en = tutReduce(s, { type: "LANG", arg: "en" });
  eq(en.squad.join(","), squad, "the language toggle rebuilt the squad");
  ok(tutHtml(en) !== ar, "the language toggle changed nothing on screen");
  ok(tutHtml(en).includes("Fill your eleven"), "English did not render");
  ok(tutHtml(en).includes("Premier League"), "the league names did not follow the language");
});

test("every interactive element carries data-tut-act and there are no inline handlers", () => {
  forEachStep((html, s) => {
    const btns = buttons(html);
    ok(btns.length > 0, "no buttons on " + s.step);
    for (const b of btns) {
      ok(/data-tut-act="/.test(b), "a button on " + s.step + " has no data-tut-act: " + b);
      ok(!/\son[a-z]+=/i.test(b), "an inline handler survived on " + s.step + ": " + b);
    }
  });
});

test("every step offers exactly one focus target, and it is never disabled", () => {
  /* THE DEAD LOOP THIS EXISTS FOR: two glowing cards while the sentence named one
     of them, inside mandatory onboarding, with no exit but Skip. Reproducible
     every run in v1. One target, always, and it always does something. */
  forEachStep((html, s) => {
    eq((html.match(/data-tut-focus/g) || []).length, 1, "focus target count on " + s.step);
    const tag = focusTag(html);
    ok(!/\sdisabled/.test(tag), "the focus target on " + s.step + " is disabled: " + tag);
    ok(/data-tut-act="/.test(tag), "the focus target on " + s.step + " does nothing");
  });
});

test("the focus target on a picking step is a club that can actually be bought", () => {
  let s = atStepUnmet("eleven");
  for (let i = 0; i < 8; i++) {
    const a = focusAction(tutHtml(s), s.step);
    eq(a.type, "PICK", "the focus target on a picking step is not a pick");
    const club = CLUBS.find(c => c.id === a.arg);
    ok(club, "the focus target names a club that does not exist: " + a.arg);
    eq(tutBlockReason(s, club), null, "the focus target is a club the rules forbid: " + club.code);
    const before = s.squad.length;
    s = tutReduce(s, a);
    eq(s.squad.length, before + 1, "clicking the focus target did not add a club");
  }
});

test("a blocked row still carries its action and still says why", () => {
  /* it keeps data-tut-act on purpose: the reducer is the guard, so the rule does
     not depend on an attribute being absent from the markup. */
  const four = dearestOf("epl").slice(0, 4);
  const s = withClubs(four.slice(0, 3).map(c => c.id));
  const html = tutHtml(s);
  const row = buttons(html).find(b => b.includes('data-tut-arg="' + four[3].id + '"'));
  ok(row, "the blocked club is not in the list at all");
  ok(/\sdisabled/.test(row), "the blocked club is still tappable");
  ok(/data-tut-act="PICK"/.test(row), "the blocked row dropped its action");
  ok(html.includes(tutT("tutWhyLeague", "ar")), "the reason is not printed on the row");
});

test("the aria contract holds — progressbar, live region, pressed states", () => {
  forEachStep((html, s) => {
    ok(html.includes('role="progressbar"'), "no progressbar on " + s.step);
    ok(html.includes("aria-valuenow="), "no aria-valuenow on " + s.step);
    if (s.step === "first" || s.step === "eleven" || s.step === "bench" || s.step === "captain")
      ok(html.includes('aria-live="polite"'), "no live region on " + s.step);
    if (s.step === "chips") ok(html.includes("aria-expanded="), "no expanded state on the chips step");
  });
});

test("the money and the slots are on screen on every step where he is spending", () => {
  forEachStep((html, s) => {
    if (s.step === "first" || s.step === "eleven" || s.step === "bench" || s.step === "budget") {
      ok(html.includes("tut-bud__big"), "no remaining-budget figure on " + s.step);
      ok(html.includes(tutT("tutBudSlots", s.lang)), "no slots-left figure on " + s.step);
      ok(html.includes(tutT("tutBudNext", s.lang)), "no max-for-your-next-club figure on " + s.step);
    }
  });
});

test("no unreplaced {placeholder} survives into any rendered step", () => {
  forEachStep((html, s) => {
    const m = html.match(/\{[a-zA-Z]+\}/);
    ok(!m, "unreplaced placeholder " + (m && m[0]) + " on step " + s.step);
  });
});

test("no unreplaced {placeholder} on the no-gameweek-data path either", () => {
  for (const lang of ["ar", "en"]) {
    const w = walk(Object.assign({}, CTX, { lang, gw: null }));
    for (const id of TUT_STEPS) {
      const g = w.gallery[id];
      ok(g, "step " + id + " unreachable with gw:null (" + lang + ")");
      ok(!/\{[a-zA-Z]+\}/.test(g.html), "placeholder leaked with gw:null on " + id + " / " + lang);
    }
  }
});

/* ===========================================================================
   10. ESCAPING — a hostile club name is text, never markup
   =========================================================================== */
group("10. escaping");

const EVIL = {
  id: "evil", lg: "epl", code: "<b>X</b>",
  ar: '<img src=x onerror="alert(1)">', name: '<img src=x onerror="alert(1)">', short: "evil",
  fame: 9, c1: '"><script>a()</script>', c2: "#000", ink: "#fff",
  pat: '"onmouseover="b()', rim: "standard"
};

test("a hostile club name renders as text on every step, and can still be picked", () => {
  const clubs = [EVIL].concat(CLUBS);
  const price = id => (id === "evil" ? 6.0 : priceOf(id));
  const w = walk(Object.assign({}, CTX, { clubs, price, lang: "ar", gw: GWOPT }), "evil");
  ok(w.s.squad.includes("evil"), "the hostile club could not be picked at all");
  for (const id of TUT_STEPS) {
    const html = w.gallery[id].html;
    /* the substring "onerror=" legitimately survives INSIDE an escaped value —
       that is what escaping looks like. What must not survive is a real TAG
       carrying it, or a real tag at all. */
    ok(!html.includes("<img"),    "raw <img survived on " + id);
    ok(!html.includes("<script"), "raw <script survived on " + id);
    for (const tag of html.match(/<[a-zA-Z][^>]*>/g) || []) {
      /* every attribute value must be balanced: a hostile `"` would otherwise
         break out and start a new attribute. */
      eq((tag.match(/"/g) || []).length % 2, 0, "unbalanced quotes in a tag on " + id + ": " + tag);
      /* strip the quoted values, then assert nothing that survives OUTSIDE them
         is an event handler. This is the exact vulnerability, tested exactly. */
      const bare = tag.replace(/"[^"]*"/g, '""');
      ok(!/\son[a-z]+\s*=/i.test(bare), "an executable handler on " + id + ": " + bare);
    }
  }
  /* it must be present AS TEXT in both places it can appear: the picker list
     (before it is bought) and the board (after) */
  ok(w.gallery.first.html.includes("&lt;img"), "the hostile name never reached the list at all");
  ok(w.gallery.eleven.html.includes("&lt;img"), "the hostile name was dropped from the board rather than escaped");
});

test("tutFill escapes the template before substituting, and both directions hold", () => {
  const out = tutFill("tutP1Ok", "ar", { club: "<b>x</b>" });
  ok(!out.includes("<b>"), "value not escaped");
  ok(out.includes("&lt;b&gt;"), "value not present as text");
});

test("data-tut-arg values are attribute-escaped", () => {
  const clubs = [{ id: '" onclick="x()', lg: "epl", code: "AAA", ar: "نادي", name: "Club",
                   fame: 9, c1: "#000", c2: "#000", ink: "#fff", pat: "solid", rim: "standard" }].concat(CLUBS);
  let s = tutInit(Object.assign({}, CTX, { clubs, lang: "ar", gw: GWOPT }));
  s = tutReduce(s, { type: "NEXT" });
  const html = tutHtml(s);
  ok(!/data-tut-arg="" onclick=/.test(html), "attribute break-out in data-tut-arg");
  ok(html.includes("&quot;"), "the quote was not escaped");
});

/* ===========================================================================
   11. THE FILTER — and the dead end it could have created
   =========================================================================== */
group("11. the league filter");

test("the filter strip offers all seven leagues plus All", () => {
  const html = WALK.ar.gallery.eleven.html;
  eq((html.match(/data-tut-act="FILTER"/g) || []).length, LEAGUES.length + 1, "filter chip count");
  ok(html.includes('data-tut-arg="all"'), "no All chip");
  for (const l of LEAGUES) ok(html.includes('data-tut-arg="' + l.id + '"'), "no chip for " + l.id);
});

test("choosing a league actually narrows the list, and All restores it", () => {
  const rows = html => (html.match(/class="tut-row/g) || []).length;
  let s = atStepUnmet("eleven");
  eq(rows(tutHtml(s)), CLUBS.length, "the unfiltered list is not all 126 clubs");
  s = tutReduce(s, { type: "FILTER", arg: "spl" });
  eq(s.filter, "spl");
  eq(rows(tutHtml(s)), CLUBS.filter(c => c.lg === "spl").length, "the filtered list is not that league's clubs");
  ok(/class="tut-fchip on"/.test(tutHtml(s)), "the chosen chip is not marked selected");
  s = tutReduce(s, { type: "FILTER", arg: "all" });
  eq(rows(tutHtml(s)), CLUBS.length, "All did not restore the list");
  eq(tutReduce(s, { type: "FILTER", arg: "nope" }).filter, "all", "an unknown league id was accepted");
});

test("a filter that leaves nothing pickable points at All instead of dead-ending", () => {
  /* the exact shape of the v1 trap, in a place nobody would look: filter to one
     league, fill your three from it, and every row on screen is refused. The way
     forward is not a club — it is the All chip, and the focus target says so. */
  let s = withClubs(dearestOf("tsl").slice(0, 3).map(c => c.id));
  s = tutReduce(s, { type: "FILTER", arg: "tsl" });
  const a = focusAction(tutHtml(s), "eleven/filtered");
  eq(a.type, "FILTER", "the focus target is not the filter");
  eq(a.arg, "all", "the focus target does not point back at All");
  s = tutReduce(s, a);
  eq(s.filter, "all");
  eq(focusAction(tutHtml(s), "eleven/all").type, "PICK", "widening the filter did not restore a pickable club");
});

/* ===========================================================================
   12. THE TAP BUDGET
   =========================================================================== */
group("12. the tap budget");

test("a complete first team, built by the player, in 22 taps", () => {
  /* 1 welcome + 1 first club + 1 budget + 10 to fill the eleven + 4 for the
     bench + 1 armband + 1 continue + 1 chip + 1 continue + 1 to the pitch.
     v1 reached the pitch in 9 taps and the player owned nothing he had chosen;
     22 taps is what choosing fifteen clubs costs, and 15 of them ARE the game. */
  const w = WALK.ar;
  eq(w.taps, 22, "tap count: " + w.trail.join(" > "));
  eq(w.s.squad.length, 15);
  ok(w.s.captain, "no captain");
  ok(w.s.chipsSeen.length >= 1, "the chips were never opened");
  ok(tutIsLegal(w.s.squad, CTX).ok, "the fast path produced an illegal squad");
  console.log("         " + w.trail.join(" > "));
});

test("the player who reads nothing still leaves with a state the app can hold", () => {
  /* he presses the biggest thing; on a gated step there IS no big thing, so his
     only move is the skip in the corner. That must hand over an empty pitch —
     which the app already has a first-class state for ("لسه ما اخترتش فريقك") —
     and never a team he did not choose. */
  let s = tutInit(baseOpts("ar"));
  s = tutReduce(s, { type: "NEXT" });                    /* -> first */
  eq((tutHtml(s).match(/class="tut-cta"/g) || []).length, 0, "there is a big button to press on the first pick step");
  s = tutReduce(s, { type: "SKIP" });
  ok(s.done && s.skipped);
  eq(s.squad.length, 0);
  eq(s.captain, null);
  ok(tutIsLegal(s.squad, CTX).errors.some(e => /size 0/.test(e)),
     "an empty squad should read as incomplete, not as legal");
});

/* ===========================================================================
   RESULT
   =========================================================================== */
console.log("\n" + "=".repeat(64));
console.log("  " + pass + " passed, " + fail + " failed");
if (fail) { console.log("\n" + failures.map(f => "  - " + f).join("\n")); }
console.log("=".repeat(64));
process.exit(fail ? 1 : 0);
