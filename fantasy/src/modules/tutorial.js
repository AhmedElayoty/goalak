/* ============================================================================
   GOALLAK FANTASY — THE FIRST-RUN TUTORIAL
   Design rationale: design/fantasy-tutorial.md
   Sources honoured: fantasy-usability.md (the beginner study), fantasy-ui.md
   §C.1/§C.2/§C.3, fantasy-gameweek-explained.md §D, fantasy-engagement.md §E,
   fantasy-artdirection.md §G.

   ----------------------------------------------------------------------------
   INTEGRATION NOTE — read this before dropping it in
   ----------------------------------------------------------------------------

   FILES
     modules/tutorial.css  — paste inside the existing <style> block, or link it.
                             It declares no tokens; it consumes the --fx-* set
                             that :root already defines in index.html, and it
                             re-uses .fxkit / .btn / .card unchanged.
     modules/tutorial.js   — paste inside the existing <script>, or load it
                             BEFORE the script that calls it.

   WHAT IT EXPORTS
     In a browser it assigns these onto the global object, so they are callable
     bare, exactly like the app's own render helpers. In Node it sets
     module.exports instead, which is how tutorial.test.mjs reaches it.

       TUT_STR                                   bilingual [ar, en] pairs, STR-shaped
       TUT_STEPS                                 frozen array of the 7 step ids, in order

       tutInit(opts)                  -> state   pure factory; builds nothing yet
       tutReduce(state, action)       -> state   the state machine; returns a NEW state
       tutHtml(state)                 -> string  the whole sheet body for the current step
       tutProgressHtml(state)         -> string  just the dots + skip row (if mounted apart)
       tutT(key, lang)                -> string  raw, unescaped — for aria-label/title
       tutFill(key, lang, vars)       -> string  escaped HTML, numbers wrapped dir="ltr"
       tutBuildSquad(input)           -> {squad, ok, spend, reason}
       tutIsLegal(squad, input)       -> {ok, errors[]}
       tutFavouritePool(clubs, n)     -> array of club objects, fame-ranked, league-spread
       tutKit(club, size)             -> string  identical markup to the app's kitHtml()
       TUT                            -> frozen namespace holding all of the above

   WHICH ELEMENT TO MOUNT INTO
     #wizBox — the existing wizard sheet body. tutHtml() returns a fragment, not
     a sheet: it renders its own .tut wrapper and expects the host's .wizsheet /
     #wiz scrim around it, unchanged. Nothing else in the app is touched.

       function tutMount(){ document.getElementById("wizBox").innerHTML = tutHtml(TS); }

   WHICH STR KEYS TO MERGE
     Object.assign(STR, TUT_STR);
     Every key is tut-prefixed. Nothing in TUT_STR collides with the demo's
     current STR, and nothing collides with gameweek.js's GW_STR. After the
     merge the app's own t() reaches all of them; tutT() is only needed for a
     lookup that must not read the LANG global.

     RETIREMENTS this module asks for — the seven wizard keys it replaces:
       wiz1h wiz1p wiz2h wiz2p wiz3h wiz3hEn wiz3p wiz4h wiz4p  are all retired.
       `skip` is retired: "تخطى" is past-tense third-person and reads as a
       grammatical error (usability §F.1). tutSkip = "بعدين".
     REUSED UNCHANGED, not redefined:
       benchLab, capNote, autoPick, gotIt, done — the app already owns these and
       this module deliberately does not shadow them.

     ONE DELIBERATE DUPLICATE: tutGwLine is fxWizGw from
     fantasy-gameweek-explained.md §D.2 (G2), reproduced VERBATIM including its
     {from}/{to} placeholders, so the tutorial has no hard dependency on
     gameweek.js. Both were converted to Egyptian together and must stay
     byte-identical — see design/fantasy-arabic.md. If gameweek.js is present, prefer it: pass
     opts.gw.lineHtml = gwFill("fxWizGw", LANG, {from, to}) and this module will
     render that instead and never touch its own copy.

   WHAT THE HOST MUST CALL ON EACH STEP TRANSITION
     Every interactive element carries data-tut-act (and sometimes data-tut-arg).
     Bind ONE delegated listener; there are no inline handlers, because these
     functions are pure.

       host.onclick = e => {
         const el = e.target.closest("[data-tut-act]");  if(!el) return;
         TS = tutReduce(TS, {type: el.dataset.tutAct, arg: el.dataset.tutArg});
         if(TS.done){                                   // 1. COMMIT
           squad = TS.squad.slice(); captain = TS.captain; save();
           closeWizard(); return;
         }
         tutMount();                                    // 2. RE-RENDER
         const f = host.querySelector("[data-tut-focus]");         // 3. FOCUS
         if(f) f.focus({preventScroll:true});
         host.scrollTop = 0;                                       // 4. SCROLL
       };

     On the language toggle:  TS = tutReduce(TS, {type:"LANG", arg: LANG}); tutMount();
     The [data-tut-live] node is an aria-live="polite" region; re-rendering it is
     the whole announcement contract. Nothing else is required.

     Actions the host may dispatch: NEXT BACK SKIP FAV FAV_NONE REROLL TAP CAP
     DONE LANG. Any unknown action returns the state unchanged.

   PURITY CONTRACT
     Every function takes state and returns a value. No DOM access, no global
     reads, no Date.now(), no Math.random(), no network, no localStorage, no
     mutation of anything passed in. `lang` always lives in state — the module
     never reads LANG. Randomness is a seeded LCG so a given seed always yields
     the same squad, which is what makes the legality test meaningful.

   ESCAPING
     Nothing reaches the output un-escaped. tutFill() escapes the template FIRST
     and then substitutes already-escaped values, so a club named
     `<img onerror=…>` renders as text. The only markup this module emits is
     markup it wrote. No string in TUT_STR contains a "<".

   HOUSE RULES OBSERVED
     Arabic-first, RTL default. Western digits only (num()). Every Latin or
     numeric run is individually dir="ltr" wrapped. No images, no SVG, no
     external assets. Logical CSS only — this file emits no inline style that
     names a physical direction.

   COACH-MARK BUDGET
     This module requests ZERO coach marks. The budget stays at nine
     (fantasy-ui.md §C.3) and gameweek.js already spends its rewrites of CM-4
     and CM-8 inside it. CM-1 still fires on the first view of My Team AFTER
     the tutorial closes — the tutorial's round step states the deadline as a
     fact and deliberately does not pre-empt CM-1's sentence.
   ============================================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";

/* ---------------------------------------------------------------------------
   0. PRIMITIVES — identical to the app's own, on purpose
   --------------------------------------------------------------------------- */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
/* Western digits everywhere, per the app's own rule. The usability study found
   two numeral systems on the first screen; the tutorial contributes to neither
   half of that bug — every numeral it prints comes through here. */
const num = n => String(n);
const ltr = s => '<span dir="ltr">' + esc(s) + "</span>";

/* deterministic LCG. Same seed, same squad — which is what lets the test assert
   legality across all 126 possible favourites instead of hoping. */
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return function () { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
}

/* ---------------------------------------------------------------------------
   1. STRINGS
   Arabic is Egyptian-inflected throughout. The usability study's §F audit is the
   spec: مفيش not مافي, جهزنالك not جهزنا لك, خليه not اجعله, بعدين not تخطى,
   مالوش ماتش not لا يلعب. Western digits inside the strings, never Arabic-Indic.
   No string contains markup — emphasis is a separate element, so tutFill() can
   escape templates whole.
   --------------------------------------------------------------------------- */
const TUT_STR = {

  /* ---- chrome, present on every step ---- */
  tutSkip:      ["بعدين", "Skip"],
  tutSkipAria:  ["سيب الشرح وروح على الملعب", "Skip the tutorial and go to the pitch"],
  tutBack:      ["رجوع", "Back"],
  tutStepAria:  ["خطوة {n} من {total}", "Step {n} of {total}"],

  /* ---- step 1 · الترحيب ----
     The study called «مش هتختار لاعيبة — هتختار أندية» the single best sentence
     in the product. It was the third line of a paragraph. It is now the
     headline. That is the "beat it" — same words, ten times the prominence. */
  tutW1Ttl:  ["مش هتختار لاعيبة — هتختار أندية", "You don't pick players — you pick clubs"],
  tutW1Body: ["كل نادي في فريقك بيجيب لك نقط من نتايجه الحقيقية. مفيش لاعيبة، ومفيش إصابات.",
              "Every club in your team earns you points from its real results. No players, no injuries."],
  /* was "3 minutes" against the landing page's "about 40 seconds" — one number, one promise */
  tutW1Note: ["دقيقتين وفريقك جاهز", "Two minutes and your team is ready"],
  tutW1Cta:  ["يلا نبدأ", "Let's go"],

  /* ---- step 2 · نادي قلبك ----
     Restores fantasy-ui.md §C.1.3 + §C.1.4. Fixes the study's 0:24 deflation
     ("the app built him a team and did not put his club in it") at the source. */
  tutFavTtl:  ["إنت بتشجع مين؟", "Who do you support?"],
  tutFavBody: ["هنبني فريقك حواليه، وهيلعب أساسي.", "We'll build your team around them, and they'll start."],
  tutFavNone: ["مش بشجع حد", "No favourite"],
  tutFavAria: ["اختار {club}", "Choose {club}"],

  /* ---- step 3 · الفريق ---- */
  tutSqTtl:   ["جهزنالك فريق", "We built you a team"],
  tutSqBody:  ["دي بداية كاملة ومظبوطة. سيبها زي ما هي، أو غيّرها.",
               "A complete, correct starting squad. Keep it, or change it."],
  tutSqFav:   ["{club} أساسي عندك", "{club} starts for you"],
  tutSqReroll:["فريق تاني", "Another team"],
  tutSqCta:   ["الفريق ده يعجبني", "I like this team"],
  tutPillN:   ["{n} نادي", "{n} clubs"],
  tutPillM:   ["{n} مليون", "{n}M"],
  tutPillXi:  ["11 في الملعب و4 على الدكة", "11 on the pitch, 4 subs"],
  tutPillLg:  ["3 من كل دوري بالكتير", "Max 3 per league"],

  /* ---- step 4 · البدل ----
     The study's headline failure, taught by the thumb instead of by a hint. */
  tutSwTtl:   ["الملعب ده قرارك إنت", "The pitch is your call"],
  tutSwBody:  ["رتبناهم بالسعر — بس إنت اللي بتعرف مين هيكسب الجولة دي.",
               "We ordered them by price — but you're the one who knows who's winning this round."],
  tutSwDo1:   ["دوس على {a} اللي على الدكة", "Tap {a} on the bench"],
  tutSwDo2:   ["تمام. دلوقتي دوس على {b} اللي في الملعب", "Good. Now tap {b} on the pitch"],
  tutSwOk:    ["كده بالظبط. أي نادي تقدر تبدله في أي وقت.",
               "Exactly that. You can swap any club, any time."],
  tutSwPitch: ["الملعب", "The pitch"],
  tutSwBench: ["الدكة · بيدخلوا لوحدهم لو ناديك مالوش ماتش",
               "The bench · they come on automatically when a starter has no match"],
  tutSwCta:   ["فهمت", "Got it"],
  tutSwPass:  ["كمل من غير ما أجرب", "Continue without trying"],
  tutSwSlot:  ["{club} · {price} مليون", "{club} · {price}M"],

  /* ---- step 5 · الكابتن ----
     The rule as arithmetic, per fantasy-ui.md §C.1.6 fxWiz5Sub. */
  tutCapTtl:  ["الكابتن بياخد ضعف النقط", "Your captain scores double"],
  tutCapBody: ["لو جاب 12، تاخد 24. دوس على النادي اللي واثق فيه.",
               "If they score 12, you get 24. Tap the club you trust."],
  tutCapPre:  ["خليناه {club} — غيّره لو عايز.", "We've set {club} — change it if you like."],
  tutCapCta:  ["تمام", "Done"],
  tutCapAria: ["خلي {club} الكابتن", "Make {club} captain"],

  /* ---- step 6 · الجولة ----
     tutGwLine is fxWizGw, verbatim. See the header note. */
  tutGwTtl:    ["الجولة {n}", "Round {n}"],
  tutGwLine:   ["الجولة الأولى: من {from} لـ {to}. كل ماتش تلعبه أنديتك فيها بيتحسب لك.",
                "Round 1: {from} to {to}. Every match your clubs play in it counts for you."],
  tutGwLineNd: ["كل ماتش تلعبه أنديتك في الجولة دي بيتحسب لك.",
                "Every match your clubs play in this round counts for you."],
  tutGwLock:   ["بيقفل {when}", "Locks {when}"],
  tutGwBody:   ["ده آخر ميعاد تقدر تغيّر فيه فريقك.", "This is the last moment you can change your team."],
  tutGwCta:    ["يلا نشوف الملعب", "Take me to the pitch"],

  /* ---- step 7 · الهوك · fantasy-engagement.md §E.2 ---- */
  tutHkTtl:    ["ميعاد الكابتن", "Your captain's appointment"],
  tutHkLine:   ["{club} بيلعب {when}.", "{club} play {when}."],
  tutHkLineNt: ["{club} هو الكابتن بتاعك.", "{club} is your captain."],
  tutHkX2:     ["نقطه بتتضاعف", "Their points double"],
  tutHkWhy:    ["إنت اخترته. ارجع وشوف لو كنت على حق.", "You chose them. Come back and see if you were right."],
  tutHkCta:    ["يلا", "Let's go"],

  /* ---- the read-nothing / skip exit ---- */
  tutSkipDone: ["جهزنالك فريق كامل. تقدر تغيّره في أي وقت.",
                "We built you a complete team. You can change it any time."]
};

/* ---------------------------------------------------------------------------
   2. LOOKUP AND INTERPOLATION
   --------------------------------------------------------------------------- */
function tutT(key, lang) {
  const e = TUT_STR[key];
  return e ? e[lang === "en" ? 1 : 0] : key;
}
/* Escape the TEMPLATE first, then substitute already-escaped values. A club
   named `<img src=x onerror=alert(1)>` therefore renders as visible text and
   never as markup. Numbers are wrapped dir="ltr" so an Arabic line never
   mirrors them. */
function tutFill(key, lang, vars) {
  let s = esc(tutT(key, lang));
  if (vars) for (const k of Object.keys(vars)) {
    const v = vars[k];
    const rep = (typeof v === "number") ? ltr(num(v)) : esc(String(v));
    s = s.split("{" + k + "}").join(rep);
  }
  return s;
}

/* ---------------------------------------------------------------------------
   3. THE STEPS
   Seven, and every one of them has exactly ONE thing the user physically does.
   welcome  — tap to begin              (the mental model)
   fav      — tap your club             (ownership; seeds everything after)
   squad    — tap to accept, or re-roll (15 / 120M / 11+4 / 3-per-league)
   swap     — tap a sub, tap a starter  (the verb the product was missing)
   captain  — tap a club                (double points)
   round    — tap to continue           (a round is a period; it has a deadline)
   hook     — tap to the pitch          (the appointment they made themselves)
   --------------------------------------------------------------------------- */
const TUT_STEPS = Object.freeze(["welcome", "fav", "squad", "swap", "captain", "round", "hook"]);
function tutSteps() { return TUT_STEPS.slice(); }
const stepIndex = id => TUT_STEPS.indexOf(id);

/* ---------------------------------------------------------------------------
   4. THE SQUAD BUILDER — pure, seeded, and legal by construction
   fantasy-ui.md §C.1.4 asks for band coverage "so the shape of the price ladder
   is visible". The shipped autoFill() is a greedy price-descending walk that
   produces 18.5/17.5/16.5/15.5/7.0 and then ten clubs at exactly 4.5 — a
   barbell that HIDES the ladder and loads the default team with the obscure
   cheap clubs (usability §K.11). These five bands are the fix.

   The quotas 1/2/3/5/4 and the mins below sum to a soft target of 110.5M
   against a 120.0M budget. That 9.5M of slack is what the dear end spends, and
   it is deliberately small: give the top of the ladder more room and the tail
   collapses onto the 4.5M floor, which is the exact failure being fixed.
   --------------------------------------------------------------------------- */
const BANDS = Object.freeze([
  { min: 15.0, max: Infinity, n: 1 },
  { min: 11.0, max: 14.99,    n: 2 },
  { min: 8.5,  max: 10.99,    n: 3 },
  { min: 6.0,  max: 8.49,     n: 5 },
  { min: 4.5,  max: 5.99,     n: 4 }
]);

function ctxOf(input) {
  return {
    clubs:        input.clubs || [],
    price:        input.price || (() => 8),
    size:         input.size        != null ? input.size        : 15,
    startSize:    input.startSize   != null ? input.startSize   : 11,
    budget:       input.budget      != null ? input.budget      : 120.0,
    maxPerLeague: input.maxPerLeague!= null ? input.maxPerLeague: 3,
    minPrice:     input.minPrice    != null ? input.minPrice    : 4.5
  };
}

/* what the still-unfilled slots must be left with. Two floors, and the guard
   takes the LARGER: the hard floor (nothing may strand the user with slots he
   cannot fill) and the soft floor (the band mins, which is what keeps the
   ladder visible instead of collapsing to the barbell). */
function floorFor(quota, picked, c) {
  const slotsLeft = c.size - picked - 1;
  if (slotsLeft <= 0) return 0;
  let soft = 0, left = slotsLeft;
  for (let i = 0; i < BANDS.length && left > 0; i++) {
    const take = Math.min(quota[i], left);
    soft += take * BANDS[i].min; left -= take;
  }
  return Math.max(slotsLeft * c.minPrice, soft);
}

function bandOf(p) {
  for (let i = 0; i < BANDS.length; i++) if (p >= BANDS[i].min && p <= BANDS[i].max) return i;
  return BANDS.length - 1;                     /* anything under the floor bands with it */
}

/* tutBuildSquad({clubs, price, fav, seed, ...}) -> {squad, ok, spend, reason}
   squad[0] is the favourite when one was given, then the rest by price
   descending — so indices 0..10 are the eleven and 11..14 are the bench, and
   the user's own club is guaranteed a STARTING place (fantasy-ui.md §C.1.3,
   usability fix #3). */
function tutBuildSquad(input) {
  const c = ctxOf(input);
  const rnd = rng(input.seed != null ? input.seed : 1);
  const priceOf = id => c.price(id);
  const quota = BANDS.map(b => b.n);
  const picked = [], lgN = {};
  let spend = 0;

  const take = id => {
    const club = c.clubs.find(x => x.id === id); if (!club) return false;
    picked.push(id); lgN[club.lg] = (lgN[club.lg] || 0) + 1; spend += priceOf(id);
    const b = bandOf(priceOf(id)); if (quota[b] > 0) quota[b]--;
    return true;
  };

  /* the favourite goes in first and unconditionally — it is the one club the
     user asked for by name, and it is the whole point of asking. */
  if (input.fav && c.clubs.some(x => x.id === input.fav)) take(input.fav);

  const eligible = (club) => {
    if (picked.includes(club.id)) return false;
    if ((lgN[club.lg] || 0) >= c.maxPerLeague) return false;
    return true;
  };

  /* THE RESERVE HAS TO RESPECT THE LEAGUE CAP. `(slots) * minPrice` assumes the floor price is
     always available, and with a maximum of three clubs per league it often is not: after the
     five-season reprice only eleven clubs sit at 4.5 and they span four leagues, so the twelfth
     cheap slot costs 5.0 or more. The optimistic version stranded this builder on 13 clubs for
     several favourites - it reported a legal squad it could not actually finish. */
  const cheapestRest = (n, extraId) => {
    if (n <= 0) return 0;
    const held = extraId ? picked.concat([extraId]) : picked;
    const cnt = {};
    for (const id of held) { const cl = c.clubs.find(x => x.id === id); if (cl) cnt[cl.lg] = (cnt[cl.lg] || 0) + 1; }
    const pool = c.clubs.filter(x => held.indexOf(x.id) < 0)
                        .sort((a, b2) => priceOf(a.id) - priceOf(b2.id));
    let tot = 0, got = 0;
    for (const x of pool) {
      if (got >= n) break;
      if ((cnt[x.lg] || 0) >= c.maxPerLeague) continue;
      cnt[x.lg] = (cnt[x.lg] || 0) + 1; tot += priceOf(x.id); got++;
    }
    return got < n ? Infinity : tot;
  };
  for (let b = 0; b < BANDS.length; b++) {
    while (quota[b] > 0 && picked.length < c.size) {
      /* fame ranks the candidates so recognisable clubs surface first — the
         `fame` field is on 121 of 126 clubs and the shipped build uses it
         nowhere (usability fix #8). The seeded jitter is what makes `فريق تاني`
         a different team rather than a reshuffle of the same one. */
      const cands = c.clubs.filter(x =>
        eligible(x) && priceOf(x.id) >= BANDS[b].min && priceOf(x.id) <= BANDS[b].max);
      let best = null, bestScore = -Infinity;
      for (const x of cands) {
        const p = priceOf(x.id);
        /* floorFor assumes the band minimum is always purchasable; the league cap means it is
           not. Test the real cheapest completion with this club already owned, exactly as the
           backfill does, or the bands overspend and strand the squad. */
        if (spend + p + cheapestRest(c.size - picked.length - 1, x.id) > c.budget) continue;
        const score = (x.fame || 0) + rnd() * 0.35 + (x.ar ? 0.10 : 0) + p / 400;
        if (score > bestScore) { bestScore = score; best = x; }
      }
      if (!best) { quota[b] = 0; break; }
      take(best.id);
    }
  }

  /* backfill: whatever the bands could not place, take the cheapest legal club
     that still leaves the remaining slots fillable. */
  let guard = 0;
  while (picked.length < c.size && guard++ < 400) {
    const cands = c.clubs.filter(x => eligible(x) &&
      spend + priceOf(x.id) + cheapestRest(c.size - picked.length - 1, x.id) <= c.budget);
    if (!cands.length) break;
    cands.sort((a, b2) => priceOf(a.id) - priceOf(b2.id) || (b2.fame || 0) - (a.fame || 0));
    take(cands[0].id);
  }

  /* order: favourite first, then price descending. That is what puts the
     eleven and the bench in the right slots without a second concept. */
  const fav = input.fav && picked.includes(input.fav) ? input.fav : null;
  const rest = picked.filter(id => id !== fav).sort((a, b) => priceOf(b) - priceOf(a));
  const squad = fav ? [fav].concat(rest) : rest;

  return {
    squad: squad,
    ok: squad.length === c.size,
    spend: +spend.toFixed(1),
    reason: squad.length === c.size ? null : "pool exhausted"
  };
}

/* tutIsLegal — the same rules the picker enforces, checkable from the outside.
   The test asserts this; so can the host, before it commits. */
function tutIsLegal(squad, input) {
  const c = ctxOf(input), errors = [];
  if (!Array.isArray(squad)) return { ok: false, errors: ["not an array"] };
  if (squad.length !== c.size) errors.push("size " + squad.length + " != " + c.size);
  if (new Set(squad).size !== squad.length) errors.push("duplicate club");
  let spend = 0; const lgN = {};
  for (const id of squad) {
    const club = c.clubs.find(x => x.id === id);
    if (!club) { errors.push("unknown club " + id); continue; }
    spend += c.price(id);
    lgN[club.lg] = (lgN[club.lg] || 0) + 1;
  }
  spend = +spend.toFixed(1);
  if (spend > c.budget) errors.push("over budget " + spend + " > " + c.budget);
  for (const lg of Object.keys(lgN))
    if (lgN[lg] > c.maxPerLeague) errors.push("league " + lg + " has " + lgN[lg]);
  return { ok: errors.length === 0, errors: errors, spend: spend };
}

/* tutFavouritePool — one club per league first, then filled by fame.
   The one-per-league pass is deliberate: Mahmoud cannot name a Scottish club,
   and a grid that quietly contains سيلتيك alongside ليفربول teaches the league
   spread without a sentence. Clubs with no Arabic name are excluded — the study
   found three Latin names in everyone's default squad and this is the one
   screen where that must not happen. */
function tutFavouritePool(clubs, n) {
  const size = n || 12;
  const ok = (clubs || []).filter(c => c.ar);
  const byFame = ok.slice().sort((a, b) =>
    (b.fame || 0) - (a.fame || 0) || String(a.id).localeCompare(String(b.id)));
  const out = [], seen = {};
  for (const c of byFame) if (!seen[c.lg]) { seen[c.lg] = 1; out.push(c); }
  for (const c of byFame) { if (out.length >= size) break; if (!out.includes(c)) out.push(c); }
  return out.slice(0, size).sort((a, b) => (b.fame || 0) - (a.fame || 0));
}

/* ---------------------------------------------------------------------------
   5. STATE
   --------------------------------------------------------------------------- */
function tutInit(opts) {
  const o = opts || {};
  return Object.freeze({
    step: "welcome",
    lang: o.lang === "en" ? "en" : "ar",
    clubs: o.clubs || [],
    price: o.price || (() => 8),
    leagueName: o.leagueName || (id => id),
    size: o.size != null ? o.size : 15,
    startSize: o.startSize != null ? o.startSize : 11,
    budget: o.budget != null ? o.budget : 120.0,
    maxPerLeague: o.maxPerLeague != null ? o.maxPerLeague : 3,
    minPrice: o.minPrice != null ? o.minPrice : 4.5,
    gw: o.gw || null,          /* {no, from:[ar,en], to:[ar,en], lock:[ar,en], fixture:[ar,en], lineHtml} */
    seed: o.seed != null ? o.seed : 7,
    fav: null,
    squad: [],
    captain: null,
    swapFrom: null,
    swapDone: false,
    rerolls: 0,
    skipped: false,
    done: false
  });
}

const next = (s, patch) => Object.freeze(Object.assign({}, s, patch));

/* the captain is auto-assigned, stated, and offered as an edit — visible,
   honest, pre-solved (fantasy-ui.md §C.1.6). The favourite gets the armband
   when there is one, because the study's whole captain beat failed on being
   handed a club the user had no feeling for. */
function defaultCaptain(s, squad) {
  const xi = squad.slice(0, s.startSize);
  if (s.fav && xi.includes(s.fav)) return s.fav;
  let best = null, bp = -Infinity;
  for (const id of xi) { const p = s.price(id); if (p > bp) { bp = p; best = id; } }
  return best;
}

function ensureSquad(s) {
  if (s.squad.length === s.size) return s;
  const built = tutBuildSquad({
    clubs: s.clubs, price: s.price, fav: s.fav, seed: s.seed,
    size: s.size, startSize: s.startSize, budget: s.budget,
    maxPerLeague: s.maxPerLeague, minPrice: s.minPrice
  });
  const withSquad = next(s, { squad: built.squad });
  return next(withSquad, { captain: s.captain || defaultCaptain(withSquad, built.squad) });
}

function goto(s, id) {
  const i = stepIndex(id);
  if (i < 0) return s;
  /* the squad must exist before any step that shows it, including when the user
     jumped there without touching the favourite grid. */
  let t = (i >= stepIndex("squad")) ? ensureSquad(s) : s;
  if (i >= stepIndex("captain") && !t.captain) t = next(t, { captain: defaultCaptain(t, t.squad) });
  return next(t, { step: id, swapFrom: null });
}

function tutReduce(state, action) {
  const s = state, a = action || {};
  switch (a.type) {

    case "NEXT": {
      const i = stepIndex(s.step);
      if (i >= TUT_STEPS.length - 1) return next(ensureSquad(s), { done: true });
      return goto(s, TUT_STEPS[i + 1]);
    }

    case "BACK": {
      const i = stepIndex(s.step);
      return i <= 0 ? s : goto(s, TUT_STEPS[i - 1]);
    }

    /* One tap, from every step, always. A returning viewer — and the owner
       opening the link for the fifth time today — gets the pitch immediately,
       and still gets a complete legal team with a captain, because skipping the
       reading must never mean skipping the team (usability friction #27). */
    case "SKIP": {
      const t = ensureSquad(s);
      return next(t, { done: true, skipped: true, captain: t.captain || defaultCaptain(t, t.squad) });
    }

    case "FAV": {
      if (!a.arg) return s;
      const t = next(s, { fav: String(a.arg), squad: [], captain: null });
      return goto(t, "squad");
    }

    case "FAV_NONE":
      return goto(next(s, { fav: null, squad: [], captain: null }), "squad");

    /* capped at 5 — five is enough to feel agency, more is a slot machine
       (fantasy-ui.md §C.1.4). */
    case "REROLL": {
      if (s.rerolls >= 5) return s;
      const t = next(s, { rerolls: s.rerolls + 1, seed: s.seed + 101, squad: [], captain: null });
      return ensureSquad(t);
    }

    /* THE SWAP. Tap one, then tap the other. Tapping the armed club again
       cancels. A crossing swap (pitch <-> bench) is what marks the drill
       learned; a same-side reorder is legal and silent, exactly as in the app.
       The two highlighted slots are a SUGGESTION, not a gate — any pair works,
       because a tutorial that rejects a correct gesture teaches nothing except
       that the app is fussy. */
    case "TAP": {
      const i = parseInt(a.arg, 10);
      if (!(i >= 0 && i < s.squad.length)) return s;
      if (s.swapFrom === null) return next(s, { swapFrom: i });
      if (s.swapFrom === i) return next(s, { swapFrom: null });
      const j = s.swapFrom;
      const sq = s.squad.slice();
      const tmp = sq[i]; sq[i] = sq[j]; sq[j] = tmp;
      const crossed = (i < s.startSize) !== (j < s.startSize);
      let t = next(s, { squad: sq, swapFrom: null, swapDone: s.swapDone || crossed });
      /* a captain that has just been benched loses the armband silently in the
         shipped build. Here it is re-seated, never dropped. */
      if (t.captain && !sq.slice(0, s.startSize).includes(t.captain))
        t = next(t, { captain: defaultCaptain(t, sq) });
      return t;
    }

    case "CAP": {
      if (!a.arg) return s;
      const id = String(a.arg);
      return s.squad.includes(id) ? next(s, { captain: id }) : s;
    }

    case "DONE":
      return next(ensureSquad(s), { done: true });

    case "LANG":
      return next(s, { lang: a.arg === "en" ? "en" : "ar" });

    default:
      return s;
  }
}

/* ---------------------------------------------------------------------------
   6. RENDERING
   Every function here returns a string. tutHtml() is the only entry point the
   host needs.
   --------------------------------------------------------------------------- */
const clubOf = (s, id) => s.clubs.find(x => x.id === id) || null;
const clubName = (s, c) => !c ? "" : (s.lang === "ar" && c.ar ? c.ar : (c.short || c.name || c.code || ""));
const priceStr = (s, id) => s.price(id).toFixed(1);
const T = (s, k, v) => tutFill(k, s.lang, v);
const pair = (s, p) => !p ? "" : (Array.isArray(p) ? (s.lang === "en" ? p[1] : p[0]) : String(p));

/* identical markup to the app's own kitHtml(), so the tutorial inherits the
   existing .fxkit styling and introduces no second club-identity language. */
function tutKit(c, size) {
  if (!c) return "";
  return '<span class="fxkit ' + esc(size || "k44") + '" data-pat="' + esc(c.pat) + '" data-rim="' + esc(c.rim) + '"'
    + (c.iso ? ' data-iso="1"' : "")
    + ' style="--c1:' + esc(c.c1) + ';--c2:' + esc(c.c2) + ';--ink:' + esc(c.ink) + '">'
    + '<span class="fxcode" dir="ltr">' + esc(c.code) + "</span></span>";
}

function btn(label, act, cls, arg, extra) {
  return '<button type="button" class="' + esc(cls || "tut-cta") + '"'
    + ' data-tut-act="' + esc(act) + '"'
    + (arg != null ? ' data-tut-arg="' + esc(arg) + '"' : "")
    + (extra || "") + ">" + label + "</button>";
}

/* the dots + the always-present skip. The skip is a small ghost control in the
   top row, NOT a second full-width button under the CTA: the shipped wizard
   gives 345x48 to "التالي" and 345x50.5 to "تخطى الشرح", so the escape hatch is
   fractionally LARGER than the thing it wants you to do. */
function tutProgressHtml(s) {
  const i = stepIndex(s.step), n = TUT_STEPS.length;
  const dots = TUT_STEPS.map((_, k) =>
    '<span class="tut-dot' + (k === i ? " on" : (k < i ? " past" : "")) + '"></span>').join("");
  return '<div class="tut-top">'
    + '<div class="tut-prog" role="progressbar" aria-valuemin="1" aria-valuemax="' + num(n) + '"'
    + ' aria-valuenow="' + num(i + 1) + '" aria-label="' + esc(tutT("tutStepAria", s.lang)
        .split("{n}").join(num(i + 1)).split("{total}").join(num(n))) + '">' + dots + "</div>"
    + btn(T(s, "tutSkip"), "SKIP", "tut-skip", null,
          ' aria-label="' + esc(tutT("tutSkipAria", s.lang)) + '"')
    + "</div>";
}

function pills(s) {
  const spend = s.squad.reduce((a, id) => a + s.price(id), 0).toFixed(1);
  return '<div class="tut-pills">'
    + '<span class="tut-pill">' + T(s, "tutPillN", { n: s.size }) + "</span>"
    + '<span class="tut-pill">' + T(s, "tutPillM", { n: spend }) + "</span>"
    + '<span class="tut-pill">' + T(s, "tutPillXi") + "</span>"
    + '<span class="tut-pill">' + T(s, "tutPillLg") + "</span>"
    + "</div>";
}

function slot(s, i, opts) {
  const id = s.squad[i], c = clubOf(s, id); if (!c) return "";
  const o = opts || {};
  const cls = "tut-slot"
    + (s.swapFrom === i ? " arm" : "")
    + (o.hint ? " hint" : "")
    + (id === s.fav ? " fav" : "");
  return '<button type="button" class="' + cls + '" data-tut-act="TAP" data-tut-arg="' + num(i) + '"'
    + (s.swapFrom === i ? ' aria-pressed="true"' : ' aria-pressed="false"')
    + (o.focus ? " data-tut-focus" : "")
    + ' aria-label="' + esc(tutT("tutSwSlot", s.lang)
        .split("{club}").join(clubName(s, c)).split("{price}").join(priceStr(s, id))) + '">'
    + tutKit(c, "k34")
    + '<span class="tut-nm">' + esc(clubName(s, c)) + "</span>"
    + '<span class="tut-pr" dir="ltr">' + esc(priceStr(s, id)) + "</span>"
    + "</button>";
}

/* the eleven as three plain rows, and the bench as a fourth under a labelled
   divider. Deliberately NOT a formation: the formation control is inert
   (engagement §A.5, usability #17) and teaching a decision that does not exist
   is the most expensive kind of wrong. */
function pitch(s, hintA, hintB) {
  const rows = [4, 4, 3], out = []; let k = 0;
  for (const r of rows) {
    const cells = [];
    for (let x = 0; x < r && k < s.startSize; x++, k++)
      cells.push(slot(s, k, { hint: k === hintA || k === hintB, focus: k === hintA }));
    out.push('<div class="tut-line">' + cells.join("") + "</div>");
  }
  const bench = [];
  for (let i = s.startSize; i < s.squad.length; i++)
    bench.push(slot(s, i, { hint: i === hintA || i === hintB, focus: i === hintA }));
  return '<div class="tut-board">'
    + '<div class="tut-lab">' + T(s, "tutSwPitch") + "</div>"
    + out.join("")
    + '<div class="tut-lab tut-lab--b">' + T(s, "tutSwBench") + "</div>"
    + '<div class="tut-line tut-line--b">' + bench.join("") + "</div>"
    + "</div>";
}

/* which two slots the drill points at: the dearest club on the bench, and the
   cheapest starter that is not the user's own club. Never ask a man to bench
   Liverpool thirty seconds after promising it a starting place. */
function drillPair(s) {
  const benchIdx = s.startSize;
  let starterIdx = -1, lo = Infinity;
  for (let i = 0; i < s.startSize; i++) {
    if (s.squad[i] === s.fav) continue;
    const p = s.price(s.squad[i]);
    if (p < lo) { lo = p; starterIdx = i; }
  }
  return { bench: benchIdx, starter: starterIdx < 0 ? 0 : starterIdx };
}

function live(html) { return '<p class="tut-live" data-tut-live aria-live="polite">' + html + "</p>"; }

function tutHtml(state) {
  const s = state;
  const head = tutProgressHtml(s);
  const back = stepIndex(s.step) > 0
    ? btn(T(s, "tutBack"), "BACK", "tut-back") : "";
  let body = "";

  if (s.step === "welcome") {
    body = '<h2 class="tut-h tut-h--big">' + T(s, "tutW1Ttl") + "</h2>"
      + '<p class="tut-p">' + T(s, "tutW1Body") + "</p>"
      + '<p class="tut-note">' + T(s, "tutW1Note") + "</p>"
      + btn(T(s, "tutW1Cta"), "NEXT", "tut-cta", null, " data-tut-focus");
  }

  else if (s.step === "fav") {
    const pool = tutFavouritePool(s.clubs, 12);
    body = '<h2 class="tut-h">' + T(s, "tutFavTtl") + "</h2>"
      + '<p class="tut-p">' + T(s, "tutFavBody") + "</p>"
      + '<div class="tut-grid">' + pool.map((c, k) =>
          '<button type="button" class="tut-fav' + (s.fav === c.id ? " on" : "") + '"'
          + ' data-tut-act="FAV" data-tut-arg="' + esc(c.id) + '"'
          + (k === 0 ? " data-tut-focus" : "")
          + ' aria-label="' + esc(tutT("tutFavAria", s.lang).split("{club}").join(clubName(s, c))) + '">'
          + tutKit(c, "k34") + '<span class="tut-nm">' + esc(clubName(s, c)) + "</span></button>"
        ).join("") + "</div>"
      + btn(T(s, "tutFavNone"), "FAV_NONE", "tut-sec");
  }

  else if (s.step === "squad") {
    const fc = clubOf(s, s.fav);
    body = '<h2 class="tut-h">' + T(s, "tutSqTtl") + "</h2>"
      + '<p class="tut-p">' + T(s, "tutSqBody") + "</p>"
      + (fc ? '<p class="tut-ok">' + T(s, "tutSqFav", { club: clubName(s, fc) }) + "</p>" : "")
      + pills(s)
      + pitch(s, -1, -1)
      + btn(T(s, "tutSqCta"), "NEXT", "tut-cta", null, " data-tut-focus")
      + (s.rerolls < 5 ? btn(T(s, "tutSqReroll"), "REROLL", "tut-sec") : "");
  }

  else if (s.step === "swap") {
    const d = drillPair(s);
    /* ONE TARGET AT A TIME. Both slots used to glow while the sentence named one of them, so
       a user following the glow armed the wrong card — and the next sentence then named the
       card they had just tapped, which disarmed it and reset the step. That is a closed loop
       with no exit but Skip, inside mandatory onboarding, and it was reproducible every run.
       The hint now points at whichever slot is actually next, and the sentence names the
       club still to be tapped rather than assuming the drill was followed in order. */
    const armed = s.swapFrom;
    const nextIdx = s.swapDone ? -1
      : armed === null ? d.bench
      : (armed === d.bench ? d.starter : d.bench);
    const a = clubOf(s, s.squad[d.bench]);
    const nextClub = nextIdx < 0 ? null : clubOf(s, s.squad[nextIdx]);
    const msg = s.swapDone
      ? '<span class="tut-ok">' + T(s, "tutSwOk") + "</span>"
      : (armed === null
          ? T(s, "tutSwDo1", { a: clubName(s, a) })
          : T(s, "tutSwDo2", { b: nextClub ? clubName(s, nextClub) : "" }));
    body = '<h2 class="tut-h">' + T(s, "tutSwTtl") + "</h2>"
      + '<p class="tut-p">' + T(s, "tutSwBody") + "</p>"
      + live(msg)
      + pitch(s, nextIdx, -1)
      + (s.swapDone
          ? btn(T(s, "tutSwCta"), "NEXT", "tut-cta", null, " data-tut-focus")
          : btn(T(s, "tutSwPass"), "NEXT", "tut-sec"));
  }

  else if (s.step === "captain") {
    const cc = clubOf(s, s.captain);
    body = '<h2 class="tut-h">' + T(s, "tutCapTtl") + "</h2>"
      + '<p class="tut-p">' + T(s, "tutCapBody") + "</p>"
      + (cc ? live(T(s, "tutCapPre", { club: clubName(s, cc) })) : "")
      + '<div class="tut-caps">' + s.squad.slice(0, s.startSize).map(id => {
          const c = clubOf(s, id); if (!c) return "";
          return '<button type="button" class="tut-cap' + (s.captain === id ? " on" : "") + '"'
            + ' data-tut-act="CAP" data-tut-arg="' + esc(id) + '"'
            + ' aria-pressed="' + (s.captain === id ? "true" : "false") + '"'
            + ' aria-label="' + esc(tutT("tutCapAria", s.lang).split("{club}").join(clubName(s, c))) + '">'
            + tutKit(c, "k34") + '<span class="tut-nm">' + esc(clubName(s, c)) + "</span>"
            + '<span class="tut-arm" aria-hidden="true">C</span></button>';
        }).join("") + "</div>"
      + btn(T(s, "tutCapCta"), "NEXT", "tut-cta", null, " data-tut-focus");
  }

  else if (s.step === "round") {
    const g = s.gw || {};
    /* prefer gameweek.js's own rendering when the host supplies it — this module
       does not own the round, it only makes room for it. */
    const lineHtml = g.lineHtml ? String(g.lineHtml)
      : (g.from && g.to
          ? T(s, "tutGwLine", { from: pair(s, g.from), to: pair(s, g.to) })
          : T(s, "tutGwLineNd"));
    body = '<h2 class="tut-h">' + T(s, "tutGwTtl", { n: g.no != null ? g.no : 1 }) + "</h2>"
      + '<p class="tut-p tut-p--gw">' + lineHtml + "</p>"
      + (g.lock ? '<p class="tut-lock">' + T(s, "tutGwLock", { when: pair(s, g.lock) }) + "</p>" : "")
      + '<p class="tut-note">' + T(s, "tutGwBody") + "</p>"
      + btn(T(s, "tutGwCta"), "NEXT", "tut-cta", null, " data-tut-focus");
  }

  else { /* hook */
    const cc = clubOf(s, s.captain), g = s.gw || {};
    body = '<h2 class="tut-h">' + T(s, "tutHkTtl") + "</h2>"
      + '<div class="tut-hook">'
      + tutKit(cc, "k60")
      + '<p class="tut-hkline">'
        + (g.fixture
            ? T(s, "tutHkLine", { club: clubName(s, cc), when: pair(s, g.fixture) })
            : T(s, "tutHkLineNt", { club: clubName(s, cc) }))
      + "</p>"
      + '<p class="tut-x2"><span dir="ltr">&#215;2</span> ' + T(s, "tutHkX2") + "</p>"
      + "</div>"
      + '<p class="tut-p">' + T(s, "tutHkWhy") + "</p>"
      + btn(T(s, "tutHkCta"), "DONE", "tut-cta", null, " data-tut-focus");
  }

  return '<div class="tut" data-tut-step="' + esc(s.step) + '">' + head + body + back + "</div>";
}

const TUT = Object.freeze({
  TUT_STR, TUT_STEPS, tutSteps, tutInit, tutReduce, tutHtml, tutProgressHtml,
  tutT, tutFill, tutBuildSquad, tutIsLegal, tutFavouritePool, tutKit
});

return {
  TUT_STR, TUT_STEPS, tutSteps, tutInit, tutReduce, tutHtml, tutProgressHtml,
  tutT, tutFill, tutBuildSquad, tutIsLegal, tutFavouritePool, tutKit, TUT
};
});
