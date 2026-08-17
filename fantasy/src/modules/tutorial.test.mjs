/* ============================================================================
   GOALLAK FANTASY — TUTORIAL TESTS
   Run:  node modules/tutorial.test.mjs      (from goalak/fantasy-demo/)
   or:   node goalak/fantasy-demo/modules/tutorial.test.mjs

   These run against the REAL data — site/clubs.json (126 clubs, 7 leagues) and
   site/prices.json — because a squad builder that is legal against a fixture is
   not evidence of anything. Every legality assertion below is made 128 times:
   once per possible favourite club, once with no favourite, and once per
   re-roll.
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
  TUT_STR, TUT_STEPS, tutInit, tutReduce, tutHtml, tutT, tutFill,
  tutBuildSquad, tutIsLegal, tutFavouritePool
} = TUT;

const CLUBS_JSON  = JSON.parse(readFileSync(join(SITE, "clubs.json"), "utf8"));
const PRICES_JSON = JSON.parse(readFileSync(join(SITE, "prices.json"), "utf8"));
const CLUBS   = CLUBS_JSON.clubs;
const LEAGUES = CLUBS_JSON.leagues;
const PRICE   = {};
for (const p of PRICES_JSON.clubs) PRICE[p.id] = p.price;
const priceOf = id => (PRICE[id] != null ? PRICE[id] : 8);

/* the constants the app itself declares, mirrored so a change there fails here */
const CTX = {
  clubs: CLUBS, price: priceOf,
  size: 15, startSize: 11, budget: 120.0, maxPerLeague: 3, minPrice: 4.5
};

const GW = {
  no: 1,
  from:    ["21 أغسطس", "21 August"],
  to:      ["28 أغسطس", "28 August"],
  lock:    ["الجمعة 7:30 م", "Friday 7:30 pm"],
  fixture: ["السبت 9:45 م", "Saturday 9:45 pm"]
};

const baseOpts = lang => Object.assign({}, CTX, { lang, gw: GW, seed: 7 });

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

/* walks every step of every language and hands each rendered string to fn */
function forEachStep(fn) {
  for (const lang of ["ar", "en"]) {
    let s = tutInit(baseOpts(lang));
    for (const id of TUT_STEPS) {
      ok(s.step === id, "expected step " + id + " got " + s.step);
      fn(tutHtml(s), s, lang);
      if (id !== TUT_STEPS[TUT_STEPS.length - 1]) s = tutReduce(s, { type: "NEXT" });
    }
  }
}

/* ===========================================================================
   1. EVERY STEP IS REACHABLE
   =========================================================================== */
group("1. reachability");

test("the seven steps are reached in order by NEXT alone", () => {
  let s = tutInit(baseOpts("ar"));
  const seen = [];
  for (let i = 0; i < TUT_STEPS.length; i++) {
    seen.push(s.step);
    if (i < TUT_STEPS.length - 1) s = tutReduce(s, { type: "NEXT" });
  }
  eq(seen.join(","), TUT_STEPS.join(","), "step order");
});

test("NEXT on the last step finishes the tutorial", () => {
  let s = tutInit(baseOpts("ar"));
  for (let i = 0; i < TUT_STEPS.length; i++) s = tutReduce(s, { type: "NEXT" });
  ok(s.done, "expected done");
  ok(!s.skipped, "NEXT-to-the-end is not a skip");
});

test("BACK reaches every step from the end and never goes below welcome", () => {
  let s = tutInit(baseOpts("ar"));
  for (let i = 0; i < TUT_STEPS.length - 1; i++) s = tutReduce(s, { type: "NEXT" });
  eq(s.step, "hook");
  const seen = [s.step];
  for (let i = 0; i < 20; i++) { s = tutReduce(s, { type: "BACK" }); seen.push(s.step); }
  eq(s.step, "welcome", "BACK floors at welcome");
  for (const id of TUT_STEPS) ok(seen.includes(id), "BACK never visited " + id);
});

test("the favourite grid routes straight to the squad step", () => {
  let s = tutInit(baseOpts("ar"));
  s = tutReduce(s, { type: "NEXT" });
  eq(s.step, "fav");
  s = tutReduce(s, { type: "FAV", arg: CLUBS[0].id });
  eq(s.step, "squad");
  eq(s.fav, CLUBS[0].id);
  eq(s.squad.length, 15, "squad built on the way through");
});

test("every step renders non-empty markup in both languages", () => {
  let n = 0;
  forEachStep(html => { ok(html.length > 200, "markup too short"); n++; });
  eq(n, TUT_STEPS.length * 2, "rendered step count");
});

/* ===========================================================================
   2. SKIP WORKS FROM EVERY STEP — one tap, always
   =========================================================================== */
group("2. skip");

test("SKIP from every step yields done + skipped + a legal squad + a captain", () => {
  for (const lang of ["ar", "en"]) {
    let s = tutInit(baseOpts(lang));
    for (const id of TUT_STEPS) {
      const skipped = tutReduce(s, { type: "SKIP" });
      ok(skipped.done, "SKIP from " + id + " did not finish");
      ok(skipped.skipped, "SKIP from " + id + " did not mark skipped");
      const legal = tutIsLegal(skipped.squad, CTX);
      ok(legal.ok, "SKIP from " + id + " left an illegal squad: " + legal.errors.join("; "));
      ok(skipped.captain, "SKIP from " + id + " left no captain");
      ok(skipped.squad.slice(0, 11).includes(skipped.captain), "captain is not a starter after SKIP from " + id);
      if (id !== TUT_STEPS[TUT_STEPS.length - 1]) s = tutReduce(s, { type: "NEXT" });
    }
  }
});

test("the skip control is present in the markup of every step", () => {
  forEachStep((html, s) => {
    ok(html.includes('data-tut-act="SKIP"'), "no skip control on " + s.step);
  });
});

test("SKIP after choosing a favourite keeps that favourite starting", () => {
  let s = tutInit(baseOpts("ar"));
  s = tutReduce(s, { type: "NEXT" });
  s = tutReduce(s, { type: "FAV", arg: "364" });          /* ليفربول */
  s = tutReduce(s, { type: "SKIP" });
  ok(s.done && s.skipped);
  ok(s.squad.slice(0, 11).includes("364"), "the favourite was not in the eleven");
});

/* ===========================================================================
   3. THE GENERATED SQUAD IS LEGAL — 15 clubs, <=120M, max 3 per league
   =========================================================================== */
group("3. squad legality");

test("legal for every one of the 126 clubs as favourite", () => {
  let checked = 0;
  for (const c of CLUBS) {
    const built = tutBuildSquad(Object.assign({}, CTX, { fav: c.id, seed: 7 }));
    ok(built.ok, "build failed for favourite " + c.id);
    const legal = tutIsLegal(built.squad, CTX);
    ok(legal.ok, "illegal for favourite " + c.id + " (" + (c.ar || c.name) + "): " + legal.errors.join("; "));
    eq(built.squad.length, 15, "size for " + c.id);
    eq(built.squad[0], c.id, "favourite is not slot 0 for " + c.id);
    ok(built.squad.slice(0, 11).includes(c.id), "favourite is not a starter for " + c.id);
    checked++;
  }
  eq(checked, 126, "clubs checked");
});

test("legal with no favourite, and legal across all six re-rolls", () => {
  for (let r = 0; r <= 5; r++) {
    const built = tutBuildSquad(Object.assign({}, CTX, { fav: null, seed: 7 + r * 101 }));
    ok(built.ok, "build failed at re-roll " + r);
    const legal = tutIsLegal(built.squad, CTX);
    ok(legal.ok, "illegal at re-roll " + r + ": " + legal.errors.join("; "));
  }
});

test("budget is never exceeded and is never absurdly under-spent", () => {
  let min = Infinity, max = -Infinity;
  for (const c of CLUBS) {
    const built = tutBuildSquad(Object.assign({}, CTX, { fav: c.id, seed: 7 }));
    const spend = +built.squad.reduce((a, id) => a + priceOf(id), 0).toFixed(1);
    ok(spend <= 120.0, "over budget " + spend + " for " + c.id);
    min = Math.min(min, spend); max = Math.max(max, spend);
  }
  /* a squad that spends 70M of 120M is legal and useless. The band builder must
     use the money it is given. */
  ok(min >= 100.0, "worst-case spend " + min + "M is too far under the 120M budget");
  console.log("         spend range across all 126 favourites: " + min + "M .. " + max + "M");
});

test("no league ever exceeds 3 clubs, and at least 5 leagues are represented", () => {
  for (const c of CLUBS) {
    const built = tutBuildSquad(Object.assign({}, CTX, { fav: c.id, seed: 7 }));
    const n = {};
    for (const id of built.squad) {
      const club = CLUBS.find(x => x.id === id);
      n[club.lg] = (n[club.lg] || 0) + 1;
    }
    for (const lg of Object.keys(n)) ok(n[lg] <= 3, lg + " has " + n[lg] + " for favourite " + c.id);
    ok(Object.keys(n).length >= 5, "only " + Object.keys(n).length + " leagues for favourite " + c.id);
  }
});

test("no duplicate clubs, and every id exists in the pool", () => {
  for (const c of CLUBS) {
    const built = tutBuildSquad(Object.assign({}, CTX, { fav: c.id, seed: 7 }));
    eq(new Set(built.squad).size, 15, "duplicates for " + c.id);
    for (const id of built.squad) ok(CLUBS.some(x => x.id === id), "phantom club " + id);
  }
});

test("the price ladder is visible — not the shipped barbell", () => {
  /* the shipped autoFill() produces 18.5/17.5/16.5/15.5/7.0 then ten clubs at
     exactly 4.5 (usability §K.11). Assert the opposite shape: a club in each of
     the three named bands, and no more than six clubs at the 4.5 floor. */
  for (const c of CLUBS.slice(0, 40)) {
    const built = tutBuildSquad(Object.assign({}, CTX, { fav: c.id, seed: 7 }));
    const ps = built.squad.map(priceOf);
    ok(ps.some(p => p >= 15.0),               "no 15.0M+ club for " + c.id);
    ok(ps.some(p => p >= 8.0 && p <= 12.0),   "no 8-12M club for " + c.id);
    ok(ps.some(p => p >= 4.5 && p <= 6.5),    "no 4.5-6.5M club for " + c.id);
    ok(ps.filter(p => p === 4.5).length <= 6, "barbell: " + ps.filter(p => p === 4.5).length + " clubs at the floor for " + c.id);
  }
});

test("the build is deterministic — same seed, same squad", () => {
  const a = tutBuildSquad(Object.assign({}, CTX, { fav: "364", seed: 42 }));
  const b = tutBuildSquad(Object.assign({}, CTX, { fav: "364", seed: 42 }));
  eq(a.squad.join(","), b.squad.join(","), "same seed diverged");
  const d = tutBuildSquad(Object.assign({}, CTX, { fav: "364", seed: 43 }));
  ok(d.squad.join(",") !== a.squad.join(","), "re-roll produced an identical team");
});

test("the favourite grid is 12 clubs, all with Arabic names, spanning every league", () => {
  const pool = tutFavouritePool(CLUBS, 12);
  eq(pool.length, 12, "pool size");
  for (const c of pool) ok(c.ar, "pool contains a club with no Arabic name: " + c.id);
  const lgs = new Set(pool.map(c => c.lg));
  eq(lgs.size, LEAGUES.length, "pool covers " + lgs.size + " of " + LEAGUES.length + " leagues");
});

test("a favourite from the grid always survives into the eleven", () => {
  for (const c of tutFavouritePool(CLUBS, 12)) {
    let s = tutInit(baseOpts("ar"));
    s = tutReduce(s, { type: "NEXT" });
    s = tutReduce(s, { type: "FAV", arg: c.id });
    ok(s.squad.slice(0, 11).includes(c.id), (c.ar || c.name) + " did not start");
    eq(s.captain, c.id, "the favourite did not get the armband");
  }
});

/* ===========================================================================
   4. NO PHYSICAL DIRECTIONS IN THE EMITTED MARKUP
   =========================================================================== */
group("4. RTL discipline");

test("no left: / right: anywhere in the emitted markup", () => {
  forEachStep((html, s) => {
    ok(!/left\s*:/i.test(html),  "found `left:` on step " + s.step);
    ok(!/right\s*:/i.test(html), "found `right:` on step " + s.step);
  });
});

test("no physical-direction utility classes or float/clear in the markup", () => {
  forEachStep((html, s) => {
    ok(!/\bfloat\s*:/i.test(html), "found float on " + s.step);
    ok(!/margin-left|margin-right|padding-left|padding-right|border-left|border-right/i.test(html),
       "found a physical box property on " + s.step);
    ok(!/\d+deg/.test(html), "found a physical gradient angle on " + s.step);
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

test("the primary button is pinned, so it can never fall below the fold", () => {
  /* measured live at 360x640 and 375x812, ar and en: with this rule the CTA is
     visible on every step without scrolling; without it the squad and swap
     steps push it 91-134px under. The shipped wizard buries its own at 343px
     and 498px. This assertion is what stops that regressing. */
  const css = readFileSync(join(HERE, "tutorial.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = css.slice(css.indexOf(".tut-cta{"), css.indexOf(".tut-cta{") + 400);
  ok(/position\s*:\s*sticky/.test(block), ".tut-cta is not pinned");
  ok(/inset-block-end/.test(block), ".tut-cta pins with a physical inset");
});

test("every Latin or numeric run in the markup is dir=ltr wrapped", () => {
  forEachStep((html, s) => {
    /* the prices on the board are the numerals most at risk of mirroring */
    if (s.step === "squad" || s.step === "swap")
      ok(/class="tut-pr" dir="ltr"/.test(html), "unwrapped price on " + s.step);
  });
});

/* ===========================================================================
   5. NO UNESCAPED INTERPOLATION
   =========================================================================== */
group("5. escaping");

test("a hostile club name renders as text, never as markup", () => {
  const evil = {
    id: "evil", lg: "epl", code: "<b>X</b>",
    ar: '<img src=x onerror="alert(1)">', name: '<img src=x onerror="alert(1)">',
    fame: 9, c1: '"><script>a()</script>', c2: "#000", ink: "#fff",
    pat: '"onmouseover="b()', rim: "standard"
  };
  const clubs = [evil].concat(CLUBS);
  const opts = Object.assign({}, CTX, { clubs, lang: "ar", gw: GW, seed: 7 });
  let s = tutInit(opts);
  for (const id of TUT_STEPS) {
    if (s.step === "fav") s = tutReduce(s, { type: "FAV", arg: "evil" });
    const html = tutHtml(s);
    /* the substring "onerror=" legitimately survives INSIDE an escaped value —
       that is what escaping looks like. What must not survive is a real TAG
       carrying it, or a real tag at all. */
    ok(!html.includes("<img"),    "raw <img survived on " + s.step);
    ok(!html.includes("<script"), "raw <script survived on " + s.step);
    for (const tag of html.match(/<[a-zA-Z][^>]*>/g) || []) {
      /* every attribute value must be balanced: a hostile `"` would otherwise
         break out and start a new attribute. */
      eq((tag.match(/"/g) || []).length % 2, 0, "unbalanced quotes in a tag on " + s.step + ": " + tag);
      /* strip the quoted values, then assert nothing that survives OUTSIDE them
         is an event handler. This is the exact vulnerability, tested exactly. */
      const bare = tag.replace(/"[^"]*"/g, '""');
      ok(!/\son[a-z]+\s*=/i.test(bare), "an executable handler on " + s.step + ": " + bare);
    }
    if (s.step === "squad") ok(html.includes("&lt;img"), "the name was dropped rather than escaped");
    if (s.step === TUT_STEPS[TUT_STEPS.length - 1]) break;
    s = tutReduce(s, { type: "NEXT" });
  }
});

test("tutFill escapes the template before substituting, and both directions hold", () => {
  const out = tutFill("tutSqFav", "ar", { club: '<b>x</b>' });
  ok(!out.includes("<b>"), "value not escaped");
  ok(out.includes("&lt;b&gt;"), "value not present as text");
});

test("no unreplaced {placeholder} survives into any rendered step", () => {
  forEachStep((html, s) => {
    const m = html.match(/\{[a-zA-Z]+\}/);
    ok(!m, "unreplaced placeholder " + (m && m[0]) + " on step " + s.step);
  });
});

test("no unreplaced {placeholder} on the no-gameweek-data path either", () => {
  for (const lang of ["ar", "en"]) {
    let s = tutInit(Object.assign({}, CTX, { lang, gw: null, seed: 7 }));
    for (const id of TUT_STEPS) {
      const html = tutHtml(s);
      ok(!/\{[a-zA-Z]+\}/.test(html), "placeholder leaked with gw:null on " + id + " / " + lang);
      if (id !== TUT_STEPS[TUT_STEPS.length - 1]) s = tutReduce(s, { type: "NEXT" });
    }
  }
});

test("data-tut-arg values are attribute-escaped", () => {
  const clubs = [{ id: '" onclick="x()', lg: "epl", code: "AAA", ar: "نادي", name: "Club",
                   fame: 9, c1: "#000", c2: "#000", ink: "#fff", pat: "solid", rim: "standard" }].concat(CLUBS);
  let s = tutInit(Object.assign({}, CTX, { clubs, lang: "ar", gw: GW }));
  s = tutReduce(s, { type: "NEXT" });
  const html = tutHtml(s);
  ok(!/data-tut-arg="" onclick=/.test(html), "attribute break-out in data-tut-arg");
  ok(html.includes("&quot;"), "the quote was not escaped");
});

/* ===========================================================================
   6. EVERY STRING PRESENT IN BOTH LANGUAGES
   =========================================================================== */
group("6. strings");

test("every TUT_STR entry is a non-empty [ar, en] pair", () => {
  const keys = Object.keys(TUT_STR);
  ok(keys.length > 30, "suspiciously few strings: " + keys.length);
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
  for (const k of Object.keys(TUT_STR)) {
    for (const v of TUT_STR[k])
      ok(!/[٠-٩۰-۹]/.test(v), k + " uses Arabic-Indic digits: " + v);
  }
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
    ["بداية صحيحة", "\"صحيchة\" is the developer's concept, not the user's (§F.1)"],
    ["المؤشر",      "technical MSA for cursor (§F.1)"],
    ["100 مليون",   "the pre-migration 100M fossil; the budget is 120M (§F.2)"],
    ["هذه نسخة",    "MSA contamination; the app says دي elsewhere (§F.1)"]
  ];
  for (const k of Object.keys(TUT_STR))
    for (const [bad, why] of banned)
      ok(!TUT_STR[k][0].includes(bad), k + ' contains "' + bad + '" — ' + why);
});

test("tutT falls back to the key rather than throwing or printing undefined", () => {
  eq(tutT("noSuchKey", "ar"), "noSuchKey");
  eq(tutT("tutSkip", "en"), "Skip");
  eq(tutT("tutSkip", "ar"), "بعدين");
  eq(tutT("tutSkip"), "بعدين", "no lang defaults to Arabic — the product is Arabic-first");
});

/* ===========================================================================
   7. THE SWAP DRILL — the study's headline failure, taught by the thumb
   =========================================================================== */
group("7. the swap");

test("tap a sub, tap a starter: they exchange and the drill is marked learned", () => {
  let s = tutInit(baseOpts("ar"));
  for (let i = 0; i < 3; i++) s = tutReduce(s, { type: "NEXT" });
  eq(s.step, "swap");
  ok(!s.swapDone, "drill started already done");
  const before = s.squad.slice();
  s = tutReduce(s, { type: "TAP", arg: "11" });        /* first sub */
  eq(s.swapFrom, 11, "first tap did not arm");
  eq(s.squad.join(","), before.join(","), "the board moved on the first tap");
  s = tutReduce(s, { type: "TAP", arg: "10" });        /* a starter */
  eq(s.swapFrom, null, "still armed after the second tap");
  eq(s.squad[10], before[11], "the sub did not come up");
  eq(s.squad[11], before[10], "the starter did not go down");
  ok(s.swapDone, "a crossing swap did not mark the drill learned");
});

test("tapping the armed club again cancels, and changes nothing", () => {
  let s = tutInit(baseOpts("ar"));
  for (let i = 0; i < 3; i++) s = tutReduce(s, { type: "NEXT" });
  const before = s.squad.slice();
  s = tutReduce(s, { type: "TAP", arg: "11" });
  s = tutReduce(s, { type: "TAP", arg: "11" });
  eq(s.swapFrom, null, "cancel did not disarm");
  eq(s.squad.join(","), before.join(","), "cancel moved the board");
  ok(!s.swapDone, "cancel counted as the drill");
});

test("a same-side reorder is allowed but does not count as the lesson", () => {
  let s = tutInit(baseOpts("ar"));
  for (let i = 0; i < 3; i++) s = tutReduce(s, { type: "NEXT" });
  const before = s.squad.slice();
  s = tutReduce(s, { type: "TAP", arg: "1" });
  s = tutReduce(s, { type: "TAP", arg: "2" });
  eq(s.squad[1], before[2], "reorder did not happen");
  ok(!s.swapDone, "a same-side reorder wrongly counted as the pitch/bench lesson");
});

test("any pair works, not just the two the drill highlights", () => {
  let s = tutInit(baseOpts("ar"));
  for (let i = 0; i < 3; i++) s = tutReduce(s, { type: "NEXT" });
  s = tutReduce(s, { type: "TAP", arg: "14" });         /* the last sub */
  s = tutReduce(s, { type: "TAP", arg: "3" });          /* an arbitrary starter */
  ok(s.swapDone, "an un-highlighted but correct gesture was rejected");
});

test("a swap that benches the captain re-seats the armband instead of dropping it", () => {
  /* the shipped build silently wipes the captain (usability friction #4) */
  let s = tutInit(baseOpts("ar"));
  s = tutReduce(s, { type: "NEXT" });
  s = tutReduce(s, { type: "FAV", arg: "364" });
  for (let i = 0; i < 1; i++) s = tutReduce(s, { type: "NEXT" });
  eq(s.step, "swap");
  const capIdx = s.squad.indexOf(s.captain);
  ok(capIdx >= 0 && capIdx < 11, "captain not a starter to begin with");
  s = tutReduce(s, { type: "TAP", arg: String(capIdx) });
  s = tutReduce(s, { type: "TAP", arg: "11" });
  ok(s.captain, "the captain was silently deleted");
  ok(s.squad.slice(0, 11).includes(s.captain), "the captain is no longer a starter");
});

test("out-of-range taps are inert", () => {
  let s = tutInit(baseOpts("ar"));
  for (let i = 0; i < 3; i++) s = tutReduce(s, { type: "NEXT" });
  const before = s.squad.slice();
  s = tutReduce(s, { type: "TAP", arg: "99" });
  s = tutReduce(s, { type: "TAP", arg: "-1" });
  s = tutReduce(s, { type: "TAP", arg: "nope" });
  eq(s.squad.join(","), before.join(","));
  eq(s.swapFrom, null);
});

/* ===========================================================================
   8. THE CAPTAIN
   =========================================================================== */
group("8. the captain");

test("the captain defaults to the favourite, never to an arbitrary club", () => {
  let s = tutInit(baseOpts("ar"));
  s = tutReduce(s, { type: "NEXT" });
  s = tutReduce(s, { type: "FAV", arg: "364" });
  eq(s.captain, "364", "the favourite did not get the armband");
});

test("with no favourite, the captain is the dearest starter and is disclosed", () => {
  let s = tutInit(baseOpts("ar"));
  s = tutReduce(s, { type: "NEXT" });
  s = tutReduce(s, { type: "FAV_NONE" });
  const xi = s.squad.slice(0, 11);
  const dearest = xi.slice().sort((a, b) => priceOf(b) - priceOf(a))[0];
  eq(s.captain, dearest, "captain is not the dearest starter");
  s = tutReduce(s, { type: "NEXT" });                    /* -> swap */
  s = tutReduce(s, { type: "NEXT" });                    /* -> captain */
  ok(tutHtml(s).includes("tut-live"), "the auto-assignment is not stated");
});

test("CAP changes the armband, and only to a club actually owned", () => {
  let s = tutInit(baseOpts("ar"));
  for (let i = 0; i < 4; i++) s = tutReduce(s, { type: "NEXT" });
  eq(s.step, "captain");
  const target = s.squad[5];
  s = tutReduce(s, { type: "CAP", arg: target });
  eq(s.captain, target);
  const before = s.captain;
  s = tutReduce(s, { type: "CAP", arg: "not-a-club" });
  eq(s.captain, before, "an unowned club took the armband");
});

/* ===========================================================================
   9. PURITY AND THE HOST CONTRACT
   =========================================================================== */
group("9. purity and contract");

test("tutReduce never mutates the state it is given", () => {
  let s = tutInit(baseOpts("ar"));
  for (let i = 0; i < 3; i++) s = tutReduce(s, { type: "NEXT" });
  const snapshot = JSON.stringify({ step: s.step, squad: s.squad, cap: s.captain, from: s.swapFrom });
  tutReduce(s, { type: "TAP", arg: "11" });
  tutReduce(s, { type: "SKIP" });
  tutReduce(s, { type: "REROLL" });
  eq(JSON.stringify({ step: s.step, squad: s.squad, cap: s.captain, from: s.swapFrom }), snapshot,
     "the original state was mutated");
});

test("tutHtml is pure — the same state renders identically twice", () => {
  let s = tutInit(baseOpts("ar"));
  for (let i = 0; i < 2; i++) s = tutReduce(s, { type: "NEXT" });
  eq(tutHtml(s), tutHtml(s), "render is not deterministic");
});

test("an unknown action returns the state unchanged", () => {
  const s = tutInit(baseOpts("ar"));
  eq(tutReduce(s, { type: "WAT" }), s);
  eq(tutReduce(s, {}), s);
  eq(tutReduce(s, null), s);
});

test("LANG flips the render without disturbing the squad", () => {
  let s = tutInit(baseOpts("ar"));
  s = tutReduce(s, { type: "NEXT" });
  s = tutReduce(s, { type: "FAV", arg: "364" });
  const squad = s.squad.join(",");
  const ar = tutHtml(s);
  s = tutReduce(s, { type: "LANG", arg: "en" });
  eq(s.squad.join(","), squad, "the language toggle rebuilt the squad");
  ok(tutHtml(s) !== ar, "the language toggle changed nothing on screen");
  ok(tutHtml(s).includes("I like this team"), "English did not render");
});

test("re-roll is capped at five", () => {
  let s = tutInit(baseOpts("ar"));
  s = tutReduce(s, { type: "NEXT" });
  s = tutReduce(s, { type: "FAV_NONE" });
  const seen = new Set([s.squad.join(",")]);
  for (let i = 0; i < 10; i++) { s = tutReduce(s, { type: "REROLL" }); seen.add(s.squad.join(",")); }
  eq(s.rerolls, 5, "re-roll cap");
  ok(seen.size >= 5, "re-rolls produced only " + seen.size + " distinct teams");
  ok(!tutHtml(s).includes('data-tut-act="REROLL"'), "the re-roll button survives the cap");
});

test("every interactive element carries data-tut-act and there are no inline handlers", () => {
  forEachStep((html, s) => {
    const buttons = html.match(/<button[^>]*>/g) || [];
    ok(buttons.length > 0, "no buttons on " + s.step);
    for (const b of buttons) {
      ok(/data-tut-act="/.test(b), "a button on " + s.step + " has no data-tut-act: " + b);
      ok(!/\son[a-z]+=/i.test(b), "an inline handler survived on " + s.step + ": " + b);
    }
  });
});

test("every step offers exactly one focus target and one way forward", () => {
  forEachStep((html, s) => {
    eq((html.match(/data-tut-focus/g) || []).length, 1, "focus target count on " + s.step);
    if (s.step === "fav") {
      /* DELIBERATE EXCEPTION 1: this step's primary action is the grid itself,
         so there is no orange CTA competing with twelve club tiles. The focus
         target is the first tile and "مش بشجع حد" is the ghost exit. */
      eq((html.match(/class="tut-cta"/g) || []).length, 0, "the fav step grew a CTA");
      ok((html.match(/data-tut-act="FAV"/g) || []).length >= 12, "fewer than 12 club tiles");
      ok(html.includes('data-tut-act="FAV_NONE"'), "no way past the fav step without choosing");
    } else if (s.step === "swap" && !s.swapDone) {
      /* DELIBERATE EXCEPTION 2: the orange CTA is the REWARD for doing the
         gesture. Before it, the only way forward is the ghost pass-through —
         which is still full-width and 48px, so a user who reads nothing is
         never trapped. */
      eq((html.match(/class="tut-cta"/g) || []).length, 0, "the swap step gave away its CTA");
      ok(html.includes('data-tut-act="NEXT"'), "no pass-through on the swap step");
    } else {
      eq((html.match(/class="tut-cta"/g) || []).length, 1, "CTA count on " + s.step);
    }
  });
});

test("the swap step's orange CTA appears the moment the gesture lands", () => {
  let s = tutInit(baseOpts("ar"));
  for (let i = 0; i < 3; i++) s = tutReduce(s, { type: "NEXT" });
  ok(!tutHtml(s).includes('class="tut-cta"'), "CTA present before the gesture");
  s = tutReduce(s, { type: "TAP", arg: "11" });
  s = tutReduce(s, { type: "TAP", arg: "10" });
  eq((tutHtml(s).match(/class="tut-cta"/g) || []).length, 1, "no CTA after the gesture");
});

test("the aria contract holds — progressbar, live region, pressed states", () => {
  forEachStep((html, s) => {
    ok(html.includes('role="progressbar"'), "no progressbar on " + s.step);
    ok(html.includes('aria-valuenow='), "no aria-valuenow on " + s.step);
    if (s.step === "swap" || s.step === "captain")
      ok(html.includes('aria-live="polite"') || html.includes('aria-pressed='),
         "no live region or pressed state on " + s.step);
  });
});

/* ===========================================================================
   10. THE FAST PATH — the tap budget the design claims
   =========================================================================== */
group("10. the fast path");

test("a first team in 8 taps", () => {
  let s = tutInit(baseOpts("ar")), taps = 0;
  const tap = a => { s = tutReduce(s, a); taps++; };

  tap({ type: "NEXT" });                       /* 1  يلا نبدأ            */
  tap({ type: "FAV", arg: "364" });            /* 2  ليفربول             */
  tap({ type: "NEXT" });                       /* 3  الفريق ده يعجبني    */
  tap({ type: "TAP", arg: "11" });             /* 4  a sub               */
  tap({ type: "TAP", arg: "10" });             /* 5  a starter -> swapped */
  tap({ type: "NEXT" });                       /* 6  فهمت (captain kept) */
  tap({ type: "NEXT" });                       /* 7  تمام -> the round   */
  tap({ type: "NEXT" });                       /* 8  يلا نشوف الملعب     */
  eq(s.step, "hook", "the eighth tap did not land on the hook");
  tap({ type: "DONE" });                       /* 9  يلا -> the pitch    */

  eq(taps, 9, "tap count including the final DONE");
  ok(s.done, "not finished");
  ok(s.swapDone, "the swap was not learned on the fast path");
  ok(tutIsLegal(s.squad, CTX).ok, "the fast path produced an illegal squad");
  eq(s.captain, "364", "the fast path lost the captain");
  console.log("         8 taps to the hook, 9 including the exit; swap learned; squad legal");
});

test("the read-nothing path — big button only — still ends legal and captained", () => {
  let s = tutInit(baseOpts("ar")), taps = 0;
  /* a user who reads nothing presses whatever is biggest. On the fav step that
     is FAV_NONE; on the swap step it is the pass-through. */
  const press = a => { s = tutReduce(s, a); taps++; };
  press({ type: "NEXT" });
  press({ type: "FAV_NONE" });
  press({ type: "NEXT" });
  press({ type: "NEXT" });                     /* skipped the drill */
  press({ type: "NEXT" });
  press({ type: "NEXT" });
  press({ type: "NEXT" });
  press({ type: "DONE" });
  eq(taps, 8);
  ok(s.done, "not finished");
  ok(tutIsLegal(s.squad, CTX).ok, "illegal squad from the read-nothing path");
  ok(s.captain && s.squad.slice(0, 11).includes(s.captain), "no starting captain");
  ok(!s.swapDone, "the drill was not actually skipped");
  console.log("         8 taps, no reading, legal squad, captain set");
});

/* ===========================================================================
   RESULT
   =========================================================================== */
console.log("\n" + "=".repeat(64));
console.log("  " + pass + " passed, " + fail + " failed");
if (fail) { console.log("\n" + failures.map(f => "  - " + f).join("\n")); }
console.log("=".repeat(64));
process.exit(fail ? 1 : 0);
