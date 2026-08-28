/* ============================================================================
   GOALLAK FANTASY — THE CHIPS SYSTEM (الجوكرات)
   Implements design/fantasy-design.md §1.6, §1.7, §12.1, §12.2, §13.6, §15.4
   and the screen specified in design/fantasy-ui.md §D.2.5 and §D.8, dressed to
   design/fantasy-spectacle.md §H.8 with the palette of design/fantasy-color.md.

   ----------------------------------------------------------------------------
   INTEGRATION NOTE — read this before dropping it in
   ----------------------------------------------------------------------------

   FILES
     modules/chips.css   — paste inside the existing <style> block, or link it.
                           It declares no tokens; it consumes the --fx-* set
                           that :root already defines in index.html.
     modules/chips.js    — paste inside the existing <script>, or load it
                           BEFORE the script that calls it.

   WHAT IT EXPORTS
     In a browser it assigns these onto the global object, so they are callable
     bare, exactly like the app's own render helpers:

       CHIP_STR                             bilingual [ar, en] pairs, STR-shaped
       chipState(save, gw)      -> state    the whole rules engine, pure
       chipsHtml(state)         -> string   the chips screen (F10)
       chipCardHtml(chip, state)-> string   one chip
       chipConfirmHtml(chip)    -> string   the confirmation body
       applyChip(chipId, gwRes) -> gwResult scoring, resolveGw()-shaped
       chipFreeTransfers(t, id) -> {...}    the free-transfer rule
       chipT(key, lang)         -> string   (raw, unescaped — for aria/title)
       chipFill(key, lang, vars)-> string   (escaped HTML, numbers dir="ltr")

   MERGING THE STRINGS
     Object.assign(STR, CHIP_STR);
     Every key is fx-prefixed and none collides with the demo's current STR nor
     with GW_STR from modules/gameweek.js. Four keys are the ones fantasy-ui.md
     §D.8 names verbatim — fxChipArm, fxChipCancelable, fxChipFinal,
     fxChipOnePerGw — and they keep those exact names so the spec and the code
     can be diffed by eye.

   WHERE EACH FUNCTION MOUNTS
     chipsHtml       -> F10, the chips sheet. openSheet(chipsHtml(state)).
                        Renders its own <section class="card fxch">, so it also
                        drops straight into #viewTeam as a full screen.
     chipCardHtml    -> called by chipsHtml; exported because the dugout rail on
                        F2 (fantasy-ui.md §D.2.5) renders the same four objects
                        at a smaller size — pass state.compact = true.
     chipConfirmHtml -> the confirm sheet body, opened from the card's button.
     applyChip       -> the scoring flow, AFTER resolveGw() and BEFORE the total
                        is painted. See "SCORING" below.

   THE ACTION CALLBACKS
     The cards carry no onclick, because these functions are pure. They emit
     data attributes; bind them after mount:

       host.querySelectorAll("[data-chip-play]").forEach(b =>
         b.onclick = () => openSheet(chipConfirmHtml(state.byId[b.dataset.chipPlay])));
       host.querySelectorAll("[data-chip-cancel]").forEach(b =>
         b.onclick = () => cancelChip(b.dataset.chipCancel));
       host.querySelector("[data-chip-confirm]").onclick = () => playChip(...);

   SCORING — how applyChip slots in
     resolveGw(gw) already returns {total, lineup, covered, uncovered, used}.
     applyChip takes that object and returns the same shape with the chip's
     effect folded in. It needs three facts resolveGw does not carry, so the
     caller passes them on the SAME object:

       const res = resolveGw(gw);
       res.captain = captain;                    // the app's global
       res.vice    = vice;                       // null in the demo today
       res.bench   = squad.slice(START_SIZE).map(id => ({id, m: simMatch(id, gw)}));
       const out   = applyChip(armedChipId, res); // armedChipId may be null
       paint(out.total, out.lineup);

     With no chip armed, pass null and you get the input back untouched.
     applyChip NEVER mutates its argument.

   PURITY CONTRACT
     Every function takes state and returns a value. No global reads, no DOM
     access, no Date.now(), no network, no localStorage, no mutation of the
     state passed in. `lang` is always carried on the state — the module never
     reads LANG. That is what lets this drop into a file another engineer is
     restructuring without a merge hazard.

   THE ARABIC
     Egyptian throughout, matching index.html's own STR (`مالوش ماتش`, `دوس`,
     `عشان`, `ببلاش`). modules/gameweek.js was originally written in a Gulf
     register and has since been converted to match this file — see
     design/fantasy-arabic.md for the glossary that now governs all five
     modules. Duals are written as duals: `جوكرين`, never `2 جوكرات`.

   WHAT IS NOT BUILT, DELIBERATELY
     • The `جولات مقترحة` suggested-rounds list (fantasy-engagement.md §I.3)
       needs forward fixture data — a blank/double calendar per club — which no
       function in the demo can supply. The card reserves the slot: pass
       chip.suggest = [12, 14] and the line renders; omit it and nothing does.
     • Free Hit's squad snapshot/restore (fantasy-design.md §15.4 step 8) is a
       transfer-engine job, not a scoring or rendering job. applyChip declares
       Free Hit as points-neutral, which it is.
     • Chip persistence. chipState reads a save object and never writes one; the
       four mutations (play, cancel, confirm-transfer, expire) belong to the
       caller and are one-liners against the shape documented at chipState.
   ============================================================================ */

;(function (glob) {
  "use strict";

  /* ==========================================================================
     0. PRIMITIVES
     ========================================================================== */

  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  /* Identical in behaviour to the app's own esc(). Duplicated rather than
     imported so this module has no dependency on index.html's load order. */
  function chipEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  /* Western digits everywhere, per the app's own rule. */
  function chipNum(n) { return String(n); }

  /* A value that is purely numeric/punctuation gets dir="ltr" so a bidi run
     like "الجولة 19 · ×2" cannot reorder. */
  var NUMERIC = /^[\d.,:+\-−×/ ]+$/;

  function int(v, dflt) {
    var n = typeof v === "number" ? v : parseInt(v, 10);
    return isFinite(n) ? n : dflt;
  }

  /* t()-shaped lookup. Takes lang explicitly — the module never reads a global.
     Returns the RAW string: use it for aria-label and title, never for markup. */
  function chipT(key, lang) {
    var e = CHIP_STR[key];
    return e ? e[lang === "en" ? 1 : 0] : key;
  }

  /* The only way text enters the markup. Escapes the template, then substitutes
     escaped values, wrapping purely numeric ones in dir="ltr". */
  function chipFill(key, lang, vars) {
    var out = chipEsc(chipT(key, lang));
    if (!vars) return out;
    return out.replace(/\{(\w+)\}/g, function (m, name) {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) return m;
      var v = vars[name];
      if (v == null) return "";
      var s = chipEsc(typeof v === "number" ? chipNum(v) : v);
      return NUMERIC.test(String(v)) ? '<span dir="ltr">' + s + "</span>" : s;
    });
  }

  /* The same substitution for a plain-text sink (aria-label, title). */
  function chipFillText(key, lang, vars) {
    var out = chipT(key, lang);
    if (!vars) return out;
    return out.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name] == null ? "" : vars[name]) : m;
    });
  }

  function attr(v) { return chipEsc(v); }


  /* ==========================================================================
     1. CHIP_STR — every user-visible string, [ar, en], STR-shaped
     ==========================================================================
     Merge with: Object.assign(STR, CHIP_STR)
     ========================================================================== */

  var CHIP_STR = {

    /* ---- the screen ------------------------------------------------------- */
    fxChipsTtl:  ["الجوكرات", "Chips"],
    /* Two sentences, two rules, and they are the only two rules a manager has
       to hold in his head to use the screen. Everything else is on the card. */
    fxChipsSub:  ["كل جوكر مرتين في الموسم — واحد في كل نص. وجوكر واحد بس في الجولة.",
                  "Each chip twice a season — one per half. And only one chip per round."],
    fxChipsNone: ["مفيش جوكر مفعّل في الجولة دي.", "No chip is on for this round."],
    fxChipsOn:   ["مفعّل في الجولة {n}: {chip}", "On for round {n}: {chip}"],

    fxChipHalf1:  ["النصف الأول", "First half"],
    fxChipHalf2:  ["النصف التاني", "Second half"],
    fxChipRange:  ["الجولات {a}–{b}", "Rounds {a}–{b}"],
    fxChipHalfNow:  ["دلوقتي", "Now"],
    fxChipHalfDone: ["خلص", "Over"],
    fxChipHalfSoon: ["لسه ما فتحش", "Not open yet"],

    /* The count, written as Arabic writes counts. `2 جوكرات` is wrong and this
       line sits at the top of every half. */
    fxChipLeft0: ["ما باقيش ولا جوكر", "None left"],
    fxChipLeft1: ["باقي جوكر واحد", "1 chip left"],
    fxChipLeft2: ["باقي جوكرين", "2 chips left"],
    fxChipLeftN: ["باقي {n} جوكرات", "{n} chips left"],

    /* fantasy-engagement.md §I.3: informative expiry, never urgent. A statement
       of fact — no countdown, no red, no "don't waste it". */
    fxChipExpiry:   ["جوكرات النصف الأول بتنتهي بإقفال الجولة {n}. اللي ما تستخدمهوش يروح — مفيش ترحيل.",
                     "First-half chips end at the round {n} deadline. Anything unused is lost — there is no carry-over."],
    fxChipExpiry1:  ["باقي جولة واحدة على انتهاء جوكرات النصف الأول.",
                     "1 round until your first-half chips expire."],
    fxChipExpiry2:  ["باقي جولتين على انتهاء جوكرات النصف الأول.",
                     "2 rounds until your first-half chips expire."],
    fxChipExpiryN:  ["باقي {n} جولات على انتهاء جوكرات النصف الأول.",
                     "{n} rounds until your first-half chips expire."],
    fxChipSecondSet: ["الطقم التاني بيفتح لوحده بعد الإقفال ده.",
                      "The second set unlocks on its own straight after that deadline."],

    /* The free-transfer rule. It is the edge case that generates support
       tickets in every clone (fantasy-design.md §1.5), so it is on the screen
       rather than in a help page. */
    fxChipFtNote: ["تفعيل «تغيير شامل» أو «فريق مؤقت» بياخد انتقال الجولة دي بس. الانتقالات اللي مجمّعها من جولات فاتت بتفضل معاك زي ما هي.",
                   "Playing Wildcard or Free Hit uses up this round's free transfer only. Any transfers you had banked from earlier rounds stay exactly as they are."],

    /* ---- the four chips: name, effect, and when to use it ------------------
       Names are fantasy-design.md §12.2 / Part 4 §8. The second line of each
       card is the one a beginner needs and the one FPL never provides
       (fantasy-ui.md §D.8). */
    fxChipWildcard:     ["تغيير شامل", "Wildcard"],
    fxChipWildcardEff:  ["كل انتقالاتك في الجولة دي ببلاش — غيّر اللي إنت عايزه من غير خصم −4.",
                         "Every transfer you make this round is free — change whatever you like with no −4."],
    fxChipWildcardWhen: ["استخدمه لما تحب تغيّر نص فريقك مرة واحدة.",
                         "Use it when you want to rebuild half your squad at once."],

    fxChipFreehit:      ["فريق مؤقت", "Free Hit"],
    fxChipFreehitEff:   ["انتقالات مفتوحة لجولة واحدة بس. وفي الإقفال الجاي فريقك بيرجع زي ما كان بالظبط.",
                         "Unlimited transfers for one round only. At the next deadline your squad goes back exactly as it was."],
    fxChipFreehitWhen:  ["استخدمه في الجولة اللي أغلب أنديتك مالهاش ماتش فيها.",
                         "Use it in a round where most of your clubs have no match."],

    fxChipTripcap:      ["الكابتن الثلاثي", "Triple Captain"],
    fxChipTripcapEff:   ["نقاط الكابتن ×3 بدل ×2 في الجولة دي.",
                         "Your captain scores ×3 instead of ×2 this round."],
    fxChipTripcapWhen:  ["استخدمه لما كابتنك يلعب ماتشين في جولة واحدة.",
                         "Use it when your captain plays twice in one round."],

    fxChipFullsquad:     ["الفريق الكامل", "Full Squad"],
    fxChipFullsquadEff:  ["البدلاء الأربعة كلهم بيجيبوا نقط في الجولة دي، مش بس اللي بيدخل بدل نادي مالوش ماتش.",
                          "All four of your substitutes score this round, not just the one covering a club with no match."],
    fxChipFullsquadWhen: ["استخدمه في الجولة اللي الخمستاشر نادي كلهم لاعبين فيها.",
                          "Use it in a round where all fifteen of your clubs have a match."],

    /* ---- the six states (fantasy-ui.md §D.2.5) ----------------------------- */
    fxChipStAvailable: ["متاح", "Available"],
    fxChipStPending:   ["مفعّل", "Armed"],
    fxChipStActive:    ["شغّال", "In play"],
    fxChipStUsed:      ["اتستخدم", "Played"],
    fxChipStExpired:   ["انتهى", "Expired"],
    fxChipStLocked:    ["مقفول", "Locked"],

    /* ---- why it is not available. One reason per rule, stated as a fact ---- */
    fxChipRsnFirstGw:  ["مش متاح في أول جولة ليك — انتقالاتك مفتوحة أصلاً.",
                        "Not available in your first round — your transfers are already unlimited."],
    /* fantasy-ui.md §D.8 names this key. Kept verbatim. */
    fxChipOnePerGw:    ["جوكر واحد بس في الجولة. عندك «{other}» مفعّل — ألغيه الأول.",
                        "Only one chip per round. \"{other}\" is on — cancel it first."],
    fxChipRsnConsec:   ["لعبت «فريق مؤقت» في الجولة {n} — مينفعش جولتين ورا بعض.",
                        "You played Free Hit in round {n} — it cannot be played in two rounds in a row."],
    fxChipRsnHalf2:    ["بيفتح بعد نص الموسم — من الجولة {n}.",
                        "Unlocks after the halfway deadline — from round {n}."],
    fxChipRsnExpired:  ["جوكرات النصف الأول انتهت بإقفال الجولة {n}، واللي ما اتستخدمش راح.",
                        "The first-half chips ended at the round {n} deadline, and anything unused is gone."],
    fxChipRsnUsed:     ["لعبته في الجولة {n}.", "You played it in round {n}."],
    fxChipRsnDeadline: ["الجولة {n} أقفلت. تقدر تفعّل جوكر للجولة الجاية.",
                        "Round {n} is locked. You can play a chip for the next round."],
    fxChipRsnOver:     ["الموسم خلص.", "The season is over."],
    fxChipRsnNotYet:   ["بيفتح من الجولة {n}.", "Opens from round {n}."],

    /* ---- the actions ------------------------------------------------------ */
    fxChipPlay:    ["فعّل", "Play"],
    fxChipUndo:    ["إلغاء التفعيل", "Cancel it"],
    fxChipConfirm: ["أكّد التفعيل", "Confirm"],
    fxChipNotNow:  ["مش دلوقتي", "Not now"],
    fxChipTimes:   ["×{n}", "×{n}"],

    /* ---- the confirmation (fantasy-ui.md §D.8 names the first four) -------- */
    fxChipArm:        ["تفعّل «{chip}» في الجولة {n}؟", "Play \"{chip}\" in round {n}?"],
    fxChipCancelable: ["تقدر تلغيه قبل الإقفال.", "You can cancel it before the deadline."],
    fxChipFinal:      ["ما تقدرش تلغيه بعد التفعيل.", "This cannot be cancelled once played."],

    /* The four irreversibility notices, deliberately unequal. Free Hit is the
       only chip in the game with no way back at all, and its notice is three
       times the length of Triple Captain's because the consequence is three
       times the size. fantasy-design.md §1.6, §1.7, §12.2. */
    fxChipWarnFh:   ["ده قرار نهائي.", "This one is final."],
    fxChipWarnFhA:  ["أول ما تأكد، الجوكر يروح — مفيش إلغاء ولا رجوع، ولا حتى قبل الإقفال.",
                     "The moment you confirm, the chip is spent — there is no cancel and no way back, not even before the deadline."],
    fxChipWarnFhB:  ["وفي الإقفال الجاي فريقك بيرجع زي ما كان بالظبط: كل انتقال تعمله في الجولة دي بيتشال، والفلوس بترجع زي ما كانت.",
                     "And at the next deadline your squad reverts exactly as it was: every transfer you make this round is undone and your bank goes back to what it was."],
    fxChipWarnFhC:  ["ومينفعش تلعبه تاني في الجولة اللي بعدها.",
                     "And it cannot be played again in the round straight after."],

    fxChipWarnWc:   ["تقدر تلغيه — لحد انتقالين.", "You can cancel it — up to two transfers."],
    fxChipWarnWcA:  ["ما دام أكدت انتقال واحد أو ولا واحد، الجوكر لسه «مفعّل» وتقدر تلغيه. أول ما تأكد التاني بيتقفل خلاص ومش هيرجع.",
                     "While you have confirmed one transfer or none, the chip is still \"Armed\" and you can cancel it. The moment you confirm a second, it locks for good."],

    fxChipWarnTc:   ["تقدر تلغيه قبل الإقفال.", "You can cancel it before the deadline."],
    fxChipWarnTcA:  ["لو نادي الكابتن مالوش ماتش، الـ ×3 بيروح لنادي الكابتن البديل. ولو هو كمان مالوش ماتش، الجوكر بيتحرق ومبيرجعش.",
                     "If your captain's club has no match, the ×3 passes to your vice-captain. If that club has no match either, the chip is used up and not returned."],

    fxChipWarnFs:   ["تقدر تلغيه قبل الإقفال.", "You can cancel it before the deadline."],
    fxChipWarnFsA:  ["بعد الإقفال بيتقفل زي فريقك.", "After the deadline it locks, the same as your squad."],

    /* ---- the effect summary line on the confirm sheet ---------------------- */
    fxChipEffTtl: ["اللي هيحصل", "What happens"],
    fxChipCost:   ["بياخد انتقال الجولة دي بس", "Uses this round's free transfer only"],
    fxChipNoCost: ["مبياخدش أي انتقال", "Costs you no transfers"],

    /* ---- suggested rounds (slot reserved, see the header note) ------------- */
    fxChipSuggest:  ["أحسن جولات ليه: {list}", "Best rounds for it: {list}"],

    /* ---- aria ------------------------------------------------------------- */
    fxChipAria:      ["{chip}. {state}. {why}", "{chip}. {state}. {why}"],
    fxChipAriaOpen:  ["{chip}. {state}. دوس عشان تفعّله في الجولة {n}.",
                      "{chip}. {state}. Tap to play it in round {n}."]
  };


  /* ==========================================================================
     2. THE CATALOGUE — four families, two instances each, eight chips
     ==========================================================================
     fantasy-design.md §1.7 and §12.2. There is NO Assistant Manager chip: the
     rules page lists exactly four and bootstrap-static.chips holds exactly
     eight entries across four names. Any design that has a fifth is working
     from an older season.
     ========================================================================== */

  var ORDER = ["wildcard", "freehit", "tripcap", "fullsquad"];

  var FAMILY = {
    /* glyph: a typographic mark, never an image and never an emoji. Two of them
       ARE the rule (`×3`, `+4`), which fantasy-ui.md §J row 11 asks for
       explicitly: do not name the chip, show the arithmetic. */
    wildcard:  { id: "wildcard",  glyph: "⇄",  ltr: false,
                 name: "fxChipWildcard",  eff: "fxChipWildcardEff",  when: "fxChipWildcardWhen",
                 firstGwOk: false, cancel: "transfers", costsTransfer: true,  scores: false },
    freehit:   { id: "freehit",   glyph: "⟲",  ltr: false,
                 name: "fxChipFreehit",   eff: "fxChipFreehitEff",   when: "fxChipFreehitWhen",
                 firstGwOk: false, cancel: "never",     costsTransfer: true,  scores: false },
    tripcap:   { id: "tripcap",   glyph: "×3", ltr: true,
                 name: "fxChipTripcap",   eff: "fxChipTripcapEff",   when: "fxChipTripcapWhen",
                 firstGwOk: true,  cancel: "deadline",  costsTransfer: false, scores: true },
    fullsquad: { id: "fullsquad", glyph: "+4", ltr: true,
                 name: "fxChipFullsquad", eff: "fxChipFullsquadEff", when: "fxChipFullsquadWhen",
                 firstGwOk: true,  cancel: "deadline",  costsTransfer: false, scores: true }
  };

  /* "wildcard-2" and "wildcard" both resolve to the wildcard family. The suffix
     is the HALF, not a sequence number: -1 expires at the halfway deadline, -2
     unlocks straight after it. */
  function familyOf(chipId) {
    if (!chipId) return null;
    var base = String(chipId).split("-")[0];
    return FAMILY[base] || null;
  }
  function halfOfId(chipId) {
    var parts = String(chipId == null ? "" : chipId).split("-");
    return parts.length > 1 ? int(parts[1], 0) : 0;
  }
  function instanceId(family, half) { return family + "-" + half; }


  /* ==========================================================================
     3. THE RULES ENGINE — chipState(save, gw)
     ==========================================================================

     THE SAVE SHAPE (every field optional; the defaults are a 38-round season
     with the halfway deadline at the end of round 19):

       {
         lang: "ar" | "en",
         firstGw: 1,          the manager's FIRST gameweek, not the season's.
                              A late joiner's first round is his GW1 for the
                              purposes of the Wildcard/Free Hit ban.
         halfwayGw: 19,       the LAST round of the first half. The halfway
                              deadline is this round's deadline, so a first-half
                              chip is still playable IN round 19 and the second
                              set opens at round 20. fantasy-design.md §12.2
                              sets this by DATE — the round boundary nearest
                              1 January — so it is a number the caller computes
                              from the calendar, never a constant in this file.
         lastGw: 38,
         deadlinePassed: false,   has THIS round's deadline passed?
         transfers: 0,            confirmed transfers so far in THIS round
         plays: [
           { chip:"wildcard", half:1, gw:7, state:"active", transfers:2 }
         ]
       }

     A play with state "cancelled" is ignored entirely — a cancelled chip was
     never spent. Everything else ("pending", "active", "consumed") counts as
     spent, exactly as the partial unique index in §13.6 has it.

     RETURNS a state object. It is the single input to every render function,
     and each of its eight chip entries carries `gw` and `lang` so that
     chipConfirmHtml(chip) needs no second argument.
     ========================================================================== */

  function chipState(save, gw) {
    var s = save || {};
    var lang = s.lang === "en" ? "en" : "ar";
    var firstGw   = int(s.firstGw, 1);
    var halfwayGw = int(s.halfwayGw, 19);
    var lastGw    = int(s.lastGw, 38);
    var now       = int(gw, firstGw);
    var deadlinePassed = !!s.deadlinePassed;

    /* ---- normalise the ledger, dropping cancellations ---------------------- */
    var plays = [];
    var raw = Array.isArray(s.plays) ? s.plays : [];
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i];
      if (!p || !FAMILY[p.chip]) continue;
      if (p.state === "cancelled") continue;
      var pgw = int(p.gw, 0);
      plays.push({
        chip: p.chip,
        half: int(p.half, pgw <= halfwayGw ? 1 : 2),
        gw: pgw,
        state: p.state || "active",
        /* A play in THIS round takes the round's live transfer count unless it
           carries its own; a play in a past round is locked by definition. */
        transfers: int(p.transfers, pgw === now ? int(s.transfers, 0) : 2)
      });
    }

    function playOf(family, half) {
      for (var j = 0; j < plays.length; j++) {
        if (plays[j].chip === family && plays[j].half === half) return plays[j];
      }
      return null;
    }

    /* ONE CHIP PER GAMEWEEK. This is the play that occupies `now`; every other
       family reads it as its blocking reason. fantasy-design.md §12.2. */
    var armedPlay = null;
    for (var k = 0; k < plays.length; k++) {
      if (plays[k].gw === now) { armedPlay = plays[k]; break; }
    }

    /* FREE HIT CANNOT BE PLAYED IN CONSECUTIVE GAMEWEEKS. Either instance of
       Free Hit in the previous round blocks either instance in this one — the
       ban is on the chip, not on the copy. */
    var fhPrev = null;
    for (var m = 0; m < plays.length; m++) {
      if (plays[m].chip === "freehit" && plays[m].gw === now - 1) { fhPrev = plays[m]; break; }
    }

    var halfNow = now <= halfwayGw ? 1 : 2;

    /* ---- WILDCARD LIFECYCLE, and the two chips that share the idea ---------
       Unplayed → Pending (0 or 1 confirmed transfers, reversible)
                → Active  (>= 2 confirmed transfers, locked forever)
       Free Hit has no grace period at all. Triple Captain and Full Squad live
       on the Pick Team page, so they are cancellable right up to the deadline
       and locked by the deadline itself. fantasy-design.md §1.6, §12.2. */
    function cancellable(fam, play) {
      if (fam.cancel === "never") return false;
      if (deadlinePassed) return false;
      if (fam.cancel === "transfers") return int(play.transfers, 0) < 2;
      return true;
    }

    function evaluate(fam, half) {
      var play = playOf(fam.id, half);

      if (play) {
        if (play.gw === now) {
          var canUndo = cancellable(fam, play);
          return {
            state: canUndo ? "pending" : "active",
            cancellable: canUndo,
            playedGw: play.gw,
            transfers: int(play.transfers, 0),
            reason: null, vars: null
          };
        }
        return { state: "used", cancellable: false, playedGw: play.gw,
                 reason: "fxChipRsnUsed", vars: { n: play.gw } };
      }

      /* NO CARRY-OVER. An unplayed first-half chip is not banked, it is gone. */
      if (half === 1 && halfNow === 2) {
        return { state: "expired", cancellable: false, playedGw: null,
                 reason: "fxChipRsnExpired", vars: { n: halfwayGw } };
      }
      if (half === 2 && halfNow === 1) {
        return { state: "locked", cancellable: false, playedGw: null,
                 reason: "fxChipRsnHalf2", vars: { n: halfwayGw + 1 } };
      }
      if (now > lastGw) {
        return { state: "locked", cancellable: false, playedGw: null, reason: "fxChipRsnOver", vars: null };
      }
      if (now < firstGw) {
        return { state: "locked", cancellable: false, playedGw: null,
                 reason: "fxChipRsnNotYet", vars: { n: firstGw } };
      }
      if (deadlinePassed) {
        return { state: "locked", cancellable: false, playedGw: null,
                 reason: "fxChipRsnDeadline", vars: { n: now } };
      }

      /* WILDCARD AND FREE HIT ARE NOT AVAILABLE IN A MANAGER'S FIRST GAMEWEEK.
         He already has unlimited transfers, so the chip would be a gift of
         nothing. Triple Captain and Full Squad are available immediately.
         This is checked BEFORE the consecutive and one-per-round rules because
         it is the more fundamental fact: those two chips do not exist for him
         yet, whatever else is going on in the round. */
      if (!fam.firstGwOk && now === firstGw) {
        return { state: "locked", cancellable: false, playedGw: null,
                 reason: "fxChipRsnFirstGw", vars: null };
      }
      if (fam.id === "freehit" && fhPrev) {
        return { state: "locked", cancellable: false, playedGw: null,
                 reason: "fxChipRsnConsec", vars: { n: fhPrev.gw } };
      }
      if (armedPlay && armedPlay.chip !== fam.id) {
        return { state: "locked", cancellable: false, playedGw: null,
                 reason: "fxChipOnePerGw",
                 vars: { other: chipT(FAMILY[armedPlay.chip].name, lang) } };
      }
      return { state: "available", cancellable: false, playedGw: null, reason: null, vars: null };
    }

    /* ---- build the eight ---------------------------------------------------- */
    var chips = [], byId = {}, order = 0;
    for (var h = 1; h <= 2; h++) {
      for (var f = 0; f < ORDER.length; f++) {
        var fam = FAMILY[ORDER[f]];
        var ev = evaluate(fam, h);
        var opensAt = h === 1 ? (fam.firstGwOk ? firstGw : firstGw + 1) : halfwayGw + 1;
        var chip = {
          id: instanceId(fam.id, h),
          chip: fam.id,
          half: h,
          order: order++,
          glyph: fam.glyph,
          glyphLtr: fam.ltr,
          nameKey: fam.name,
          effKey: fam.eff,
          whenKey: fam.when,
          state: ev.state,
          reason: ev.reason,
          reasonVars: ev.vars || null,
          cancellable: !!ev.cancellable,
          playedGw: ev.playedGw == null ? null : ev.playedGw,
          transfers: ev.transfers == null ? null : ev.transfers,
          costsTransfer: fam.costsTransfer,
          scores: fam.scores,
          fromGw: opensAt,
          toGw: h === 1 ? halfwayGw : lastGw,
          /* carried so chipConfirmHtml(chip) needs no second argument */
          gw: now,
          lang: lang
        };
        chips.push(chip);
        byId[chip.id] = chip;
      }
    }

    function countLeft(half) {
      var n = 0;
      for (var q = 0; q < chips.length; q++) {
        if (chips[q].half !== half) continue;
        if (chips[q].state === "available" || chips[q].state === "locked") n++;
      }
      return n;
    }

    var armedId = armedPlay ? instanceId(armedPlay.chip, armedPlay.half) : null;

    return {
      lang: lang,
      gw: now,
      half: halfNow,
      firstGw: firstGw,
      halfwayGw: halfwayGw,
      lastGw: lastGw,
      deadlinePassed: deadlinePassed,
      chips: chips,
      byId: byId,
      armedId: armedId,
      armed: armedId ? byId[armedId] : null,
      armedName: armedPlay ? chipT(FAMILY[armedPlay.chip].name, lang) : null,
      left: { 1: countLeft(1), 2: countLeft(2) },
      /* fantasy-engagement.md §I.3: surfaced only inside the last three rounds
         of the first half, and only if something is actually left to lose. */
      expiresIn: (halfNow === 1 && countLeft(1) > 0) ? (halfwayGw - now) : null
    };
  }


  /* ==========================================================================
     4. THE FREE-TRANSFER RULE
     ==========================================================================
     fantasy-design.md §1.5 reconciles two official statements that read
     differently: playing a Wildcard or a Free Hit consumes THAT GAMEWEEK'S
     newly-accrued free transfer but preserves previously banked ones. Enter a
     round with 2 banked and 1 accrued and play a Wildcard, and you leave with
     2 banked, not 3.

     Pure: takes {banked, thisGw}, returns a new object. Triple Captain and Full
     Squad cost nothing at all.
     ========================================================================== */

  function chipFreeTransfers(transfers, chipId) {
    var t = transfers || {};
    var banked = int(t.banked, 0);
    var thisGw = int(t.thisGw, 1);
    var fam = familyOf(chipId);
    if (!fam || !fam.costsTransfer) {
      return { banked: banked, thisGw: thisGw, total: banked + thisGw, consumed: 0 };
    }
    return { banked: banked, thisGw: 0, total: banked, consumed: thisGw };
  }


  /* ==========================================================================
     5. SCORING — applyChip(chipId, gwResult)
     ==========================================================================
     Takes a resolveGw() result and returns the same shape with the chip folded
     in. Never mutates the input. Returns the input's own values untouched when
     chipId is null or names a chip with no scoring effect.

     resolveGw() shape, from index.html:
       { total, lineup:[{id, m:{pts, blank, ...}, sub}], covered, uncovered }

     Three extra fields are read off the same object, because resolveGw does not
     carry them and the chips need them:
       captain  the captain's club id      (Triple Captain)
       vice     the vice-captain's club id (Triple Captain, when the captain blanks)
       bench    [{id, m}] for the four substitutes (Full Squad)
     ========================================================================== */

  /* The club that actually scored in a lineup row: the substitute if one came
     on, otherwise the starter himself. Mirrors resolveGw's own `row.sub || row`. */
  function scorerOf(row) { return row && row.sub ? row.sub : row; }
  function ptsOf(entry) { return entry && entry.m ? int(entry.m.pts, 0) : 0; }
  function blankOf(entry) { return !!(entry && entry.m && entry.m.blank); }

  function applyChip(chipId, gwResult) {
    var res = gwResult || {};
    var lineup = Array.isArray(res.lineup) ? res.lineup : [];
    var out = {};
    /* shallow-copy every field the caller put on the result, so the return is a
       superset of resolveGw()'s shape and nothing downstream loses data */
    for (var key in res) {
      if (Object.prototype.hasOwnProperty.call(res, key)) out[key] = res[key];
    }
    out.lineup = lineup.slice();
    out.total = int(res.total, 0);
    out.covered = int(res.covered, 0);
    out.uncovered = int(res.uncovered, 0);
    out.chip = { id: chipId || null, chip: null, applied: false, delta: 0 };

    var fam = familyOf(chipId);
    if (!fam) return out;
    out.chip.chip = fam.id;

    /* ---- WILDCARD and FREE HIT are transfer chips, not scoring chips -------
       Their whole effect landed before the deadline, in the squad the manager
       took into the round. The points are whatever the squad scored. Free Hit's
       revert happens at the NEXT deadline (fantasy-design.md §15.4 step 8) and
       is the transfer engine's job, not this function's. */
    if (!fam.scores) {
      out.chip.applied = true;
      out.chip.note = fam.id === "freehit" ? "reverts-next-deadline" : "transfers-free";
      return out;
    }

    /* ---- TRIPLE CAPTAIN ---------------------------------------------------
       ONE MORE COPY OF WHATEVER THE ARMBAND ALREADY PAID. This used to recompute
       the whole total from scratch and re-derive the armband itself, by asking
       which SCORER matched the captain's id. resolveSquad had long since stopped
       working that way: it puts the armband on the SHIRT, so a captain with no
       fixture passes the double to whoever came on for him (the 935-of-10,800
       post-mortem in index.html). The two answers agreed only while nobody was
       substituted.
       When the captain AND the vice both blanked and both were covered, neither
       id appeared among the scorers, `effective` fell to null, and the rebuilt
       total silently dropped the ×2 the base engine had already granted — so
       PLAYING Triple Captain scored FEWER points than not playing it, and burned
       the chip doing it. Measured at −5 on an eleven scoring 1…11 with a 5-point
       substitute; it scales with whatever the substitute scored.
       There is only one armband and resolveSquad has already decided who wore it
       and what it paid. Read that instead of guessing at it: the chip is now
       arithmetically incapable of disagreeing with the round it is multiplying. */
    if (fam.id === "tripcap") {
      var wearer = res.wearer == null ? null : res.wearer;
      var wornBy = null, extra = 0;
      for (var i = 0; i < lineup.length; i++) {
        if (lineup[i] == null || lineup[i].id !== wearer) continue;
        var sc = scorerOf(lineup[i]);          /* the substitute if one came on, else the club itself */
        if (sc && !blankOf(sc)) { wornBy = sc.id; extra = ptsOf(sc); }
        break;
      }

      var total = int(res.total, 0) + extra;

      out.total = total;
      out.chip.applied = true;
      out.chip.delta = total - int(res.total, 0);
      /* the WEARER is who the manager appointed; wornBy is who actually earned it.
         Naming the wearer keeps this field meaning what every caller reads it to mean. */
      out.chip.effectiveCaptain = wornBy == null ? null : wearer;
      out.chip.passedToVice = !!res.viceTook;
      /* WASTED, AND NOT REFUNDED. Both clubs blank, the bonus is lost and the
         chip is still spent. fantasy-design.md §1.7, §12.2. */
      out.chip.wasted = wornBy == null;
      out.chip.refunded = false;
      return out;
    }

    /* ---- FULL SQUAD -------------------------------------------------------
       All four substitutes' points count. A substitute who already came on to
       cover a blank is ALREADY in the total as that row's scorer, so only the
       ones still sitting down are appended — otherwise he would be paid twice.
       The two readings ("switch the auto-subs off and score all fifteen" and
       "keep the auto-subs and add the rest of the bench") produce the identical
       total; this one is chosen because it leaves `covered`/`uncovered`, and
       therefore the substitution story on the Points screen, intact.

       In the ordinary case — no starter blanked, so no substitute came on — the
       delta is exactly the sum of the four substitutes' points. */
    if (fam.id === "fullsquad") {
      var bench = Array.isArray(res.bench) ? res.bench : [];
      var cameOn = {};
      for (var a = 0; a < lineup.length; a++) {
        if (lineup[a] && lineup[a].sub && lineup[a].sub.id != null) cameOn[lineup[a].sub.id] = 1;
      }
      var cap = res.captain == null ? null : res.captain;
      var added = 0;
      for (var b = 0; b < bench.length; b++) {
        var sub = bench[b];
        if (!sub || sub.id == null || cameOn[sub.id]) continue;
        out.lineup.push({ id: sub.id, m: sub.m, sub: null, bench: true });
        added += ptsOf(sub) * (cap != null && sub.id === cap ? 2 : 1);
      }
      out.total = int(res.total, 0) + added;
      out.chip.applied = true;
      out.chip.delta = added;
      out.chip.benchCounted = bench.length;
      return out;
    }

    return out;
  }


  /* ==========================================================================
     6. RENDER — pure. State in, HTML string out.
     ========================================================================== */

  /* Arabic counts a dual. `2 جوكرات` is wrong and this line sits at the top of
     every half of the season. */
  function leftLine(n, lang) {
    if (n <= 0) return chipFill("fxChipLeft0", lang);
    if (n === 1) return chipFill("fxChipLeft1", lang);
    if (n === 2) return chipFill("fxChipLeft2", lang);
    return chipFill("fxChipLeftN", lang, { n: n });
  }
  function expiryLine(n, lang) {
    if (n === 1) return chipFill("fxChipExpiry1", lang);
    if (n === 2) return chipFill("fxChipExpiry2", lang);
    return chipFill("fxChipExpiryN", lang, { n: n });
  }

  function stateKey(state) {
    return {
      available: "fxChipStAvailable",
      pending:   "fxChipStPending",
      active:    "fxChipStActive",
      used:      "fxChipStUsed",
      expired:   "fxChipStExpired",
      locked:    "fxChipStLocked"
    }[state] || "fxChipStLocked";
  }

  /* ---------------------------------------------------------------------------
     chipCardHtml(chip, state) — one chip as an object worth owning.

     The clipboard from fantasy-spectacle.md §H.8: a rounded rect with a metal
     clip at the top, hanging on the dugout wall. It is finite, so it says how
     many are left; it is valuable, so the effect is stated before the price;
     and it never carries an onclick, so it can be rendered anywhere.
     --------------------------------------------------------------------------- */
  function chipCardHtml(chip, state) {
    if (!chip) return "";
    var st = state || {};
    var lang = chip.lang || st.lang || "ar";
    var compact = !!st.compact;

    var name = chipT(chip.nameKey, lang);
    var stName = chipT(stateKey(chip.state), lang);
    var why = chip.reason ? chipFillText(chip.reason, lang, chip.reasonVars) : "";

    var live = chip.state === "pending" || chip.state === "active";
    var dead = chip.state === "used" || chip.state === "expired";

    /* The badge. `شغّال` sits on the full violet fill and is the one place in
       the module where the ink goes dark. */
    var badge = '<span class="fxc-badge" data-st="' + attr(chip.state) + '">'
      + chipEsc(stName) + "</span>";

    /* THE CONTROL DIMS; THE EXPLANATION DOES NOT. fantasy-color.md §E.7 is
       explicit: the locked and expired chips drop to opacity .45/.35, so the
       word that explains them renders OUTSIDE the dimmed body, at full
       --fx-ink-dim, in the card's own footer. */
    var action = "";
    if (chip.state === "available") {
      action = '<button type="button" class="fxc-act" data-chip-play="' + attr(chip.id) + '"'
        + ' aria-label="' + attr(chipFillText("fxChipAriaOpen", lang,
            { chip: name, state: stName, n: chip.gw })) + '">'
        + chipFill("fxChipPlay", lang) + "</button>";
    } else if (chip.cancellable) {
      action = '<button type="button" class="fxc-act fxc-act--undo" data-chip-cancel="' + attr(chip.id) + '">'
        + chipFill("fxChipUndo", lang) + "</button>";
    }

    var foot = why
      ? '<p class="fxc-why">' + chipFill(chip.reason, lang, chip.reasonVars) + "</p>"
      : "";

    /* The suggested-rounds slot. Renders only when the caller has real fixture
       data to put in it; see the header note. */
    var suggest = (!compact && chip.state === "available" && chip.suggest && chip.suggest.length)
      ? '<p class="fxc-sug">' + chipFill("fxChipSuggest", lang, { list: chip.suggest.join("، ") }) + "</p>"
      : "";

    var body = compact ? "" :
      '<p class="fxc-eff">' + chipFill(chip.effKey, lang) + "</p>"
      + (dead ? "" : '<p class="fxc-when">' + chipFill(chip.whenKey, lang) + "</p>")
      + suggest;

    return '<article class="fxc' + (compact ? " fxc--compact" : "") + '"'
      + ' data-chip="' + attr(chip.id) + '" data-st="' + attr(chip.state) + '"'
      + (live ? ' data-live="1"' : "")
      + ' aria-label="' + attr(chipFillText("fxChipAria", lang,
          { chip: name, state: stName, why: why })) + '">'
      + '<span class="fxc-clip" aria-hidden="true"></span>'
      + '<div class="fxc-hd">'
        + '<span class="fxc-glyph"' + (chip.glyphLtr ? ' dir="ltr"' : "") + ' aria-hidden="true">'
          + chipEsc(chip.glyph) + "</span>"
        + '<span class="fxc-name">' + chipEsc(name) + "</span>"
        + badge
      + "</div>"
      + body
      + '<div class="fxc-ft">' + foot + action + "</div>"
    + "</article>";
  }

  /* ---------------------------------------------------------------------------
     chipsHtml(state) — the chips screen.

     Two halves of the season, in order, with the current one first and open and
     the other one present but visibly not now. The season is the subject: eight
     objects, four you can reach, four you cannot yet or never again.
     --------------------------------------------------------------------------- */
  function halfHtml(state, half) {
    var lang = state.lang;
    var isNow = state.half === half;
    var isGone = half === 1 && state.half === 2;
    var a = half === 1 ? state.firstGw : state.halfwayGw + 1;
    var b = half === 1 ? state.halfwayGw : state.lastGw;

    var tag = isNow ? "fxChipHalfNow" : (isGone ? "fxChipHalfDone" : "fxChipHalfSoon");

    /* The half you are not in is rendered COMPACT: a name, a state and the one
       sentence that says why. The four chips are the same four either way, and
       they are described in full in the half that is open, so nothing is lost —
       the second set does not need selling and the expired set cannot be sold. */
    var view = { lang: lang, compact: !!state.compact || !isNow };
    var cards = "";
    for (var i = 0; i < state.chips.length; i++) {
      if (state.chips[i].half === half) cards += chipCardHtml(state.chips[i], view);
    }

    /* The expiry line, and the rule it exists to state. It is a fact, not a
       countdown: fantasy-engagement.md §I.3 forbids urgency here. */
    var note = "";
    if (half === 1) {
      note = '<p class="fxch-note">' + chipFill("fxChipExpiry", lang, { n: state.halfwayGw })
        + (state.expiresIn != null && state.expiresIn <= 3 && state.expiresIn >= 0
            ? " " + expiryLine(state.expiresIn, lang) : "")
        + "</p>";
    } else if (state.half === 1) {
      note = '<p class="fxch-note">' + chipFill("fxChipSecondSet", lang) + "</p>";
    }

    return '<section class="fxch-half" data-half="' + attr(half) + '"'
      + (isNow ? ' data-now="1"' : "") + (isGone ? ' data-gone="1"' : "") + ">"
      + '<h4 class="fxch-hh">'
        + '<span class="fxch-hn">' + chipFill(half === 1 ? "fxChipHalf1" : "fxChipHalf2", lang) + "</span>"
        + '<span class="fxch-hr" dir="ltr">' + chipEsc(chipNum(a) + "–" + chipNum(b)) + "</span>"
        + '<span class="fxch-ht" data-tag="' + attr(tag) + '">' + chipFill(tag, lang) + "</span>"
      + "</h4>"
      + '<p class="fxch-hl">' + leftLine(state.left[half], lang) + "</p>"
      + '<div class="fxch-grid">' + cards + "</div>"
      + note
    + "</section>";
  }

  function chipsHtml(state) {
    if (!state || !state.chips) return "";
    var lang = state.lang;

    /* WHAT IS ON RIGHT NOW. One chip per round is the rule the whole screen
       hangs off, so the round's single occupied slot is stated at the top
       before anything is offered. */
    var now = state.armed
      ? '<p class="fxch-now" data-on="1">'
          + chipFill("fxChipsOn", lang, { n: state.gw, chip: chipT(state.armed.nameKey, lang) })
        + "</p>"
      : '<p class="fxch-now">' + chipFill("fxChipsNone", lang) + "</p>";

    var order = state.half === 1 ? [1, 2] : [2, 1];

    return '<section class="card fxch">'
      + '<header class="fxch-hd">'
        + '<h3 class="fxch-ttl">' + chipFill("fxChipsTtl", lang) + "</h3>"
        + '<p class="fxch-sub">' + chipFill("fxChipsSub", lang) + "</p>"
        + now
      + "</header>"
      + halfHtml(state, order[0])
      + halfHtml(state, order[1])
      + '<p class="fxch-ft">' + chipFill("fxChipFtNote", lang) + "</p>"
    + "</section>";
  }

  /* ---------------------------------------------------------------------------
     chipConfirmHtml(chip) — the confirmation moment.

     Irreversibility is stated plainly and DIFFERENTLY per chip, because the
     four are not equally irreversible:

       Free Hit       no cancel, ever, plus a revert that undoes the round's
                      transfers, plus a ban on the next round. Three sentences.
       Wildcard       cancellable while Pending — the rule stated in the user's
                      own terms ("up to two transfers"), not as a state name.
       Triple Captain cancellable, but it can be WASTED: both clubs blank and
                      the chip is gone anyway. One sentence of consequence.
       Full Squad     cancellable, and nothing can waste it. One line.

     The severity is carried by TYPE WEIGHT, BORDER WEIGHT AND LENGTH, never by
     colour. fantasy-color.md §C.2 gives --fx-urgent exactly one meaning — the
     last ten minutes before a deadline — and --fx-neg exactly one — a realised
     loss. Neither is a warning colour and neither is borrowed here.
     --------------------------------------------------------------------------- */
  var WARN = {
    freehit:   { key: "fxChipWarnFh", body: ["fxChipWarnFhA", "fxChipWarnFhB", "fxChipWarnFhC"], level: "final" },
    wildcard:  { key: "fxChipWarnWc", body: ["fxChipWarnWcA"], level: "conditional" },
    tripcap:   { key: "fxChipWarnTc", body: ["fxChipWarnTcA"], level: "soft" },
    fullsquad: { key: "fxChipWarnFs", body: ["fxChipWarnFsA"], level: "soft" }
  };

  function chipConfirmHtml(chip) {
    if (!chip) return "";
    var lang = chip.lang || "ar";
    var name = chipT(chip.nameKey, lang);
    var w = WARN[chip.chip] || WARN.fullsquad;

    /* Only one chip per round, so the confirm sheet has to be able to REFUSE.
       It states the blocking chip by name and offers no confirm button. */
    if (chip.state !== "available") {
      return '<div class="fxcf" data-level="blocked">'
        + '<h2 class="fxcf-ttl">' + chipEsc(name) + "</h2>"
        + '<p class="fxcf-blocked">'
          + (chip.reason ? chipFill(chip.reason, lang, chip.reasonVars)
                         : chipFill(stateKey(chip.state), lang))
        + "</p>"
        + '<button type="button" class="btn ghost" data-chip-dismiss="1">'
          + chipFill("fxChipNotNow", lang) + "</button>"
      + "</div>";
    }

    var body = "";
    for (var i = 0; i < w.body.length; i++) {
      body += '<p class="fxcf-wb">' + chipFill(w.body[i], lang) + "</p>";
    }

    return '<div class="fxcf" data-level="' + attr(w.level) + '" data-chip="' + attr(chip.id) + '">'
      + '<h2 class="fxcf-ttl">' + chipFill("fxChipArm", lang, { chip: name, n: chip.gw }) + "</h2>"

      + '<div class="fxcf-eff">'
        + '<span class="fxcf-glyph"' + (chip.glyphLtr ? ' dir="ltr"' : "") + ' aria-hidden="true">'
          + chipEsc(chip.glyph) + "</span>"
        + '<div class="fxcf-effb">'
          + '<span class="fxcf-efft">' + chipFill("fxChipEffTtl", lang) + "</span>"
          + '<p class="fxcf-effp">' + chipFill(chip.effKey, lang) + "</p>"
          + '<p class="fxcf-cost">'
            + chipFill(chip.costsTransfer ? "fxChipCost" : "fxChipNoCost", lang) + "</p>"
        + "</div>"
      + "</div>"

      + '<div class="fxcf-warn" data-level="' + attr(w.level) + '">'
        + '<p class="fxcf-wh">' + chipFill(w.key, lang) + "</p>"
        + body
      + "</div>"

      + '<button type="button" class="btn fxcf-go" data-chip-confirm="' + attr(chip.id) + '">'
        + chipFill("fxChipConfirm", lang) + "</button>"
      + '<button type="button" class="btn ghost" data-chip-dismiss="1">'
        + chipFill("fxChipNotNow", lang) + "</button>"
    + "</div>";
  }


  /* ==========================================================================
     7. EXPORT
     ========================================================================== */

  var API = {
    CHIP_STR: CHIP_STR,
    CHIP_FAMILIES: ORDER,
    chipT: chipT,
    chipFill: chipFill,
    chipFillText: chipFillText,
    chipEsc: chipEsc,
    chipNum: chipNum,
    chipState: chipState,
    chipFreeTransfers: chipFreeTransfers,
    applyChip: applyChip,
    chipsHtml: chipsHtml,
    chipCardHtml: chipCardHtml,
    chipConfirmHtml: chipConfirmHtml
  };

  if (typeof module === "object" && module && module.exports) {
    module.exports = API;                 /* Node — this is how the test reaches it */
  } else {
    for (var x in API) {                  /* browser — bare calls, house style */
      if (Object.prototype.hasOwnProperty.call(API, x)) glob[x] = API[x];
    }
  }

})(typeof globalThis === "object" ? globalThis : this);
