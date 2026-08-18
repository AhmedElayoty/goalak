/* ============================================================================
   GOALLAK FANTASY — THE FIRST-RUN TUTORIAL  (v2: teach by doing)
   Design rationale: design/fantasy-tutorial-v2.md
   Sources honoured: fantasy-usability.md (the beginner study), fantasy-ui.md
   §C.1/§C.2/§C.3, fantasy-gameweek-explained.md §D, fantasy-engagement.md §E,
   fantasy-artdirection.md §G, fantasy-design.md §1.7/§12.2 (the chips).

   ----------------------------------------------------------------------------
   WHAT CHANGED IN v2, AND WHY
   ----------------------------------------------------------------------------
   v1 generated a complete fifteen-club squad with tutBuildSquad(), showed it to
   the player, taught ONE swap gesture on it, and never mentioned the chips. The
   host then threw that squad away and handed over an empty pitch, so the lesson
   had no connection to the team the player actually ended up with — he watched
   a team being handed to him, then found himself alone in front of 126 clubs.

   The owner's instruction, twice, verbatim:
     "the tutorial should start with the pitch empty! and then accurately guide
      the player on how to put the team and how to choose wild cards — step by
      step, when he makes it he goes to the next step!"

   So v2 is a BUILDER, not a slideshow. The pitch starts empty, the player fills
   it himself with the real picker, and the fifteen clubs he chooses here are the
   fifteen he owns when the sheet closes. Nothing is generated. tutBuildSquad(),
   tutFavouritePool() and the whole seeded-LCG apparatus are GONE — a squad this
   module invents is exactly the thing being removed, and keeping a dead builder
   "just in case" is how the throwaway team came back the first time.

   THE GATE RULE — the spine of the design
     A step that teaches an ACTION renders no way forward until the action has
     been performed. There is no "Next" that skips a lesson. Concretely:
       · the forward CTA is only emitted when the step's gate is satisfied;
       · NEXT on an unsatisfied gate returns the state UNCHANGED (no throw, no
         nag, no error state — the button simply is not there to press);
       · the moment a picking gate flips from unmet to met, the reducer moves to
         the next step by itself ("when he makes it he goes to the next step").
     Skip is exempt and always present: one tap, from any step, at any time.

     Auto-advance is used where the task is a COUNT (1 club, 11 clubs, 15 clubs)
     and deliberately NOT used where the task is a CHOICE the player may want to
     revise before committing (the captain, the chips). Choices reveal the CTA
     instead. Auto-advancing a captain tap would punish a player who tapped a
     card to read it.

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
       TUT_STEPS                                 frozen array of the 8 step ids, in order
       TUT_CHIPS                                 frozen catalogue of the 4 chip families

       tutInit(opts)                  -> state   pure factory. The squad starts EMPTY unless
                                                 the host hands one over (opts.squad), which
                                                 only the settings-sheet REPLAY does — see §5
       tutReduce(state, action)       -> state   the state machine; returns a NEW state
       tutHtml(state)                 -> string  the whole sheet body for the current step
       tutProgressHtml(state, focus)  -> string  just the dots + skip row
       tutT(key, lang)                -> string  raw, unescaped — for aria-label/title
       tutFill(key, lang, vars)       -> string  escaped HTML, numbers wrapped dir="ltr"
       tutIsLegal(squad, input)       -> {ok, errors[], spend}
       tutBudget(state)               -> {spend, remaining, slotsLeft, reserve, maxNext}
       tutBlockReason(state, club)    -> TUT_STR key, or null when the club is pickable
       tutGateMet(state)              -> bool    is this step's lesson done?
       tutKit(club, size)             -> string  identical markup to the app's kitHtml()
       TUT                            -> frozen namespace holding all of the above

   WHICH ELEMENT TO MOUNT INTO
     #wizBox — the existing wizard sheet body. tutHtml() returns a fragment, not
     a sheet: it renders its own .tut wrapper and expects the host's .wizsheet /
     #wiz scrim around it, unchanged. Nothing else in the app is touched.

       function tutMount(){ document.getElementById("wizBox").innerHTML = tutHtml(TS); }

   WHICH STR KEYS TO MERGE
     Object.assign(STR, TUT_STR);
     Every key is tut-prefixed. Nothing in TUT_STR collides with the app's STR,
     with GW_STR, or with CHIP_STR.

     RETIREMENTS this module asks for — the wizard keys it replaces:
       wiz1h wiz1p wiz2h wiz2p wiz3h wiz3hEn wiz3p wiz4h wiz4p are all retired.
       `skip` is retired: "تخطى" is past-tense third-person and reads as a
       grammatical error (usability §F.1). tutSkip = "بعدين".
     REUSED UNCHANGED, not redefined:
       benchLab, capNote, autoPick, gotIt, done — the app already owns these and
       this module deliberately does not shadow them.

     TWO DELIBERATE DUPLICATE SETS, both of which must stay byte-identical to
     their owners, and both of which the test suite compares character by
     character against the original so they cannot drift:
       · tutGwLine is fxWizGw from fantasy-gameweek-explained.md §D.2 (G2). If
         gameweek.js is present, prefer it: pass opts.gw.lineHtml.
       · tutChip*        are fxChipWildcard / fxChipFreehit / fxChipTripcap /
         tutChip*Eff       fxChipFullsquad and their Eff/When lines from
         tutChip*When      chips.js. The tutorial must be able to teach the chips
                           with chips.js absent (it is a separate bundle entry
                           and the tutorial is the FIRST thing a user sees), so
                           it carries its own copy rather than a hard dependency.
                           tutorial.test.mjs asserts equality with CHIP_STR.

   WHAT THE HOST MUST CALL ON EACH ACTION
     Every interactive element carries data-tut-act (and sometimes data-tut-arg).
     Bind ONE delegated listener; there are no inline handlers, because these
     functions are pure.

       host.onclick = e => {
         const el = e.target.closest("[data-tut-act]");  if(!el) return;
         const wasStep = TS.step, wasTop = host.scrollTop;
         TS = tutReduce(TS, {type: el.dataset.tutAct, arg: el.dataset.tutArg});
         if(TS.done){                                   // 1. COMMIT — his own team
           squad = TS.squad.slice(); captain = TS.captain; save();
           closeWizard(); return;
         }
         tutMount();                                    // 2. RE-RENDER
         // 3. A LIVE PICKER MUST NOT JUMP. Only reset the scroll and move focus
         //    when the STEP changed; a pick inside a 126-row list is a re-render
         //    of the same step and must leave the list exactly where it was.
       };

     On the language toggle:  TS = tutReduce(TS, {type:"LANG", arg: LANG}); tutMount();
     The [data-tut-live] node is an aria-live="polite" region; re-rendering it is
     the whole announcement contract. Nothing else is required.

     Actions the host may dispatch:
       NEXT BACK SKIP PICK DROP FILTER CAP CHIP DONE LANG
     Any unknown action returns the state unchanged, and so does any action the
     current step does not accept (PICK on the captain step changes nothing).

   PURITY CONTRACT
     Every function takes state and returns a value. No DOM access, no global
     reads, no Date.now(), no Math.random(), no network, no localStorage, no
     mutation of anything passed in. `lang` always lives in state — the module
     never reads LANG. There is no randomness left in the module at all, which is
     a v2 simplification: with nothing generated there is nothing to seed.

   ESCAPING
     Nothing reaches the output un-escaped. tutFill() escapes the template FIRST
     and then substitutes already-escaped values, so a club named
     `<img onerror=…>` renders as text. The only markup this module emits is
     markup it wrote. No string in TUT_STR contains a "<".

   HOUSE RULES OBSERVED
     Arabic-first, RTL default. Western digits only (num()). Every Latin or
     numeric run is individually dir="ltr" wrapped. No images, no SVG, no
     external assets. Logical CSS only — this file emits no inline style that
     names a physical direction (the only inline style it emits at all is an
     `inline-size` percentage on the budget bar fill).

   WHAT THIS MODULE DELIBERATELY DOES NOT DO
     · No auto-fill / "pick for me" button. It is one line of code and it undoes
       the entire instruction; the player who wants a fast team has Skip, which
       is honest about handing him an empty pitch he owns.
     · No fixture check on a club (the app's blockReason() refuses a club with no
       match this round). That needs live fixture data the module has no access
       to and must never invent; the app re-checks on its own picker afterwards.
     · No formation control. The formation in the build is cosmetic (engagement
       §A.5, usability #17) and a tutorial must never teach a decision that does
       not exist.
     · No points, anywhere. The season starts 21 Aug 2026 and has not started,
       so every number in here is a RULE or a PRICE, never a score.

   COACH-MARK BUDGET
     This module requests ZERO coach marks. The budget stays at nine
     (fantasy-ui.md §C.3). CM-1 still fires on the first view of My Team AFTER
     the tutorial closes.
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

/* ---------------------------------------------------------------------------
   1. STRINGS
   Arabic is Egyptian-inflected throughout. The usability study's §F audit is the
   spec: مفيش not مافي, خليه not اجعله, بعدين not تخطى, مالوش ماتش not لا يلعب.
   Western digits inside the strings, never Arabic-Indic. No string contains
   markup — emphasis is a separate element, so tutFill() can escape whole.
   --------------------------------------------------------------------------- */
const TUT_STR = {

  /* ---- chrome, present on every step ---- */
  /* "بعدين" is "later", and as of v6.14 that is finally what the button does: the host only
     marks onboarding finished once the manager actually HAS a squad, so putting the tutorial
     off means it is offered again next time he opens the game. The English said "Skip",
     which described the old behaviour and would now be a small lie. */
  tutSkip:      ["بعدين", "Later"],
  tutSkipAria:  ["سيب الشرح دلوقتي — هنعرضه تاني لما تفتح اللعبة",
                 "Leave the tutorial for now — we will offer it again next time"],
  tutBack:      ["رجوع", "Back"],
  tutStepAria:  ["خطوة {n} من {total}", "Step {n} of {total}"],

  /* ---- step 1 · الترحيب ----
     The study called «مش هتختار لاعيبة — هتختار أندية» the single best sentence
     in the product. It was the third line of a paragraph. It is the headline.
     The scoring numbers are the measured ones: win +6, each goal +2, clean sheet
     +3 (fantasy-scoring-5season.md). No total is quoted, because no total
     exists yet — the season starts 21 Aug 2026. */
  tutW1Ttl:  ["مش هتختار لاعيبة — هتختار أندية", "You don't pick players — you pick clubs"],
  tutW1Body: ["كل نادي في فريقك بيجيب لك نقط من نتايجه الحقيقية: الفوز 6، وكل جول 2، والشباك النضيفة 3. مفيش لاعيبة، ومفيش إصابات.",
              "Every club in your team earns you points from its real results: a win is 6, each goal 2, a clean sheet 3. No players, no injuries."],
  tutW1Note: ["الملعب فاضي دلوقتي، وإنت اللي هتملاه — نادي نادي.",
              "The pitch is empty right now, and you are the one who fills it — club by club."],
  tutW1Cta:  ["يلا نبدأ", "Let's go"],

  /* ---- step 2 · أول نادي ----
     Restores fantasy-ui.md §C.1.3 + §C.1.4 without restoring the machine that
     came with them. The study's 0:24 deflation was "the app built him a team and
     did not put his club in it"; the fix is not a better generator, it is
     letting him type the first name himself. */
  tutP1Ttl:  ["ابدأ بنادي بتحبه", "Start with a club you love"],
  tutP1Body: ["الملعب قدامك فاضي. دوس على أي نادي من اللستة وهتلاقيه نزل الملعب على طول.",
              "The pitch in front of you is empty. Tap any club in the list and you will see it land on the pitch."],
  tutP1Live: ["مستني أول نادي.", "Waiting for your first club."],
  tutP1Ok:   ["{club} بقى في فريقك.", "{club} is in your team now."],
  tutP1Cta:  ["كمّل", "Keep going"],

  /* ---- step 3 · الميزانية ----
     Taught at the moment the number first matters: he has just spent money, so
     "المتبقي" on the bar above is now a number that moved.

     THE PRICING IS NOT EXPLAINED, ON THE OWNER'S INSTRUCTION. The four dearest
     clubs cost 125.5M against a 120.0M budget, so all four can never fit — that
     is the single real puzzle the budget sets, and a tutorial that states the
     answer has taken the game's only secret and given it away on screen three.
     He finds it himself, at the moment the fourth one will not go in. */
  tutBgTtl:  ["120 مليون، و15 نادي", "120M, and 15 clubs"],
  tutBgBody: ["الميزانية 120 مليون تشتري بيها 15 نادي: 11 في الملعب و4 على الدكة. مش فلوس حقيقية — دي بس اللي بتوزن بيها اختياراتك.",
              "Your budget is 120M and it buys 15 clubs: 11 on the pitch and 4 on the bench. It is not real money — it is what balances your choices."],
  tutBgBig:  ["مش كل حاجة نفسك فيها هتعرف تشتريها. ده بالظبط اللي بيخلّي الاختيار اختيار.",
              "You will not be able to afford everything you want. That is exactly what makes choosing a choice."],
  tutBgP1:   ["126 نادي من 7 دوريات", "126 clubs from 7 leagues"],
  tutBgP2:   ["3 أندية بالكتير من الدوري الواحد", "Max 3 from any one league"],
  tutBgP3:   ["أرخص نادي 4.5 مليون", "The cheapest club is 4.5M"],
  tutBgP4:   ["11 في الملعب و4 على الدكة", "11 on the pitch, 4 subs"],
  tutQuickCta: ["كمّل الفريق تلقائي", "Build the rest for me"],
  tutQuickNote: ["هنكمّل باقي الفريق حواليه، وتقدر تغيّر أي حاجة بعدين.",
                 "We will build the rest around it — you can change anything afterwards."],
  tutBgCta:  ["فهمت", "Got it"],

  /* ---- step 4 · الـ11 ---- */
  tutXiTtl:  ["كمّل الـ11", "Fill your eleven"],
  tutXiBody: ["الـ11 دول هم اللي بيجمعوا لك نقط كل جولة. اختار اللي إنت شايف إنهم هيكسبوا.",
              "These eleven are the clubs that score for you every round. Pick the ones you think will win."],
  tutXiLive: ["{n} من 11 · باقي {m}", "{n} of 11 · {m} to go"],
  /* «باقي 0» is not a count, it is a bug with a number in it. The finished state
     gets its own sentence in both places the counter can reach zero. */
  tutXiFull: ["تمام — الـ11 كملوا.", "That is your eleven."],
  tutXiCta:  ["الـ11 كملوا", "My eleven is complete"],

  /* ---- step 5 · الدكة ----
     The two numbers are measured over the 36-round backtest in
     fantasy-scoring-backtest.md: a club with no fixture returns 0 where the
     average club returns 6.85, and a season played with no usable bench forfeits
     183 points. This is the one place a beginner underestimates the rules, so it
     gets the arithmetic rather than an adjective. */
  tutBnTtl:  ["الدكة · 4 أندية كمان", "The bench · four more clubs"],
  tutBnBody: ["لو نادي من الـ11 مالوش ماتش في الجولة، بياخد صفر. ساعتها بديل من الدكة بيدخل مكانه لوحده من غير ما تعمل حاجة.",
              "If a club in your eleven has no match in a round, it scores zero. A substitute then comes on in its place automatically, with no action from you."],
  tutBnFact: ["النادي اللي مالوش ماتش بيكلفك 6.85 نقطة في المتوسط، وموسم كامل من غير دكة شغالة بيضيع 183 نقطة.",
              "A club with no match costs you 6.85 points on average, and a whole season with no working bench forfeits 183 points."],
  tutBnLive: ["{n} من 15 · باقي {m} للدكة", "{n} of 15 · {m} more for the bench"],
  tutBnFull: ["الفريق كمل — 15 نادي.", "Your squad is complete — 15 clubs."],
  tutBnCta:  ["الفريق كمل", "My squad is complete"],

  /* ---- step 6 · الكابتن ----
     The rule as arithmetic, per fantasy-ui.md §C.1.6 fxWiz5Sub. And the rule the
     shipped captain sheet was missing: a benched captain pays exactly nothing,
     measured at 302 points against 348 for the best legal one. */
  tutCapTtl:  ["الكابتن بياخد ضعف النقط", "Your captain scores double"],
  tutCapBody: ["نادي واحد بس، ولازم يكون من الـ11 اللي في الملعب. لو جاب 12، تاخد 24. دوس على النادي اللي واثق فيه.",
               "One club only, and it has to be one of the eleven on the pitch. If it scores 12, you get 24. Tap the club you trust."],
  tutCapLive: ["لسه ما اخترتش كابتن.", "You have not chosen a captain yet."],
  tutCapOk:   ["{club} هو الكابتن بتاعك.", "{club} is your captain."],
  tutCapCta:  ["تمام", "Done"],
  tutCapAria: ["خلي {club} الكابتن", "Make {club} captain"],

  /* ---- step 7 · الجوكرات ----
     The owner asked for this by name twice and v1 taught it nowhere. Eight
     chips, two of each family, one per half (fantasy-design.md §1.7, §12.2 —
     there is NO fifth family). The four name/effect/when lines below are
     byte-identical copies of chips.js; see the header note. */
  tutChTtl:  ["الجوكرات", "Chips"],
  tutChBody: ["8 جوكرات في الموسم: اتنين من كل نوع، واحد في كل نص. وجوكر واحد بس في الجولة الواحدة.",
              "Eight chips a season: two of each kind, one in each half. And only one chip in any single round."],
  tutChTap:  ["دوس على أي جوكر عشان تعرف بيعمل إيه.", "Tap any chip to see what it does."],
  tutChSeen: ["كده عرفت. تقدر تفتح الباقي، أو تكمل.", "Now you know. Open the rest, or carry on."],
  tutChWhere:["هتلاقيهم في «الجوكرات» تحت في أي وقت — مش لازم تستخدم حاجة دلوقتي.",
              "You will find them under Chips at the bottom whenever you want — you do not have to use one now."],
  tutChCta:  ["تمام", "Done"],
  tutChAria: ["{chip}. دوس عشان تشوف بيعمل إيه.", "{chip}. Tap to see what it does."],
  tutChPer:  ["مرتين في الموسم", "Twice a season"],

  /* the four families — VERBATIM from chips.js CHIP_STR, asserted equal by the
     test suite. Do not improve one copy without improving the other. */
  tutChipWc:      ["تغيير شامل", "Wildcard"],
  tutChipWcEff:   ["كل انتقالاتك في الجولة دي ببلاش — غيّر اللي إنت عايزه من غير خصم −4.",
                   "Every transfer you make this round is free — change whatever you like with no −4."],
  tutChipWcWhen:  ["استخدمه لما تحب تغيّر نص فريقك مرة واحدة.",
                   "Use it when you want to rebuild half your squad at once."],
  tutChipFh:      ["فريق مؤقت", "Free Hit"],
  tutChipFhEff:   ["انتقالات مفتوحة لجولة واحدة بس. وفي الإقفال الجاي فريقك بيرجع زي ما كان بالظبط.",
                   "Unlimited transfers for one round only. At the next deadline your squad goes back exactly as it was."],
  tutChipFhWhen:  ["استخدمه في الجولة اللي أغلب أنديتك مالهاش ماتش فيها.",
                   "Use it in a round where most of your clubs have no match."],
  tutChipTc:      ["الكابتن الثلاثي", "Triple Captain"],
  tutChipTcEff:   ["نقاط الكابتن ×3 بدل ×2 في الجولة دي.",
                   "Your captain scores ×3 instead of ×2 this round."],
  tutChipTcWhen:  ["استخدمه لما كابتنك يلعب ماتشين في جولة واحدة.",
                   "Use it when your captain plays twice in one round."],
  tutChipFs:      ["الفريق الكامل", "Full Squad"],
  tutChipFsEff:   ["البدلاء الأربعة كلهم بيجيبوا نقط في الجولة دي، مش بس اللي بيدخل بدل نادي مالوش ماتش.",
                   "All four of your substitutes score this round, not just the one covering a club with no match."],
  tutChipFsWhen:  ["استخدمه في الجولة اللي الخمستاشر نادي كلهم لاعبين فيها.",
                   "Use it in a round where all fifteen of your clubs have a match."],

  /* ---- step 8 · خلصنا ----
     tutGwLine is fxWizGw, verbatim. See the header note. */
  tutDnTtl:    ["فريقك جاهز", "Your team is ready"],
  tutGwLine:   ["الجولة الأولى: من {from} لـ {to}. كل ماتش تلعبه أنديتك فيها بيتحسب لك.",
                "Round 1: {from} to {to}. Every match your clubs play in it counts for you."],
  tutGwLineNd: ["كل ماتش تلعبه أنديتك في الجولة دي بيتحسب لك.",
                "Every match your clubs play in this round counts for you."],
  tutDnLock:   ["الجولة {n} بتقفل {when}", "Round {n} locks {when}"],
  tutDnBody:   ["أول ما الجولة تبدأ بتتقفل، ومش هتقدر تغيّر فيها فريقك ولا الكابتن. قبل كده غيّر زي ما إنت عايز.",
                "A round locks the moment it starts, and after that you cannot change your team or your captain in it. Before that, change whatever you like."],
  tutDnSeason: ["الموسم 36 جولة، من {a} لحد {b}.", "The season is 36 rounds, {a} to {b}."],
  tutDnNoPts:  ["الموسم لسه ما بدأش، فمفيش نقط لحد دلوقتي — ولا ليك ولا لغيرك.",
                "The season has not started, so there are no points yet — not yours and not anyone else's."],
  tutDnCta:    ["يلا نشوف الملعب", "Take me to the pitch"],

  /* ---- the picker, the board and the money ---- */
  tutPkAll:    ["الكل", "All"],
  tutPkFilter: ["صفّي بالدوري", "Filter by league"],
  tutPkAdd:    ["ضيف {club} بـ {price} مليون", "Add {club} for {price}M"],
  tutPkDrop:   ["شيل {club} من فريقك", "Remove {club} from your team"],
  tutPkNone:   ["مفيش نادي تقدر تضيفه من الدوري ده دلوقتي.", "No club from this league can be added right now."],
  tutBudLeft:  ["المتبقي", "Remaining"],
  tutBudSlots: ["أماكن فاضية", "Slots left"],
  tutBudNext:  ["أغلى نادي تقدر تشتريه", "Max for your next club"],
  tutWhyFull:  ["فريقك كمل", "Your squad is full"],
  tutWhyLeague:["عندك 3 أندية من الدوري ده", "3 clubs from this league already"],
  tutWhyMoney: ["أغلى من اللي فاضل معاك", "Over your remaining budget"],
  tutLabPitch: ["الملعب", "The pitch"],
  tutLabBench: ["الدكة · بيدخلوا لوحدهم لو ناديك مالوش ماتش",
                "The bench · they come on automatically when a starter has no match"],
  tutSlotAria: ["{club} · {price} مليون", "{club} · {price}M"]
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
   Eight. Six of them are gated on something the player physically does.

     welcome  — read one sentence            (the mental model)
     first    — pick a club                  GATE: squad >= 1
     budget   — read the four rules          (taught when the number first moved)
     eleven   — pick until eleven            GATE: squad >= 11
     bench    — pick four more               GATE: squad >= 15
     captain  — appoint one of the eleven    GATE: a starting captain exists
     chips    — open a chip and read it      GATE: at least one chip opened
     done     — the deadline, then the pitch (commits what HE picked)
   --------------------------------------------------------------------------- */
const TUT_STEPS = Object.freeze(["welcome", "first", "budget", "eleven", "bench", "captain", "chips", "done"]);
function tutSteps() { return TUT_STEPS.slice(); }
const stepIndex = id => TUT_STEPS.indexOf(id);

/* The chip catalogue. Four families, two instances each, eight chips — the
   rules page lists exactly four and bootstrap-static.chips holds exactly eight
   entries across four names. Any design with a fifth is working from an older
   season. glyph is a typographic mark, never an image and never an emoji; two
   of them ARE the rule (×3, +4), which fantasy-ui.md §J row 11 asks for
   explicitly: do not name the chip, show the arithmetic. */
const TUT_CHIPS = Object.freeze([
  Object.freeze({ id: "wildcard",  glyph: "⇄",  ltr: false, name: "tutChipWc", eff: "tutChipWcEff", when: "tutChipWcWhen" }),
  Object.freeze({ id: "freehit",   glyph: "⟲",  ltr: false, name: "tutChipFh", eff: "tutChipFhEff", when: "tutChipFhWhen" }),
  Object.freeze({ id: "tripcap",   glyph: "×3", ltr: true,  name: "tutChipTc", eff: "tutChipTcEff", when: "tutChipTcWhen" }),
  Object.freeze({ id: "fullsquad", glyph: "+4", ltr: true,  name: "tutChipFs", eff: "tutChipFsEff", when: "tutChipFsWhen" })
]);

/* ---------------------------------------------------------------------------
   4. THE RULES ENGINE
   The same four rules the app's own picker enforces, computed from state so the
   tutorial can never let a player build something the app would then reject.
   There is no builder here any more — only a referee.
   --------------------------------------------------------------------------- */
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

/* tutIsLegal — the same rules the picker enforces, checkable from the outside.
   The test asserts this; so does the host, before it commits. */
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

const clubOf = (s, id) => s.clubs.find(x => x.id === id) || null;
const priceOf = (s, id) => { const p = s.price(id); return typeof p === "number" && isFinite(p) ? p : 0; };
const spendOf = s => +s.squad.reduce((a, id) => a + priceOf(s, id), 0).toFixed(1);
const leagueCount = (s, lg) => s.squad.filter(id => { const c = clubOf(s, id); return c && c.lg === lg; }).length;

/* the price-ascending pool of everything not owned, computed ONCE per render and
   handed down. Without it every one of 126 rows re-sorts 126 clubs to answer
   "can this still be finished", which is 126 sorts for one repaint of one list. */
function poolAsc(s) {
  return s.clubs.filter(x => s.squad.indexOf(x.id) < 0)
                .slice().sort((a, b) => priceOf(s, a.id) - priceOf(s, b.id));
}

/* THE RESERVE HAS TO RESPECT THE LEAGUE CAP. `slots * minPrice` assumes the floor price is
   always available, and with a maximum of three clubs per league it often is not: after the
   five-season reprice only eleven clubs sit at 4.5 and they span four leagues, so the twelfth
   cheap slot costs 5.0 or more. The optimistic version lets a pick look affordable and then
   strands the squad a club short with money left over — which is the single most expensive
   bug this screen can ship, because it happens 14 taps in. */
function cheapestFill(s, n, extraId, pool) {
  if (n <= 0) return 0;
  const p = pool || poolAsc(s);
  const cnt = {};
  for (const id of s.squad) { const c = clubOf(s, id); if (c) cnt[c.lg] = (cnt[c.lg] || 0) + 1; }
  if (extraId) { const c = clubOf(s, extraId); if (c) cnt[c.lg] = (cnt[c.lg] || 0) + 1; }
  let tot = 0, got = 0;
  for (const x of p) {
    if (got >= n) break;
    if (extraId && x.id === extraId) continue;
    if ((cnt[x.lg] || 0) >= s.maxPerLeague) continue;
    cnt[x.lg] = (cnt[x.lg] || 0) + 1; tot += priceOf(s, x.id); got++;
  }
  return got < n ? Infinity : +tot.toFixed(1);
}

/* everything the money strip needs, in one pass, so the strip and the row guards
   can never disagree about what is affordable. */
function tutBudget(s, pool) {
  const p = pool || poolAsc(s);
  const spend = spendOf(s);
  const slotsLeft = Math.max(0, s.size - s.squad.length);
  const reserve = cheapestFill(s, Math.max(0, slotsLeft - 1), null, p);
  const remaining = +(s.budget - spend).toFixed(1);
  const maxNext = slotsLeft <= 0 || !isFinite(reserve) ? 0 : +(remaining - reserve).toFixed(1);
  return { spend: spend, remaining: remaining, slotsLeft: slotsLeft, reserve: reserve, maxNext: maxNext };
}

/* why a club cannot be picked — printed ON the row, so there is no error state
   and no tap that does nothing without saying why. Returns a TUT_STR key. */
function tutBlockReason(s, club, pool) {
  if (!club) return null;
  if (s.squad.indexOf(club.id) >= 0) return null;              /* owned: removable, not blocked */
  if (s.squad.length >= s.size) return "tutWhyFull";
  if (leagueCount(s, club.lg) >= s.maxPerLeague) return "tutWhyLeague";
  const p = pool || poolAsc(s);
  const rest = cheapestFill(s, s.size - s.squad.length - 1, club.id, p);
  if (spendOf(s) + priceOf(s, club.id) + rest > s.budget + 1e-9) return "tutWhyMoney";
  return null;
}

/* BUILD THE REST AROUND WHAT HE ALREADY CHOSE.
   Fifteen taps is the whole squad and it turns a game into data entry. The owner's answer, and
   it is the right one: let him name the one or two clubs he actually cares about, then fill the
   rest for him and let him change anything. It is also what the Premier League's own game
   shipped in 2026 - guided questions, a generated squad, and a "try again".

   It fills by VALUE, not by fame. The previous generator ranked candidates on a `fame` field
   that the scoring engine never reads, and the squad it produced finished last of six in a
   measured season. Value here is the club's own strength per million, which is the same number
   the scoring actually pays out on.

   The clubs he chose are never touched, never reordered out of the eleven, and never dropped
   to make the budget work - they are the reason he is here. */
function tutQuickFill(s) {
  if (s.squad.length >= s.size) return s;
  const pool = poolAsc(s);
  /* Strength is what the game pays out on. Where it is missing, PRICE is the honest proxy -
     the five-season backtest puts price against real points at r = 0.967 - and using 1/price
     instead built the cheapest legal squad in the game and handed back 50M. */
  const strOf = id => {
    const st = s.strength && s.strength[String(id)];
    return st != null ? st : priceOf(s, id);
  };
  const value = id => strOf(id) / (priceOf(s, id) || 1);
  let squad = s.squad.slice();
  let guard = 0;
  while (squad.length < s.size && guard++ < 400) {
    const trial = Object.assign({}, s, { squad: squad });
    const cands = s.clubs.filter(c => squad.indexOf(c.id) < 0 && !tutBlockReason(trial, c, pool));
    if (!cands.length) break;
    /* best value first, and a cheap tiebreak so two equal clubs do not always resolve the
       same way and every generated squad looks identical */
    cands.sort((a, b) => value(b.id) - value(a.id) || priceOf(s, a.id) - priceOf(s, b.id));
    squad.push(cands[0].id);
  }
  /* SPEND THE BUDGET. Ranking purely on value fills the squad with the cheapest efficient
     clubs and hands back money - 114.0M of 120.0M in the first test - which is both weaker and
     reads as a mean team. Upgrade the worst slot he did not choose, as long as the money is
     there and the swap raises real strength. His own picks are never touched. */
  let up = 0;
  while (up++ < 60) {
    const spent = squad.reduce((acc, id) => acc + priceOf(s, id), 0);
    const left = s.budget - spent;
    if (left < 0.5) break;
    let best = null;
    for (const out of squad) {
      if (s.squad.indexOf(out) >= 0) continue;                 /* never his own choice */
      const without = squad.filter(x => x !== out);
      const trial = Object.assign({}, s, { squad: without });
      for (const c of s.clubs) {
        if (without.indexOf(c.id) >= 0) continue;
        if (priceOf(s, c.id) > priceOf(s, out) + left + 1e-9) continue;
        if (tutBlockReason(trial, c, pool)) continue;
        const gain = strOf(c.id) - strOf(out);
        if (gain > 1e-9 && (!best || gain > best.gain)) best = { out: out, in: c.id, gain: gain };
      }
    }
    if (!best) break;
    squad = squad.map(x => x === best.out ? best.in : x);
  }

  /* the eleven are the dearest of what he now owns, with his own picks held at the front */
  const mine = s.squad.slice();
  const rest = squad.filter(id => mine.indexOf(id) < 0)
                    .sort((a, b) => priceOf(s, b) - priceOf(s, a));
  const ordered = mine.concat(rest);
  let t = next(s, { squad: ordered, quick: true });
  if (!t.captain) {
    const eleven = ordered.slice(0, t.startSize);
    const cap = eleven.slice().sort((a, b) => priceOf(s, b) - priceOf(s, a))[0];
    if (cap) t = next(t, { captain: cap });
  }
  return t;
}

/* ---------------------------------------------------------------------------
   5. STATE
   --------------------------------------------------------------------------- */
function tutInit(opts) {
  const o = opts || {};
  const clubs = o.clubs || [];
  const size = o.size != null ? o.size : 15;
  const startSize = o.startSize != null ? o.startSize : 11;
  /* THE PITCH STARTS EMPTY — that is the owner's instruction and it is the whole
     of v2. But `opts.squad` exists for ONE case: replaying the lesson from the
     settings sheet when the player already has a team. index.html says it in a
     comment older than this module — "replaying the lesson must not cost you your
     team" — and since v2 commits what the tutorial holds, an empty start there
     would delete fifteen clubs for the crime of wanting to read the walkthrough
     again. Handed a squad, the tutorial adopts it: every gate is already
     satisfied, so he taps through and reads, and can still drop and re-pick.
     A first run passes nothing and the pitch is empty. Unknown ids are dropped
     and the list is clamped, because this is the one input that arrives from
     localStorage and may be stale. */
  const seed = Array.isArray(o.squad)
    ? o.squad.map(String).filter((id, i, a) => a.indexOf(id) === i && clubs.some(c => c.id === id)).slice(0, size)
    : [];
  const cap = o.captain != null && seed.slice(0, startSize).indexOf(String(o.captain)) >= 0 ? String(o.captain) : null;
  return Object.freeze({
    step: "welcome",
    lang: o.lang === "en" ? "en" : "ar",
    clubs: clubs,
    leagues: o.leagues || [],
    price: o.price || (() => 8),
    size: size,
    startSize: startSize,
    budget: o.budget != null ? o.budget : 120.0,
    maxPerLeague: o.maxPerLeague != null ? o.maxPerLeague : 3,
    /* calibrated per-club strength, so the quick build ranks by what the game pays out on */
    strength: o.strength || null,
    minPrice: o.minPrice != null ? o.minPrice : 4.5,
    gw: o.gw || null,   /* {no, from:[ar,en], to:[ar,en], lock:[ar,en], seasonFrom, seasonTo, rounds, lineHtml} */
    squad: seed,
    captain: cap,
    filter: "all",
    chipOpen: null,      /* which chip card is expanded right now (accordion) */
    chipsSeen: [],       /* which chips have EVER been opened — this is the gate */
    skipped: false,
    done: false
  });
}

const next = (s, patch) => Object.freeze(Object.assign({}, s, patch));

/* WHICH STEP ACCEPTS WHICH ACTION.
   A reducer that accepts every action from every step is a reducer whose state
   machine is a suggestion. PICK on the captain step would quietly buy a
   sixteenth club that no screen had shown; CAP on the bench step would appoint an
   armband before the captain lesson had happened. Both are reachable by a host
   bug or a stale re-render, and neither is reachable by a user, which is exactly
   the kind of divergence that gets shipped. NEXT / BACK / SKIP / DONE / LANG are
   accepted everywhere, because they are chrome, not lesson. */
const ACCEPTS = Object.freeze({
  PICK:   Object.freeze({ first: 1, eleven: 1, bench: 1 }),
  /* DROP reaches the captain step too. A quick-built squad is first SEEN in full there, and
     the copy promises "you can change anything afterwards" - a promise the reducer has to
     keep, not just the sentence. */
  DROP:   Object.freeze({ first: 1, eleven: 1, bench: 1, captain: 1 }),
  QUICK:  Object.freeze({ first: 1, budget: 1, eleven: 1, bench: 1 }),
  FILTER: Object.freeze({ first: 1, eleven: 1, bench: 1 }),
  CAP:    Object.freeze({ captain: 1 }),
  CHIP:   Object.freeze({ chips: 1 })
});
function stepAccepts(step, type) {
  const m = ACCEPTS[type];
  return !m || !!m[step];
}

/* Does the current step's lesson count as done? This is the whole gate rule in
   one function, so a new step cannot be added without declaring what it demands.
   Steps that teach no action answer true. */
function tutGateMet(s) {
  switch (s.step) {
    case "first":   return s.squad.length >= 1;
    case "eleven":  return s.squad.length >= s.startSize;
    case "bench":   return s.squad.length >= s.size;
    case "captain": return !!s.captain && s.squad.slice(0, s.startSize).indexOf(s.captain) >= 0;
    case "chips":   return s.chipsSeen.length >= 1;
    default:        return true;                    /* welcome, budget, done */
  }
}

function goto(s, id) {
  const i = stepIndex(id);
  if (i < 0) return s;
  let t = next(s, { step: id });
  /* an armband that is no longer on a starter is not an armband. The shipped
     build kept drawing it on a benched club that pays exactly nothing —
     measured 302 points against 348 for the best legal captain. */
  if (t.captain && t.squad.slice(0, t.startSize).indexOf(t.captain) < 0) t = next(t, { captain: null });
  return t;
}

/* a squad the app itself would accept, at the moment the sheet closes. Skip can
   hand over a PARTIAL squad (that is honest — he skipped), but never an illegal
   one and never a captain sitting on the bench. */
function settle(s) {
  const cap = s.captain && s.squad.slice(0, s.startSize).indexOf(s.captain) >= 0 ? s.captain : null;
  return next(s, { captain: cap });
}

function tutReduce(state, action) {
  const s = state, a = action || {};
  if (!stepAccepts(s.step, a.type)) return s;
  switch (a.type) {

    /* NEXT IS NOT A WAY OUT OF A LESSON. On a gated step with the gate unmet it
       returns the state untouched — and tutHtml does not render a CTA there in
       the first place, so this is belt and braces against a host that dispatches
       its own NEXT. */
    case "NEXT": {
      if (!tutGateMet(s)) return s;
      const i = stepIndex(s.step);
      if (i >= TUT_STEPS.length - 1) return next(settle(s), { done: true });
      return goto(s, TUT_STEPS[i + 1]);
    }

    case "BACK": {
      const i = stepIndex(s.step);
      return i <= 0 ? s : goto(s, TUT_STEPS[i - 1]);
    }

    /* One tap, from every step, always. A returning viewer — and the owner
       opening the link for the fifth time today — gets the pitch immediately.
       v1 handed him a generated team on the way out; v2 hands him exactly what
       he had picked when he pressed it, which for step 1 is nothing at all. An
       empty pitch is a state the app already handles (`pickFirst`), and it is
       the truth. */
    case "SKIP":
      return next(settle(s), { done: true, skipped: true });

    /* THE PICK. This is the whole tutorial. */
    case "PICK": {
      const id = a.arg == null ? "" : String(a.arg);
      const club = clubOf(s, id);
      if (!club) return s;
      if (s.squad.indexOf(id) >= 0) return s;
      if (tutBlockReason(s, club)) return s;          /* the guard, not the UI, is the rule */
      const squad = s.squad.concat([id]);
      const t = next(s, { squad: squad });
      /* "when he makes it he goes to the next step" — the count IS the gate, so
         the moment it lands the step is over. Only from the step that owns the
         gate: picking a twelfth club on the bench step must not re-fire the
         eleven step's transition. */
      if (s.step === "first"  && squad.length >= 1)           return goto(t, "budget");
      if (s.step === "eleven" && squad.length >= s.startSize) return goto(t, "bench");
      if (s.step === "bench"  && squad.length >= s.size)      return goto(t, "captain");
      return t;
    }

    /* A MISTAKE MUST NEVER BE FATAL. Fourteen taps in, a player who picked the
       wrong club and cannot undo it will close the tab. Tapping a club he owns —
       on the board or in the list — takes it back and refunds the money. */
    case "DROP": {
      const id = a.arg == null ? "" : String(a.arg);
      const i = s.squad.indexOf(id);
      if (i < 0) return s;
      const squad = s.squad.slice(); squad.splice(i, 1);
      let t = next(s, { squad: squad });
      if (t.captain && squad.slice(0, t.startSize).indexOf(t.captain) < 0) t = next(t, { captain: null });
      return t;
    }

    /* one tap: keep what he chose, fill the rest, and land him on the captain step with a
       complete legal squad he can still change entirely. */
    case "QUICK": {
      if (s.squad.length < 1) return s;            /* he must own at least one club first */
      if (s.squad.length >= s.size) return s;
      const t = tutQuickFill(s);
      if (t.squad.length < s.size) return t;       /* could not complete: leave him where he is */
      return goto(t, "captain");
    }

    case "FILTER": {
      const id = a.arg == null ? "all" : String(a.arg);
      if (id !== "all" && !s.leagues.some(l => l.id === id)) return s;
      return next(s, { filter: id });
    }

    /* only a club in the ELEVEN can take the armband. A bench captain scored 302
       against 348 for the best legal one — the armband was drawn on the card and
       paid nothing. */
    case "CAP": {
      const id = a.arg == null ? "" : String(a.arg);
      return s.squad.slice(0, s.startSize).indexOf(id) >= 0 ? next(s, { captain: id }) : s;
    }

    /* opening a chip is the chips lesson. Tapping the open one closes it; it
       stays in chipsSeen, because he did read it. */
    case "CHIP": {
      const id = a.arg == null ? "" : String(a.arg);
      if (!TUT_CHIPS.some(c => c.id === id)) return s;
      const seen = s.chipsSeen.indexOf(id) >= 0 ? s.chipsSeen : s.chipsSeen.concat([id]);
      return next(s, { chipOpen: s.chipOpen === id ? null : id, chipsSeen: seen });
    }

    case "DONE":
      return next(settle(s), { done: true });

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
const clubName = (s, c) => !c ? "" : (s.lang === "ar" && c.ar ? c.ar : (c.short || c.name || c.code || ""));
/* THE CARD FORM, and it is the app's own clubNameShort() rule, not a truncation.
   A board slot is at most 82px wide and twelve Arabic club names do not fit at
   any legible size — «باريس سان جيرمان» needs 81px of 66 — so those twelve carry
   an `arShort` that a commentator would actually say. Measured live in the
   tutorial before this existed: PSG ellipsed on the board. The picker LIST keeps
   the full name, because there it fits. */
const clubNameCard = (s, c) => !c ? ""
  : (s.lang === "ar" ? (c.arShort || c.ar || c.short || c.name || c.code || "") : (c.short || c.name || c.code || ""));
const priceStr = (s, id) => priceOf(s, id).toFixed(1);
const T = (s, k, v) => tutFill(k, s.lang, v);
const pair = (s, p) => !p ? "" : (Array.isArray(p) ? (s.lang === "en" ? p[1] : p[0]) : String(p));
const lgName = (s, id) => { const l = s.leagues.find(x => x.id === id); return l ? (s.lang === "en" ? l.en : l.ar) : id; };

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

/* THE FOCUS PLAN.
   Exactly one element per render carries data-tut-focus, and it is always the
   element that moves the lesson forward. The host focuses it on a step change;
   qa.mjs walks the entire tutorial by clicking nothing else, which is what makes
   "there is always a way forward" a measured fact rather than a hope.

   The fallback chain matters more than it looks. If a league filter leaves no
   pickable club on screen, the way forward is not a club — it is the "All" chip.
   Without that link the filtered picker is a dead end inside mandatory
   onboarding, which is the exact class of bug that trapped every first-run user
   in v1 (two glowing cards, one sentence, no exit but Skip). */
function focusPlan(s, rows, pool) {
  const gate = tutGateMet(s);
  if (s.step === "first" || s.step === "eleven" || s.step === "bench") {
    for (const c of rows) if (!tutBlockReason(s, c, pool) && s.squad.indexOf(c.id) < 0)
      return { kind: "row", id: c.id };
    if (s.filter !== "all") return { kind: "filter", id: "all" };
    if (gate) return { kind: "cta" };
    return { kind: "skip" };            /* never a dead end, even in a state we did not foresee */
  }
  if (s.step === "captain") {
    if (gate) return { kind: "cta" };
    const xi = s.squad.slice(0, s.startSize);
    return xi.length ? { kind: "cap", id: xi[0] } : { kind: "skip" };
  }
  if (s.step === "chips") {
    if (gate) return { kind: "cta" };
    return { kind: "chip", id: TUT_CHIPS[0].id };
  }
  return { kind: "cta" };               /* welcome, budget, done */
}
const focusAttr = (F, kind, id) => (F.kind === kind && (id == null || F.id === id)) ? " data-tut-focus" : "";

/* the dots + the always-present skip. The skip is a small ghost control in the
   top row, NOT a second full-width button under the CTA: the shipped wizard
   gives 345x48 to "التالي" and 345x50.5 to "تخطى الشرح", so the escape hatch is
   fractionally LARGER than the thing it wants you to do. */
function tutProgressHtml(s, F) {
  const f = F || { kind: "" };
  const i = stepIndex(s.step), n = TUT_STEPS.length;
  const dots = TUT_STEPS.map((_, k) =>
    '<span class="tut-dot' + (k === i ? " on" : (k < i ? " past" : "")) + '"></span>').join("");
  return '<div class="tut-top">'
    + '<div class="tut-prog" role="progressbar" aria-valuemin="1" aria-valuemax="' + num(n) + '"'
    + ' aria-valuenow="' + num(i + 1) + '" aria-label="' + esc(tutT("tutStepAria", s.lang)
        .split("{n}").join(num(i + 1)).split("{total}").join(num(n))) + '">' + dots + "</div>"
    + btn(T(s, "tutSkip"), "SKIP", "tut-skip", null,
          ' aria-label="' + esc(tutT("tutSkipAria", s.lang)) + '"' + focusAttr(f, "skip"))
    + "</div>";
}

function live(html) { return '<p class="tut-live" data-tut-live aria-live="polite">' + html + "</p>"; }

/* THE MONEY, ALWAYS ON SCREEN WHILE HE IS SPENDING IT.
   Three numbers, and the third is the one the study found nobody could compute:
   "أغلى نادي تقدر تشتريه" is remaining minus the reserve the empty slots must
   keep. Without it a player learns the budget rule by being refused. */
function budgetStrip(s, b) {
  const pct = Math.max(0, Math.min(100, (b.spend / s.budget) * 100));
  const rpct = Math.max(0, Math.min(100 - pct, ((isFinite(b.reserve) ? b.reserve : 0) / s.budget) * 100));
  return '<div class="tut-bud">'
    + '<div class="tut-bud__top"><span class="tut-bud__lab">' + T(s, "tutBudLeft") + "</span>"
    + '<span class="tut-bud__big" dir="ltr">' + esc(b.remaining.toFixed(1)) + "M</span></div>"
    + '<div class="tut-bud__track">'
    + '<div class="tut-bud__fill" style="inline-size:' + pct.toFixed(2) + '%"></div>'
    + (rpct > 0 ? '<div class="tut-bud__resv" style="inline-size:' + rpct.toFixed(2) + '%"></div>' : "")
    + "</div>"
    + '<div class="tut-bud__foot">'
    + "<span>" + T(s, "tutBudSlots") + ' <b dir="ltr">' + esc(num(b.slotsLeft)) + "</b></span>"
    + "<span>" + T(s, "tutBudNext") + ' <b dir="ltr">' + esc(b.maxNext.toFixed(1)) + "M</b></span>"
    + "</div></div>";
}

/* one slot on the board. A filled slot is a BUTTON that takes the club back out;
   an empty slot is a span, never a button, so the board can never present a tap
   target that does nothing. */
function slot(s, i, nextEmpty) {
  const id = s.squad[i], c = clubOf(s, id);
  if (!c) {
    return '<span class="tut-slot tut-slot--e' + (i === nextEmpty ? " tut-slot--next" : "") + '" aria-hidden="true">'
      + '<span class="tut-slot__ph"></span></span>';
  }
  return '<button type="button" class="tut-slot tut-slot--on' + (id === s.captain ? " cap" : "") + '"'
    + ' data-tut-act="DROP" data-tut-arg="' + esc(id) + '"'
    + ' aria-label="' + esc(tutT("tutPkDrop", s.lang).split("{club}").join(clubName(s, c))) + '">'
    + tutKit(c, "k34")
    + '<span class="tut-nm">' + esc(clubNameCard(s, c)) + "</span>"
    + '<span class="tut-pr" dir="ltr">' + esc(priceStr(s, id)) + "</span>"
    + (id === s.captain ? '<span class="tut-arm" aria-hidden="true">C</span>' : "")
    + "</button>";
}

/* the eleven as three plain rows, and the bench as a fourth under a labelled
   divider. Deliberately NOT a formation: the formation control is inert
   (engagement §A.5, usability #17) and teaching a decision that does not exist
   is the most expensive kind of wrong.
   The bench block appears at the bench STEP and not before — its arrival is the
   lesson. It also appears early if the player somehow already owns twelve clubs
   (he can, by coming BACK), because a board that hides three of his own clubs
   is worse than an early reveal. */
function board(s, showBench) {
  const rows = [4, 4, 3], out = []; let k = 0;
  const nextEmpty = s.squad.length < s.size ? s.squad.length : -1;
  for (const r of rows) {
    const cells = [];
    for (let x = 0; x < r && k < s.startSize; x++, k++) cells.push(slot(s, k, nextEmpty));
    out.push('<div class="tut-line">' + cells.join("") + "</div>");
  }
  let bench = "";
  if (showBench) {
    const cells = [];
    for (let i = s.startSize; i < s.size; i++) cells.push(slot(s, i, nextEmpty));
    bench = '<div class="tut-lab tut-lab--b">' + T(s, "tutLabBench") + "</div>"
      + '<div class="tut-line tut-line--b">' + cells.join("") + "</div>";
  }
  return '<div class="tut-board">'
    + '<div class="tut-lab">' + T(s, "tutLabPitch") + "</div>"
    + out.join("") + bench + "</div>";
}

/* the visible rows: the league filter applied, then price descending — the app's
   own picker order, so the surface he learns here is the surface he keeps. */
function pickRows(s) {
  return s.clubs.filter(c => s.filter === "all" || c.lg === s.filter)
                .slice().sort((a, b) => priceOf(s, b.id) - priceOf(s, a.id));
}

function picker(s, rows, pool, F) {
  const chips = [{ id: "all", nm: tutT("tutPkAll", s.lang) }]
    .concat(s.leagues.map(l => ({ id: l.id, nm: s.lang === "en" ? l.en : l.ar })));
  const strip = '<div class="tut-filters" role="group" aria-label="' + esc(tutT("tutPkFilter", s.lang)) + '">'
    + chips.map(l => '<button type="button" class="tut-fchip' + (s.filter === l.id ? " on" : "") + '"'
        + ' data-tut-act="FILTER" data-tut-arg="' + esc(l.id) + '"'
        + ' aria-pressed="' + (s.filter === l.id ? "true" : "false") + '"'
        + focusAttr(F, "filter", l.id) + ">" + esc(l.nm) + "</button>").join("")
    + "</div>";

  const list = rows.map(c => {
    const owned = s.squad.indexOf(c.id) >= 0;
    const why = owned ? null : tutBlockReason(s, c, pool);
    const aria = owned
      ? tutT("tutPkDrop", s.lang).split("{club}").join(clubName(s, c))
      : tutT("tutPkAdd", s.lang).split("{club}").join(clubName(s, c)).split("{price}").join(priceStr(s, c.id));
    /* a blocked row must NOT show "+": it promises an action that cannot happen,
       which is what made the tester tap Liverpool repeatedly and conclude the app
       was broken. It keeps data-tut-act anyway — the reducer refuses the pick on
       its own, so the guard does not depend on the attribute being absent. */
    return '<button type="button" class="tut-row' + (owned ? " on" : (why ? " no" : "")) + '"'
      + ' data-tut-act="' + (owned ? "DROP" : "PICK") + '" data-tut-arg="' + esc(c.id) + '"'
      + (why ? " disabled" : "")
      + focusAttr(F, "row", c.id)
      + ' aria-label="' + esc(aria) + '">'
      + tutKit(c, "k34")
      + '<span class="tut-rnm"><span class="tut-rn">' + esc(clubName(s, c)) + "</span>"
      + '<span class="' + (why ? "tut-rwhy" : "tut-rl") + '">' + (why ? T(s, why) : esc(lgName(s, c.lg))) + "</span></span>"
      + '<span class="tut-rp" dir="ltr">' + esc(priceStr(s, c.id)) + "</span>"
      + '<span class="tut-rx" aria-hidden="true">' + (owned ? "✓" : why ? "✕" : "+") + "</span>"
      + "</button>";
  }).join("");

  return strip + '<div class="tut-list">'
    + (rows.length ? list : '<p class="tut-note">' + T(s, "tutPkNone") + "</p>")
    + "</div>";
}

/* the shared body of the three picking steps. One surface, three lessons — the
   player learns the picker once and then uses it for the whole season. */
function pickingStep(s, ttlKey, bodyKey, liveHtml, ctaKey, F, rows, pool, b) {
  return '<h2 class="tut-h">' + T(s, ttlKey) + "</h2>"
    + '<p class="tut-p">' + T(s, bodyKey) + "</p>"
    + budgetStrip(s, b)
    + board(s, s.squad.length > s.startSize || stepIndex(s.step) >= stepIndex("bench"))
    + live(liveHtml)
    + picker(s, rows, pool, F)
    + (tutGateMet(s) ? btn(T(s, ctaKey), "NEXT", "tut-cta", null, focusAttr(F, "cta")) : "")
    /* still one tap away while he is picking - he can stop at two clubs or at ten */
    + (s.squad.length >= 1 && s.squad.length < s.size
       ? btn(T(s, "tutQuickCta"), "QUICK", "tut-sec") : "");
}

function tutHtml(state) {
  const s = state;
  const isPick = s.step === "first" || s.step === "eleven" || s.step === "bench";
  const pool = isPick ? poolAsc(s) : null;
  const rows = isPick ? pickRows(s) : [];
  const F = focusPlan(s, rows, pool);
  const head = tutProgressHtml(s, F);
  const back = stepIndex(s.step) > 0 ? btn(T(s, "tutBack"), "BACK", "tut-back") : "";
  let body = "";

  if (s.step === "welcome") {
    body = '<h2 class="tut-h tut-h--big">' + T(s, "tutW1Ttl") + "</h2>"
      + '<p class="tut-p">' + T(s, "tutW1Body") + "</p>"
      + '<p class="tut-note">' + T(s, "tutW1Note") + "</p>"
      + btn(T(s, "tutW1Cta"), "NEXT", "tut-cta", null, focusAttr(F, "cta"));
  }

  else if (s.step === "first") {
    const last = s.squad.length ? clubOf(s, s.squad[s.squad.length - 1]) : null;
    body = pickingStep(s, "tutP1Ttl", "tutP1Body",
      last ? '<span class="tut-ok">' + T(s, "tutP1Ok", { club: clubName(s, last) }) + "</span>"
           : T(s, "tutP1Live"),
      "tutP1Cta", F, rows, pool, tutBudget(s, pool));
  }

  else if (s.step === "budget") {
    const b = tutBudget(s);
    body = '<h2 class="tut-h">' + T(s, "tutBgTtl") + "</h2>"
      + '<p class="tut-p">' + T(s, "tutBgBody") + "</p>"
      + budgetStrip(s, b)
      + '<div class="tut-pills">'
      + '<span class="tut-pill">' + T(s, "tutBgP1") + "</span>"
      + '<span class="tut-pill">' + T(s, "tutBgP4") + "</span>"
      + '<span class="tut-pill">' + T(s, "tutBgP2") + "</span>"
      + '<span class="tut-pill">' + T(s, "tutBgP3") + "</span>"
      + "</div>"
      + '<p class="tut-note">' + T(s, "tutBgBig") + "</p>"
      + btn(T(s, "tutBgCta"), "NEXT", "tut-cta", null, focusAttr(F, "cta"))
      /* THE SHORT PATH. Fifteen taps is data entry; naming the club you care about and having
         the rest built around it is a game. Offered here, one club in, because that is the
         moment he has told us the only thing we needed from him. Everything stays editable. */
      + btn(T(s, "tutQuickCta"), "QUICK", "tut-sec")
      + '<p class="tut-note">' + T(s, "tutQuickNote") + "</p>";
  }

  else if (s.step === "eleven") {
    const left = Math.max(0, s.startSize - s.squad.length);
    body = pickingStep(s, "tutXiTtl", "tutXiBody",
      left ? T(s, "tutXiLive", { n: s.squad.length, m: left })
           : '<span class="tut-ok">' + T(s, "tutXiFull") + "</span>",
      "tutXiCta", F, rows, pool, tutBudget(s, pool));
  }

  else if (s.step === "bench") {
    body = '<h2 class="tut-h">' + T(s, "tutBnTtl") + "</h2>"
      + '<p class="tut-p">' + T(s, "tutBnBody") + "</p>"
      + '<p class="tut-note">' + T(s, "tutBnFact") + "</p>"
      + budgetStrip(s, tutBudget(s, pool))
      + board(s, true)
      + live(s.squad.length < s.size
          ? T(s, "tutBnLive", { n: s.squad.length, m: s.size - s.squad.length })
          : '<span class="tut-ok">' + T(s, "tutBnFull") + "</span>")
      + picker(s, rows, pool, F)
      + (tutGateMet(s) ? btn(T(s, "tutBnCta"), "NEXT", "tut-cta", null, focusAttr(F, "cta")) : "");
  }

  else if (s.step === "captain") {
    const cc = clubOf(s, s.captain);
    body = '<h2 class="tut-h">' + T(s, "tutCapTtl") + "</h2>"
      + '<p class="tut-p">' + T(s, "tutCapBody") + "</p>"
      + live(cc ? '<span class="tut-ok">' + T(s, "tutCapOk", { club: clubName(s, cc) }) + "</span>"
                : T(s, "tutCapLive"))
      + '<div class="tut-caps">' + s.squad.slice(0, s.startSize).map(id => {
          const c = clubOf(s, id); if (!c) return "";
          return '<button type="button" class="tut-cap' + (s.captain === id ? " on" : "") + '"'
            + ' data-tut-act="CAP" data-tut-arg="' + esc(id) + '"'
            + ' aria-pressed="' + (s.captain === id ? "true" : "false") + '"'
            + focusAttr(F, "cap", id)
            + ' aria-label="' + esc(tutT("tutCapAria", s.lang).split("{club}").join(clubName(s, c))) + '">'
            + tutKit(c, "k34") + '<span class="tut-nm">' + esc(clubNameCard(s, c)) + "</span>"
            + '<span class="tut-arm" aria-hidden="true">C</span></button>';
        }).join("") + "</div>"
      + (tutGateMet(s) ? btn(T(s, "tutCapCta"), "NEXT", "tut-cta", null, focusAttr(F, "cta")) : "");
  }

  else if (s.step === "chips") {
    body = '<h2 class="tut-h">' + T(s, "tutChTtl") + "</h2>"
      + '<p class="tut-p">' + T(s, "tutChBody") + "</p>"
      + live(s.chipsSeen.length ? '<span class="tut-ok">' + T(s, "tutChSeen") + "</span>" : T(s, "tutChTap"))
      + '<div class="tut-chips">' + TUT_CHIPS.map(k => {
          const open = s.chipOpen === k.id;
          return '<div class="tut-chipcard' + (open ? " open" : "") + '">'
            + '<button type="button" class="tut-chiph" data-tut-act="CHIP" data-tut-arg="' + esc(k.id) + '"'
            + ' aria-expanded="' + (open ? "true" : "false") + '"'
            + focusAttr(F, "chip", k.id)
            + ' aria-label="' + esc(tutT("tutChAria", s.lang).split("{chip}").join(tutT(k.name, s.lang))) + '">'
            + '<span class="tut-chipg"' + (k.ltr ? ' dir="ltr"' : "") + ">" + esc(k.glyph) + "</span>"
            + '<span class="tut-chipn">' + T(s, k.name) + "</span>"
            + '<span class="tut-chipx">' + T(s, "tutChPer") + "</span>"
            + "</button>"
            + (open ? '<div class="tut-chipb"><p class="tut-p">' + T(s, k.eff) + "</p>"
                      + '<p class="tut-when">' + T(s, k.when) + "</p></div>" : "")
            + "</div>";
        }).join("") + "</div>"
      + '<p class="tut-note">' + T(s, "tutChWhere") + "</p>"
      + (tutGateMet(s) ? btn(T(s, "tutChCta"), "NEXT", "tut-cta", null, focusAttr(F, "cta")) : "");
  }

  else { /* done */
    const g = s.gw || {};
    /* prefer gameweek.js's own rendering when the host supplies it — this module
       does not own the round, it only makes room for it. */
    const lineHtml = g.lineHtml ? String(g.lineHtml)
      : (g.from && g.to
          ? T(s, "tutGwLine", { from: pair(s, g.from), to: pair(s, g.to) })
          : T(s, "tutGwLineNd"));
    body = '<h2 class="tut-h">' + T(s, "tutDnTtl") + "</h2>"
      + '<p class="tut-p tut-p--gw">' + lineHtml + "</p>"
      + (g.lock ? '<p class="tut-lock">' + T(s, "tutDnLock", { n: g.no != null ? g.no : 1, when: pair(s, g.lock) }) + "</p>" : "")
      + '<p class="tut-p">' + T(s, "tutDnBody") + "</p>"
      + (g.seasonFrom && g.seasonTo
          ? '<p class="tut-note">' + T(s, "tutDnSeason", { a: pair(s, g.seasonFrom), b: pair(s, g.seasonTo) }) + "</p>"
          : "")
      + '<p class="tut-note">' + T(s, "tutDnNoPts") + "</p>"
      + btn(T(s, "tutDnCta"), "DONE", "tut-cta", null, focusAttr(F, "cta"));
  }

  return '<div class="tut" data-tut-step="' + esc(s.step) + '">' + head + body + back + "</div>";
}

const api = {
  TUT_STR, TUT_STEPS, TUT_CHIPS, tutSteps, tutInit, tutReduce, tutHtml, tutProgressHtml,
  tutT, tutFill, tutIsLegal, tutBudget, tutBlockReason, tutGateMet, tutKit
};
const TUT = Object.freeze(Object.assign({}, api));

return Object.assign({ TUT: TUT }, api);
});
