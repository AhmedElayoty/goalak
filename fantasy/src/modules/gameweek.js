/* ============================================================================
   GOALLAK FANTASY — THE GAMEWEEK EXPLANATION SYSTEM
   Implements design/fantasy-gameweek-explained.md §A, §B, §C, §E, §F, §I, §J.

   ----------------------------------------------------------------------------
   INTEGRATION NOTE — read this before dropping it in
   ----------------------------------------------------------------------------

   FILES
     modules/gameweek.css   — paste inside the existing <style> block, or link it.
                              It declares no tokens; it consumes the --fx-* set
                              that :root already defines in index.html.
     modules/gameweek.js    — paste inside the existing <script>, or load it
                              BEFORE the script that calls it.

   WHAT IT EXPORTS
     In a browser it assigns these onto the global object, so they are callable
     bare, exactly like the app's own render helpers:

       GW_STR                              bilingual [ar, en] pairs, STR-shaped
       gwExplainerHtml(state)   -> string
       gwCalendarHtml(state)    -> string
       gwDeadlineHtml(ms, state)-> string
       gwBadge(state)           -> string
       gwBlankSheetHtml(state)  -> string
       gwT(key, lang)           -> string   (raw, unescaped — for aria/title)
       gwFill(key, lang, vars)  -> string   (escaped HTML, numbers dir="ltr")

     In Node it sets module.exports instead, which is how gameweek.test.mjs
     reaches it.

   MERGING THE STRINGS
     Object.assign(STR, GW_STR);
     Nothing in GW_STR collides with the demo's current STR. Every key is
     fx-prefixed except the six gwm* diagram keys. After the merge the app's own
     t() reaches all of them and gwT() is only needed if you want a lookup that
     does not read the LANG global.

     Two RETIREMENTS the spec calls for (§A.3, §L.6):
       • fxLongRoundWhy is retired — it now duplicates fxGwOne sentence two.
         Both call-sites take fxGwOne + fxGwOneWhy.
       • The existing CM-4 and CM-8 coach-mark bodies are REPLACED by fxCm4Ttl/
         fxCm4 and fxCm8Ttl/fxCm8. The coach-mark budget stays at nine; no tenth
         is requested.

   WHERE EACH FUNCTION MOUNTS
     gwExplainerHtml   -> How to Play, section 7.  Mount into the sheet body,
                          e.g. openSheet(gwExplainerHtml({lang:LANG, ...})).
                          Renders its own <section class="card gwx">.
     gwCalendarHtml    -> density:"full"   in #viewTeam, and inside the December
                          sheet and the Scottish disclosure.
                          density:"inline" inside the جولة طويلة chip expansion,
                          the ? beside the header date range, and §J's accordion
                          (gwBlankSheetHtml already embeds it).
     gwDeadlineHtml    -> the sticky FX-HEADER. Give it a host element with a
                          stable id — id="fxDeadline" is what the CSS assumes
                          nothing about, so any container works — and re-render
                          on the tick rate the returned markup declares in its
                          data-gw-tick attribute (1000 or 60000 ms).
     gwBadge           -> four surfaces, per spec §F.2: the club card on the
                          pitch (F2), the 5-round strip, every market row in the
                          picker and transfers, and the transfer confirm sheet.
                          Returns an inline <span>; it has no layout of its own.
     gwBlankSheetHtml  -> #viewPoints, replacing that section's innerHTML when
                          the finalised round contains one or more blanks.

   THE CTA CALLBACK
     gwBlankSheetHtml renders <button class="gwj-cta" data-gw-cta="17">. It
     carries no onclick, because these functions are pure. Bind it after mount:
       host.querySelector("[data-gw-cta]").onclick = () => showTeam();

   PURITY CONTRACT
     Every function takes state and returns an HTML string. No global reads, no
     DOM access, no Date.now(), no network, no localStorage, no mutation of the
     state passed in. That is what lets this drop into a file another engineer
     is restructuring without a merge hazard. `lang` is always passed in — the
     module never reads LANG.

   ESCAPING
     Nothing reaches the output un-escaped. gwFill() escapes the template first
     and then substitutes escaped values, so a club named `<img onerror=...>`
     renders as text. The only markup the module emits is markup it wrote.

   NOT BUILT, DELIBERATELY
     • §C.3's medium-density 5-round strip (the counts grid) is a different
       component with a different data shape and was not in scope. gwCalendarHtml
       covers §C.2 (full) and §C.4 (inline).
     • §G's December sheet and §H's Scottish disclosure are compositions of the
       parts here plus copy that is already in GW_STR (fxDec*, fxEarlyStart,
       fxCounted). No new function was needed for either.
   ============================================================================ */

;(function (glob) {
  "use strict";

  /* ==========================================================================
     0. PRIMITIVES
     ========================================================================== */

  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  /* Identical in behaviour to the app's own esc(). Duplicated rather than
     imported so this module has no dependency on index.html's load order. */
  function gwEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  /* Western digits everywhere, per the app's own rule. num() exists so that the
     one place a locale digit shift could creep in is this line, and it doesn't. */
  function gwNum(n) { return String(n); }

  /* A value that is purely numeric/punctuation gets dir="ltr" so a bidi run
     like "2 يوم 06:12" cannot reorder. A value that contains letters does NOT:
     "21 ديسمبر" is Arabic text whose digits the bidi algorithm already handles,
     and wrapping it would isolate it wrongly. */
  var NUMERIC = /^[\d.,:+\-−\/ ]+$/;

  /* t()-shaped lookup. Takes lang explicitly — the module never reads a global.
     Returns the RAW string: use it for aria-label and title, never for markup. */
  function gwT(key, lang) {
    var e = GW_STR[key];
    return e ? e[lang === "en" ? 1 : 0] : key;
  }

  /* The only way text enters the markup. Escapes the template, then substitutes
     escaped values, wrapping purely numeric ones in dir="ltr". */
  function gwFill(key, lang, vars) {
    var out = gwEsc(gwT(key, lang));
    if (!vars) return out;
    return out.replace(/\{(\w+)\}/g, function (m, name) {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) return m;
      var v = vars[name];
      if (v == null) return "";
      var s = gwEsc(typeof v === "number" ? gwNum(v) : v);
      return NUMERIC.test(String(v)) ? '<span dir="ltr">' + s + "</span>" : s;
    });
  }

  /* The same substitution for a plain-text sink (aria-label, title). */
  function gwFillText(key, lang, vars) {
    var out = gwT(key, lang);
    if (!vars) return out;
    return out.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name] == null ? "" : vars[name]) : m;
    });
  }

  function attr(v) { return gwEsc(v); }
  function isEn(lang) { return lang === "en"; }

  /* Accepts a name as a plain string or as an {ar, en} pair, so a caller can
     hand over the app's LEAGUES rows untouched. */
  function nameOf(o, lang) {
    if (o == null) return "";
    if (typeof o === "string") return o;
    if (typeof o.name === "string") return o.name;
    return (isEn(lang) ? (o.en || o.ar) : (o.ar || o.en)) || "";
  }


  /* ==========================================================================
     1. GW_STR — every user-visible string, [ar, en], STR-shaped
     ==========================================================================
     Merge with: Object.assign(STR, GW_STR)
     Sections map 1:1 onto the spec so a copy change can be traced back.
     ========================================================================== */

  var GW_STR = {

    /* ---- §A: the one sentence, and its obligatory companion ---------------- */
    /* The winner of eight candidates. Two sentences doing two different jobs:
       a definition, then a rule. Zero new vocabulary. */
    fxGwOne:  ["الجولة فترة بين إقفالين. كل ماتش تلعبه أنديتك جوّاها بيتحسب لك.",
               "A round is a period between two deadlines. Every match your clubs play inside it counts for you."],
    /* fxGwOneA is an ADDITION to the spec's key list: §A.3 names fxGwOne (both
       sentences) and fxGwOneB (sentence two as a separate node) but never names
       sentence one alone, which the hero layout needs. */
    fxGwOneA: ["الجولة فترة بين إقفالين.",
               "A round is a period between two deadlines."],
    fxGwOneB: ["كل ماتش تلعبه أنديتك جوّاها بيتحسب لك.",
               "Every match your clubs play inside it counts for you."],
    fxGwOneWhy: ["الدوريات السبعة مبتلعبش في نفس المواعيد، عشان كده في جولات أطول من التانية.",
                 "The seven leagues don't play on the same dates, so some rounds are longer than others."],

    /* ---- §B: the box. A teaching device, three call-sites, never a label ---- */
    fxGwBox:  ["كل جولة صندوق بتاريخين — كل ماتش جوّاه بيتحسب لك",
               "Each round is a box with two dates — every match inside it counts for you"],
    fxGwHowTtl: ["الجولة بتشتغل إزاي؟", "How the round works"],

    /* ---- §C: the calendar diagram ----------------------------------------- */
    fxGwTtl:      ["الجولة {n}", "Round {n}"],
    fxGwRange:    ["{from} – {to} · {days} يوم", "{from} – {to} · {days} days"],
    fxGwRange2:   ["{from} – {to} · يومين", "{from} – {to} · 2 days"],
    fxGwDays:     ["{n} يوم", "{n} days"],
    fxGwDays2:    ["يومين", "2 days"],
    fxLongRound:  ["جولة طويلة", "Long round"],
    fxGwLocksCap: ["بيقفل {d}", "Locks {d}"],
    fxGwLegMine:  ["ماتش لأنديتك", "A match for your clubs"],
    fxGwLegOther: ["ماتشات دوريات تانية", "Other leagues' matches"],
    fxGwLegNone:  ["مفيش ماتشات", "No matches"],
    fxGwNone:     ["مالوش ماتش", "No match"],
    fxGwCoverage: ["{a} من {b} نادي عندهم ماتش في الجولة دي",
                   "{a} of {b} clubs have a match in this round"],
    /* aria. The row-level facts are the ones a user acts on, so every row
       carries its own label as well as the diagram carrying one. */
    fxGwAria:     ["الجولة {n}، من {from} لـ {to}، {days} يوم. {a} من {b} نادي عندهم ماتش.",
                   "Round {n}, {from} to {to}, {days} days. {a} of {b} clubs have a match."],
    fxGwRowAria:  ["{league}: {n} أيام ماتشات — {list}", "{league}: {n} match days — {list}"],
    fxGwRowAria1: ["{league}: يوم ماتشات واحد — {list}", "{league}: 1 match day — {list}"],
    fxGwRowAriaNone: ["{league}: مفيش ماتشات في الجولة دي",
                      "{league}: no matches in this round"],
    fxGwRowAriaTbc:  ["{league}: مواعيد ماتشاته لسه ما نزلتش",
                      "{league}: its fixture dates are not published yet"],

    /* ---- §D: progressive explanation, the moments that fire ---------------- */
    fxWizGw:  ["الجولة الأولى: من {from} لـ {to}. كل ماتش تلعبه أنديتك فيها بيتحسب لك.",
               "Round 1: {from} to {to}. Every match your clubs play in it counts for you."],
    /* CM-4, rewritten. The load-bearing clause is "after the round ends, not
       now" — every fantasy support queue in the world contains this question. */
    fxCm4Ttl: ["ناديك مالوش ماتش الجولة دي.", "This club has no match this round."],
    fxCm4:    ["بديل بياخد مكانه — بعد ما تخلص الجولة، مش دلوقتي.",
               "A substitute takes his place — after the round ends, not now."],
    /* CM-8, rewritten: the consequence the user actually cares about is the
       captaincy decision, so it is no longer buried. */
    fxCm8Ttl: ["النادي ده بيلعب مرتين الجولة دي.", "This club plays twice this round."],
    fxCm8:    ["نقط الماتشين بتتضاف لك — ولو خليته كابتن، الاتنين بيتضاعفوا.",
               "You get the points from both — and if you captain him, both are doubled."],
    fxSubFirst: ["ده حصل لوحده بعد ما خلصت الجولة. مش محتاج تعمل حاجة.",
                 "This happened automatically after the round ended. You don't need to do anything."],

    /* ---- §E: the deadline. One merged ladder, replacing two --------------- */
    fxLocksOn:   ["بيقفل {d}", "Locks {d}"],
    fxLocksInD:  ["بيقفل خلال {n} يوم", "Locks in {n} days"],
    fxLocksInD2: ["بيقفل خلال يومين", "Locks in 2 days"],
    fxLocksInDH: ["بيقفل خلال {n} يوم {t}", "Locks in {n}d {t}"],
    fxLocksInDH1:["بيقفل خلال يوم {t}", "Locks in 1d {t}"],
    fxLocksIn:   ["بيقفل خلال {t}", "Locks in {t}"],
    fxUnder3h:   ["باقي أقل من 3 ساعات", "Under 3 hours left"],
    fxUnder1h:   ["باقي أقل من ساعة", "Under an hour left"],
    /* Arabic has a dual. "باقي 2 دقايق" is wrong and this string is on screen
       during the most-watched sixty seconds of the week. */
    fxMinsLeft:  ["باقي {n} دقايق", "{n} minutes left"],
    fxMinsLeft1: ["باقي دقيقة واحدة", "1 minute left"],
    fxMinsLeft2: ["باقي دقيقتين", "2 minutes left"],
    fxSecsLeft:  ["باقي أقل من دقيقة", "Under a minute left"],
    fxInPlay:    ["الجولة شغّالة", "Round in play"],
    fxAwaiting:  ["مستني التأكيد", "Awaiting confirmation"],
    fxConfirmOn: ["بتبقى نهائية {d}", "Confirmed {d}"],
    /* §E.2 — the locked-but-running state. Without these three strings the app
       shows next round's countdown under this round's title for thirteen days
       and the user concludes their team is still editable. It is not. */
    fxLocked:    ["مقفلة", "Locked"],
    fxNextLocks: ["الجولة {n} بتقفل خلال {t}", "Round {n} locks in {t}"],
    /* the > 7 d form of the same idea: at that distance the header shows a DATE,
       not a duration, and "locks in Saturday 26 December" is not a sentence. */
    fxNextLocksOn: ["الجولة {n} بتقفل {d}", "Round {n} locks {d}"],
    fxLockedWhy: ["جولتك أقفلت يوم {d}. أي تغيير تعمله دلوقتي هيتحسب على الجولة {n}.",
                  "Your round locked on {d}. Changes you make now apply to round {n}."],
    fxClockNote: ["ساعة السيرفر هي اللي بتتحسب. ساعة تليفونك مبتأثرش.",
                  "The server clock is the one that counts. Your device clock has no effect."],
    /* §E.5 — missing the deadline. No red, no "you missed it", no streak. */
    fxMissed:    ["الجولة أقفلت وفريقك زي ما هو. انتقالك المجاني اتحفظلك.",
                  "The round locked with your team unchanged. Your free transfer is saved."],
    /* §E.4 — push. Two per round, never between 00:00 and 07:00 local. */
    fxPush24:    ["الجولة {n} بتقفل بكرة {t}. عندك {k} أندية مالهاش ماتش.",
                  "Round {n} locks tomorrow at {t}. {k} of your clubs don't play."],
    fxPush24No:  ["الجولة {n} بتقفل بكرة {t}.", "Round {n} locks tomorrow at {t}."],
    fxPush3:     ["باقي 3 ساعات على إقفال الجولة {n}.", "3 hours until round {n} locks."],

    /* ---- §F: blanks, doubles, and the third state nobody specified -------- */
    fxNoPlay:    ["مالوش ماتش", "No match"],
    fxPlays2:    ["بيلعب مرتين", "Plays twice"],
    fxPlays3:    ["بيلعب 3 مرات", "Plays 3 times"],
    fxPlaysN:    ["بيلعب {n} مرات", "Plays {n} times"],
    fxTbc:       ["الميعاد ما اتحددش", "Date not set"],
    fxTbcWhy:    ["الدوري الاسكتلندي بيقسم جدوله في أبريل. ماتشاته بتنزل وقتها وبتتحسب عادي.",
                  "The Scottish league splits its schedule in April. Its fixtures are published then and count normally."],
    /* يغيب, not مالوش ماتش — this is forward-looking, and Arabic has a precise
       verb for it that every fan already uses. The two must never be swapped:
       مالوش ماتش on a badge about THIS round, يغيب in prose about a coming one. */
    fxWillBlank:    ["يغيب في الجولات: {list}", "No match in rounds: {list}"],
    fxWillBlankWhy: ["دوريه بيوقف من {from} لـ {to}.", "His league pauses from {from} to {to}."],
    fxReliefNote:   ["الجولة الجاية طويلة و{n} من أنديتك مالهاش ماتش. إدينالك انتقال مجاني زيادة.",
                     "Next round is long and {n} of your clubs don't play. We've given you an extra free transfer."],

    /* ---- §G: the December window. Tokenised — no hard-coded dates --------- */
    fxDecNote: ["الجولة الجاية أطول جولة في الموسم — {days} يوم. دوس تشوف مين هيلعب ومين لأ.",
                "The next round is the longest of the season — {days} days. Tap to see who plays and who doesn't."],
    fxDecTtl:  ["الجولة {n} — أطول جولة في الموسم", "Round {n} — the longest round of the season"],
    fxDecWhyH: ["ليه؟", "Why?"],
    fxDecWhy:  ["الدوريات السبعة مبتلعبش في نفس المواعيد. الإنجليزي والاسكتلندي بيلعبوا طول الأعياد، والألماني والتركي بيوقفوا. بدل ما نعمل جولة مفيش فيها غير نادي أو اتنين بيلعبوا، عملناها جولة واحدة طويلة.",
                "The seven leagues don't play on the same dates. England and Scotland play right through the holidays; Germany and Türkiye stop. Rather than make a round in which almost nobody plays, we made one long round."],
    fxDecYouH: ["ده يعني إيه ليك؟", "What it means for you"],
    fxDecP3:   ["أنديتك اللي بتلعب 3 مرات", "Your clubs playing 3 times"],
    fxDecP2:   ["أنديتك اللي بتلعب مرتين", "Your clubs playing twice"],
    fxDecP1:   ["أنديتك اللي بتلعب مرة", "Your clubs playing once"],
    fxDecP0:   ["أنديتك اللي مالهاش ماتش", "Your clubs not playing"],
    fxDecCap:  ["الكابتن بتاعك ينفع يجيب نقط من {n} ماتشات في الجولة دي.",
                "Your captain can score from {n} matches this round."],
    fxDecCta:  ["رتّب فريقك للجولة {n}", "Sort out your team for round {n}"],

    /* ---- §H: the Scottish problem. Symmetric framing, never apologetic ---- */
    fxCounted:    ["ماتشاته اللي بتتحسب الموسم ده", "Matches that count this season"],
    fxEarlyStart: ["موسم الفانتازي بيبدأ {date} لكل الأندية. {league} بدأ قبل كده، فأول ماتشاته مبتتحسبش — زي أي دوري بدأ قبل {date}. سعره متحسب على {n} ماتش.",
                   "The fantasy season starts {date} for every club. {league} started earlier, so its first matches don't count — the same as every league that started before {date}. Its price is set on {n} matches."],

    /* ---- §J: "why did I score nothing?" ----------------------------------- */
    fxGwPts:      ["نقاط الجولة", "Round points"],
    fxFinal:      ["نهائي", "Final"],
    fxProvisional:["مؤقت", "Provisional"],
    fxBlankSum:   ["{n} من أنديتك مكانش عندهم ماتش في الجولة دي.",
                   "{n} of your clubs had no match this round."],
    fxBlankSum1:  ["نادي واحد من أنديتك مكانش عنده ماتش في الجولة دي.",
                   "1 of your clubs had no match this round."],
    fxBlankSub:   ["دخل {k} بدلاء مكانهم، والباقي صفر.",
                   "{k} substitutes came in for them; the rest scored zero."],
    fxBlankSub1:  ["دخل بديل واحد مكانهم، والباقي صفر.",
                   "1 substitute came in for them; the rest scored zero."],
    fxBlankSubAll:["دخل بدلاء مكانهم كلهم.", "Substitutes came in for all of them."],
    fxBlankSubNone:["مدخلش ولا بديل — دول كمان مكانش عندهم ماتشات.",
                    "No substitute came in — they had no matches either."],
    fxBlankWhyCta:["ليه ما لعبوش؟", "Why didn't they play?"],
    fxLeaguePaused:["{league} وقف من {date}", "{league} paused from {date}"],
    fxSubIn:      ["دخل مكانه: {name}", "Came on for him: {name}"],
    fxBenchN:     ["بديل {n}", "Sub {n}"],
    fxNoSubLeft:  ["مفيش بديل عنده ماتش", "No substitute had a match"],
    fxCaptainOf:  ["الكابتن", "Captain"],
    fxMatchesN:   ["{n} ماتشات", "{n} matches"],
    fxMatches1:   ["ماتش واحد", "1 match"],
    fxMatches2:   ["ماتشين", "2 matches"],
    fxBackNext:   ["أنديتك هترجع تلعب في الجولة {n}", "Your clubs are playing again in round {n}"],
    fxBackNextD:  ["{date} — كلهم عندهم ماتش إلا {k}.",
                   "{date} — all of them have a match except {k}."],
    fxBackNextAll:["{date} — كلهم عندهم ماتش.", "{date} — all of them have a match."],
    fxRelief:     ["جولتك كانت شبه فاضية، عشان كده انتقالاتك ببلاش لحد الجولة الجاية.",
                   "Your round was almost empty, so your transfers are free until the next round."],

    /* ---- §K.3: the trust claim. The one piece of machinery that ships ----- */
    fxCalOpen: ["جدول الجولات كله متحسب ومنشور قبل ما الموسم يبدأ، ومبيتغيرش.",
                "The whole round calendar is calculated and published before the season starts, and it does not change."],

    /* ---- §I: glossary additions. Numbering continues from 36 --------------
       Shape matches the demo's GLOSSARY rows: [term, english, definition].
       3' and 4' AMEND existing rows; 37–41 and 44 are new. 42 (coverage) and
       43 (window) are deliberately not shipped and so have no strings. */
    fxGl3Term:  ["الجولة", "Round"],
    fxGl3Def:   ["فترة بين إقفالين. كل ماتش تلعبه أنديتك جوّاها بيتحسب لك.",
                 "A period between two deadlines. Every match your clubs play inside it counts for you."],
    fxGl4Term:  ["ميعاد الإقفال", "Deadline"],
    fxGl4Def:   ["آخر وقت تقدر تغيّر فيه فريقك. بعد كده يقفل لحد ما الجولة الجاية تبدأ.",
                 "The last moment you can change your team. After it, it stays locked until the next round starts."],
    fxGl37Term: ["فترة الجولة", "Round dates"],
    fxGl37Def:  ["من {from} لـ {to} · {n} يوم", "From {from} to {to} · {n} days"],
    fxGl38Term: ["جولة طويلة", "Long round"],
    fxGl38Def:  ["جولة أطول من الأسبوع، عشان الدوريات مبتلعبش في نفس المواعيد.",
                 "A round longer than a week, because the leagues don't play on the same dates."],
    fxGl39Term: ["يغيب", "Will miss"],
    fxGl39Def:  ["ناديك مالوش ماتش في جولة جاية.", "Your club has no match in a coming round."],
    fxGl40Term: ["بيلعب 3 مرات", "Plays 3 times"],
    fxGl40Def:  ["ناديك عنده 3 ماتشات في الجولة دي، وكلها بتتحسب.",
                 "Your club has 3 matches this round, and all of them count."],
    fxGl41Term: ["الميعاد ما اتحددش", "Date not set"],
    fxGl41Def:  ["دوريه لسه ما نزلش ميعاد الماتش. بتتحسب عادي أول ما ينزل.",
                 "His league hasn't published the match date yet. It counts normally once it does."],
    fxGl44Term: ["الصندوق", "The box"],
    fxGl44Def:  ["كل جولة صندوق بتاريخين — كل ماتش جوّاه بيتحسب لك.",
                 "Each round is a box with two dates — every match inside it counts for you."]
  };


  /* ==========================================================================
     2. gwCalendarHtml(state)                                        [spec §C]
     ==========================================================================
     state = {
       lang:    "ar" | "en",
       density: "full" (default) | "inline",
       gw:      16,
       from:    "21 ديسمبر",  to: "4 يناير",  days: 14,
       long:    true,                       // render the جولة طويلة chip
       clubsPlaying: 90, clubsTotal: 126,   // the coverage caption
       leagues: [{
         name:  "الدوري الإنجليزي" | {ar, en},
         mine:  true,                       // you own clubs in it -> gold
         state: "plays" | "none" | "tbc",   // optional; inferred from days[]
         days:  [{ t: 35.7, n: 10, label: "26 ديسمبر" }, ...]
       }]
     }
     A day is { t: percent of the window elapsed at kick-off 0..100, n: matches
     that day, label: how to say the date }. If t is absent it is derived from
     `day` (0-based index into the window), which is what a generator emits.
     -------------------------------------------------------------------------- */

  /* One dot per calendar day, sized by match count: three sizes, monotonic —
     the "never colour alone" rule applied to time.                [spec §C.2] */
  function gwDotSize(n) {
    if (n >= 8) return 12;
    if (n >= 4) return 9;
    return 6;
  }

  function gwDayT(d, days) {
    if (d && typeof d.t === "number") return d.t;
    var idx = (d && typeof d.day === "number") ? d.day : 0;
    var span = days > 0 ? days : 1;
    /* centre of the day cell, so a dot never sits on a rail */
    return Math.max(0, Math.min(100, ((idx + 0.5) / span) * 100));
  }

  function gwRowAria(lg, lang) {
    var nm = nameOf(lg.name, lang);
    var st = gwLeagueState(lg);
    if (st === "tbc") return gwFillText("fxGwRowAriaTbc", lang, { league: nm });
    if (st === "none") return gwFillText("fxGwRowAriaNone", lang, { league: nm });
    var list = (lg.days || []).map(function (d) { return d.label || ""; })
      .filter(Boolean).join(lang === "en" ? ", " : "، ");
    var n = (lg.days || []).length;
    return gwFillText(n === 1 ? "fxGwRowAria1" : "fxGwRowAria", lang,
      { league: nm, n: n, list: list });
  }

  function gwLeagueState(lg) {
    if (lg.state) return lg.state;
    if (lg.tbc) return "tbc";
    return (lg.days && lg.days.length) ? "plays" : "none";
  }

  function gwDaysLabel(days, lang) {
    return days === 2 ? gwFill("fxGwDays2", lang) : gwFill("fxGwDays", lang, { n: days });
  }

  function gwCalendarHtml(state) {
    var s = state || {};
    var lang = s.lang === "en" ? "en" : "ar";
    var days = typeof s.days === "number" && s.days > 0 ? s.days : 1;
    var leagues = Array.isArray(s.leagues) ? s.leagues : [];
    var inline = s.density === "inline";

    var rows = leagues.map(function (lg) {
      var st = gwLeagueState(lg);
      var dots = (lg.days || []).map(function (d) {
        var size = gwDotSize(d && typeof d.n === "number" ? d.n : 1);
        return '<i class="gwm-d" style="--t:' + attr(gwDayT(d, days).toFixed(2)) +
               ";--s:" + attr(size) + 'px"></i>';
      }).join("");

      var track;
      if (st === "none") {
        track = '<div class="gwm-t none"><span>' + gwFill("fxGwNone", lang) + "</span></div>";
      } else if (st === "tbc") {
        track = '<div class="gwm-t tbc"><span>' + gwFill("fxTbc", lang) + "</span></div>";
      } else {
        track = '<div class="gwm-t">' + dots + "</div>";
      }

      return '<div class="gwm-r' + (lg.mine ? " mine" : "") + '" role="img" aria-label="' +
             attr(gwRowAria(lg, lang)) + '">' +
             (inline ? "" : '<div class="gwm-l">' + gwEsc(nameOf(lg.name, lang)) + "</div>") +
             track + "</div>";
    }).join("");

    /* ---- inline density: one track, two rails, the day count. No labels, no
       legend. Its whole job is to make "فترة بين إقفالين" visible in the same
       eyeful as the sentence that uses it.                        [spec §C.4] */
    if (inline) {
      return '<span class="gwm-inline-w">' +
        '<span class="gwm gwm--inline" style="--days:' + attr(days) + '" aria-hidden="true">' +
          rows +
        "</span>" +
        '<span class="gwm-inline-d">' + gwDaysLabel(days, lang) + "</span>" +
      "</span>";
    }

    /* ---- full density ---- */
    var ariaWhole = gwFillText("fxGwAria", lang, {
      n: s.gw, from: s.from, to: s.to, days: days,
      a: s.clubsPlaying, b: s.clubsTotal
    });

    var head =
      '<div class="gwm-hd">' +
        '<span class="gwm-gw">' + gwFill("fxGwTtl", lang, { n: s.gw }) + "</span>" +
        (s.long ? '<span class="gwm-chip">' + gwFill("fxLongRound", lang) + "</span>" : "") +
      "</div>" +
      '<div class="gwm-dt">' +
        (days === 2
          ? gwFill("fxGwRange2", lang, { from: s.from, to: s.to })
          : gwFill("fxGwRange", lang, { from: s.from, to: s.to, days: days })) +
      "</div>";

    /* The two rail captions. Start rail = this round's deadline, end rail = the
       next one. In RTL that reads right to left with no markup change. */
    var caps =
      '<div class="gwm-caps" aria-hidden="true">' +
        "<span>" + gwFill("fxGwLocksCap", lang, { d: s.from }) + "</span>" +
        "<span>" + gwFill("fxGwLocksCap", lang, { d: s.to }) + "</span>" +
      "</div>";

    var legend =
      '<div class="gwm-lg" aria-hidden="true">' +
        '<span><i class="mine"></i>' + gwFill("fxGwLegMine", lang) + "</span>" +
        "<span><i></i>" + gwFill("fxGwLegOther", lang) + "</span>" +
        '<span><i class="none"></i>' + gwFill("fxGwLegNone", lang) + "</span>" +
      "</div>";

    var coverage = (s.clubsPlaying != null && s.clubsTotal != null)
      ? '<div class="gwm-cov">' +
          gwFill("fxGwCoverage", lang, { a: s.clubsPlaying, b: s.clubsTotal }) +
        "</div>"
      : "";

    /* DEVIATION, stated as required: spec §C.2 puts role="img" plus a full
       aria-label on the WHOLE diagram and also on every row. Those cannot both
       reach a screen reader — role="img" makes its subtree invisible, so the
       row labels would be dropped. The wrapper takes role="group" with the
       whole-diagram label and each row keeps role="img" with its own. Both
       facts survive, which is what §C.2 is actually asking for. */
    return '<figure class="gwm-w" role="group" aria-label="' + attr(ariaWhole) + '">' +
      head +
      '<div class="gwm" style="--days:' + attr(days) + '">' + caps + rows + "</div>" +
      "<figcaption>" + legend + coverage + "</figcaption>" +
    "</figure>";
  }


  /* ==========================================================================
     3. gwExplainerHtml(state)                                   [spec §A, §B]
     ==========================================================================
     state = { lang, days, gw, from, to, leagues[] }  — everything optional
     except lang. If `days` is present the box carries the §C.4 inline diagram,
     which is what makes "a period between two deadlines" visible rather than
     merely stated.
     -------------------------------------------------------------------------- */

  function gwExplainerHtml(state) {
    var s = state || {};
    var lang = s.lang === "en" ? "en" : "ar";

    var diagram = "";
    if (typeof s.days === "number" && s.days > 0) {
      diagram = gwCalendarHtml({
        lang: lang, density: "inline", days: s.days,
        leagues: (Array.isArray(s.leagues) && s.leagues.length)
          ? [s.leagues[0]]
          : [{ mine: true, days: s.dots || [] }]
      });
    }

    return '<section class="card gwx">' +
      '<h3 class="gwx-h">' + gwFill("fxGwHowTtl", lang) + "</h3>" +

      /* THE HERO. Sentence one is a definition, sentence two is a rule, and
         they are separate nodes on purpose: a reader who absorbs only the first
         still has the mental model.                               [spec §A.3] */
      '<p class="gwx-hero">' + gwFill("fxGwOneA", lang) +
        "<b>" + gwFill("fxGwOneB", lang) + "</b>" +
      "</p>" +

      /* the obligatory companion — it converts the definition into the one
         visible consequence. Wherever fxGwOne appears, this appears beneath. */
      '<p class="gwx-why">' + gwFill("fxGwOneWhy", lang) + "</p>" +

      /* THE BOX. One sentence and the mini diagram, per §B.4's call-site table.
         Not the full three-line §B.1 statement: that is the internal
         description of the mental model, not shipped copy, and at 360 px the
         one sentence plus the picture is what fits and what lands. */
      '<div class="gwx-box">' +
        diagram +
        '<p class="gwx-boxline">' + gwFill("fxGwBox", lang) + "</p>" +
      "</div>" +

      /* the trust claim: not "here is our algorithm" but "this was decided
         before your first transfer and nobody can move it now".   [spec §K.3] */
      '<p class="gwx-trust">' + gwFill("fxCalOpen", lang) + "</p>" +
    "</section>";
  }


  /* ==========================================================================
     4. gwDeadlineHtml(msLeft, state)                                [spec §E]
     ==========================================================================
     One ladder, replacing the two that contradicted each other: the UI
     document's formats with the engagement document's 3 h threshold, but 10 m
     and not 15 m for the pulse — a pulsing header for a quarter of an hour is
     harassment.                                                   [spec §E.1]

     msLeft = milliseconds to the deadline that OPENS the next round. Negative
     or zero means it has passed.
     state = {
       lang, gw, nextGw,
       locksOn:  "السبت 26 ديسمبر",   // for the > 7 d tier
       live:     false,               // matches are being played right now
       confirmAt:"الاثنين 06:00",     // for the awaiting-final state
       locked:   false,               // §E.2 — this round is locked and running
       lockedOn: "19 ديسمبر"          // the day it locked, for fxLockedWhy
     }

     SIGNATURE NOTE: the brief names gwDeadlineHtml(msLeft). The second argument
     is required because the function is pure and cannot read LANG, the round
     number or the lock date from a global. Calling it with one argument still
     works and yields Arabic.
     -------------------------------------------------------------------------- */

  var MIN = 60000, HOUR = 3600000, DAY = 86400000;

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function gwHms(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return pad2(Math.floor(s / 3600)) + ":" + pad2(Math.floor(s / 60) % 60) + ":" + pad2(s % 60);
  }
  function gwMs(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return pad2(Math.floor(s / 60)) + ":" + pad2(s % 60);
  }
  function gwHm(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return pad2(Math.floor(s / 3600) % 24) + ":" + pad2(Math.floor(s / 60) % 60);
  }

  /* Days are floored, never rounded. Flooring understates the time you have
     left, which is the safe direction for a deadline: it can only make someone
     act earlier than necessary. */
  function gwTier(ms) {
    if (ms <= 0)      return "passed";
    if (ms < 10 * MIN) return 7;
    if (ms < HOUR)     return 6;
    if (ms < 3 * HOUR) return 5;
    if (ms < DAY)      return 4;
    if (ms < 2 * DAY)  return 3;
    if (ms <= 7 * DAY) return 2;
    return 1;
  }

  function gwDeadlineHtml(msLeft, state) {
    var s = state || {};
    var lang = s.lang === "en" ? "en" : "ar";
    var ms = typeof msLeft === "number" && isFinite(msLeft) ? msLeft : 0;
    var tier = gwTier(ms);

    /* `dur` is the duration ALONE, as plain text — "3 يوم", "06:12:44". It is
       kept separate from `val` (which is the whole "Locks in …" sentence)
       because the §E.2 locked state has to re-say the duration inside a
       different sentence, and re-using `val` there would print the verb twice. */
    var cls = "gwdl", tick = 60000, lab = "", val = "", dur = null, pulse = false;

    if (tier === "passed") {
      if (s.live) {
        cls += " gwdl--live"; tick = 0; pulse = true;
        val = gwFill("fxInPlay", lang);
      } else {
        cls += " gwdl--wait"; tick = 0;
        lab = gwFill("fxAwaiting", lang);
        val = s.confirmAt ? gwFill("fxConfirmOn", lang, { d: s.confirmAt }) : "";
      }
    } else {
      cls += " gwdl--t" + tier;
      if (tier === 1) {
        lab = "";
        val = gwFill("fxLocksOn", lang, { d: s.locksOn || "" });
        tick = 60000;
      } else if (tier === 2) {
        var d2 = Math.floor(ms / DAY);
        dur = d2 === 2 ? gwT("fxGwDays2", lang) : gwFillText("fxGwDays", lang, { n: d2 });
        val = d2 === 2 ? gwFill("fxLocksInD2", lang) : gwFill("fxLocksInD", lang, { n: d2 });
        tick = 60000;
      } else if (tier === 3) {
        /* 48 h → 24 h, so the day count here is always 1. Spec §E.1's worked
           example prints "2 يوم 06:12" against this row, which is 54 h and
           therefore belongs to the row above it; the arithmetic is followed
           rather than the example. */
        dur = gwFillText("fxGwDays", lang, { n: 1 }) + " " + gwHm(ms % DAY);
        val = gwFill("fxLocksInDH1", lang, { t: gwHm(ms % DAY) });
        tick = 60000;
      } else if (tier === 4) {
        dur = gwHms(ms);
        val = gwFill("fxLocksIn", lang, { t: dur });
        tick = 1000;
      } else if (tier === 5) {
        dur = gwHms(ms);
        lab = gwFill("fxUnder3h", lang);
        val = '<span dir="ltr">' + gwEsc(dur) + "</span>";
        tick = 1000;
      } else if (tier === 6) {
        dur = gwHms(ms);
        lab = gwFill("fxUnder1h", lang);
        val = '<span dir="ltr">' + gwEsc(dur) + "</span>";
        tick = 1000;
      } else {
        /* < 10 m. The only state in the product that pulses: one timer, one
           meaning, and nothing else here ever counts down.        [spec §E.1] */
        var mins = Math.floor(ms / MIN);
        dur = gwMs(ms);
        lab = ms < MIN ? gwFill("fxSecsLeft", lang)
            : mins === 1 ? gwFill("fxMinsLeft1", lang)
            : mins === 2 ? gwFill("fxMinsLeft2", lang)
            : gwFill("fxMinsLeft", lang, { n: mins });
        val = '<span dir="ltr">' + gwEsc(dur) + "</span>";
        tick = 1000; pulse = true;
      }
    }

    /* §E.2 — the countdown ALWAYS names the round it opens. On a 14-day round
       the header would otherwise show next round's deadline under this round's
       title for thirteen days, and a user reading "locks in 8 days" under
       "Round 16" reasonably concludes Round 16 is still editable. It is not.
       This is the difference between "the app is broken" and "I understand the
       app", and it costs one line. */
    var locked = "";
    if (s.locked) {
      if (dur != null) {
        lab = gwFill("fxNextLocks", lang, { n: s.nextGw, t: dur });
        val = "";
      } else if (tier === 1) {
        /* DEVIATION, stated as required. §E.2's worked example shows
           "الجولة 17 تقفل خلال 8 يوم" — a DURATION at 8 days out. But the same
           document's tier 1 (> 7 d) prints a DATE, and §J.4 argues the case
           itself: a nine-day countdown is not motivation, it is permission to
           close the app. So beyond 7 days the locked sentence takes the date
           form. Everything §E.2 actually asks for — the countdown naming the
           round it opens — is delivered either way. */
        lab = gwFill("fxNextLocksOn", lang, { n: s.nextGw, d: s.locksOn || "" });
        val = "";
      }
      /* tier "passed": the round is locked AND running, so الجولة شغّالة stays
         as the value — there is no next-round duration to name yet. */
      locked =
        '<span class="gwdl-lock"><span aria-hidden="true">&#128274;</span>' +
          gwFill("fxLocked", lang) +
        "</span>" +
        (s.lockedOn != null
          ? '<div class="gwdl-why">' +
              gwFill("fxLockedWhy", lang, { d: s.lockedOn, n: s.nextGw }) +
            "</div>"
          : "");
    }

    var dot = pulse ? '<span class="gwdot" aria-hidden="true"></span>' : "";

    return '<div class="' + cls + '" data-gw-tier="' + attr(tier) +
             '" data-gw-tick="' + attr(tick) + '">' +
      (lab ? '<div class="gwdl-lab">' + dot + lab + "</div>" : "") +
      (val ? '<div class="gwdl-val">' + (lab ? "" : dot) + val + "</div>" : "") +
      locked +
    "</div>";
  }


  /* ==========================================================================
     5. gwBadge(state)                                               [spec §F]
     ==========================================================================
     state = { lang, kind, matches, scheduled }
       kind: "plays" | "blank" | "double" | "triple" | "tbc"
       If kind is absent it is derived: scheduled === false -> "tbc";
       matches 0 -> "blank", 1 -> "plays", 2 -> "double", 3+ -> "triple".

     "plays" returns the EMPTY STRING. Playing once is the default and is never
     badged — badging the normal case is how a badge stops meaning anything.

     Four states, not two. The fourth is load-bearing: 30 of 228 Scottish
     fixtures have no published date on day one, and without "date not set"
     every Celtic and Rangers owner is told something false for seven
     consecutive rounds in the run-in.                       [spec §F.1, §H.3]
     -------------------------------------------------------------------------- */

  function gwBadgeKind(s) {
    if (s.kind) return s.kind;
    if (s.scheduled === false) return "tbc";
    var n = typeof s.matches === "number" ? s.matches : 1;
    if (n <= 0) return "blank";
    if (n === 1) return "plays";
    if (n === 2) return "double";
    return "triple";
  }

  function gwBadge(state) {
    var s = state || {};
    var lang = s.lang === "en" ? "en" : "ar";
    var kind = gwBadgeKind(s);
    var n = typeof s.matches === "number" ? s.matches : 0;

    /* The default. Never badged.                                  [spec §F.1] */
    if (kind === "plays") return "";

    var cls, glyph, key, vars = null;

    if (kind === "blank") {
      /* pill + ⊘ — the shape channel, so the state survives a colour-blind
         reader and a greyscale screenshot.        [fantasy-color.md §E.3] */
      cls = "gwb--blank"; glyph = "⊘"; key = "fxNoPlay";
    } else if (kind === "double") {
      cls = "gwb--double"; glyph = "● ●"; key = "fxPlays2";
    } else if (kind === "triple") {
      cls = "gwb--triple"; glyph = "● ● ●";
      if (n > 3) { key = "fxPlaysN"; vars = { n: n }; } else { key = "fxPlays3"; }
    } else {
      /* Date not set. No glyph: the dashed border IS the non-colour channel,
         and it is the only dashed border in the Fantasy design so that it can
         never be mistaken at a glance for the solid "no match".  [spec §F.1] */
      cls = "gwb--tbc"; glyph = ""; key = "fxTbc";
    }

    return '<span class="gwb ' + cls + '">' +
      (glyph ? '<i aria-hidden="true">' + glyph + "</i>" : "") +
      gwFill(key, lang, vars) +
    "</span>";
  }


  /* ==========================================================================
     6. gwBlankSheetHtml(state)                                      [spec §J]
     ==========================================================================
     The "why did I score nothing?" screen, for a user who is not curious but
     annoyed and is one screen away from deciding the game is rigged.

     SIGNATURE NOTE: the brief names gwBlankSheetHtml(club). §J is a SQUAD-level
     screen — the score, the count of blanked clubs, the per-club proof, the
     substitutes that covered and the one that didn't — and a single club cannot
     render it. It therefore takes the screen's state. The per-club fragment it
     needs is the `clubs` array below.

     state = {
       lang, gw, nextGw,
       points: 12, status: "final" | "provisional",
       clubs: [{
         name: "بايرن ميونخ", code: "BAY",
         league: "الدوري الألماني" | {ar,en},
         blank: true, pausedFrom: "19 ديسمبر",
         matches: 3, captain: false, pts: 18,
         sub: { name: "ليل", slot: 1, pts: 9 } | null,
         firstEver: false           // §D.2 G6 — show fxSubFirst once, ever
       }],
       pausedLeagues: [{ name, from }],   // the accordion's closing line
       nextDate: "6 يناير", nextMissing: 1,
       relief: false,                     // §J.6's per-squad relief rule fired
       calendar: { from, to, days, leagues[] }   // powers the inline diagram
     }
     -------------------------------------------------------------------------- */

  function gwMatchesLabel(n, lang) {
    if (n === 1) return gwFill("fxMatches1", lang);
    if (n === 2) return gwFill("fxMatches2", lang);
    return gwFill("fxMatchesN", lang, { n: n });
  }

  function gwBlankSheetHtml(state) {
    var s = state || {};
    var lang = s.lang === "en" ? "en" : "ar";
    var clubs = Array.isArray(s.clubs) ? s.clubs : [];

    var blanks = clubs.filter(function (c) { return !!c.blank; });
    var covered = blanks.filter(function (c) { return !!c.sub; });
    var nBlank = blanks.length, nCov = covered.length;

    /* ---- the number first, without hedging. Any softening before the number
       reads as excuse-making and destroys everything after it.    [spec §J.1] */
    var score =
      '<div class="gwj-score">' +
        '<div class="gwj-big" dir="ltr">' + gwEsc(gwNum(s.points == null ? 0 : s.points)) + "</div>" +
        '<div class="gwj-biglab">' + gwFill("fxGwPts", lang) + "</div>" +
        '<div class="gwj-state">' +
          gwFill(s.status === "provisional" ? "fxProvisional" : "fxFinal", lang) +
        "</div>" +
      "</div>";

    /* ---- THE ANSWER, directly under the score, in a filled card, not behind a
       tap. The user's question is answered before they can form it. This card
       is the entire difference between this screen and a bug report. [§J.4] */
    var line2 =
      nCov === 0 ? gwFill("fxBlankSubNone", lang)
      : nCov === nBlank ? gwFill("fxBlankSubAll", lang)
      : nCov === 1 ? gwFill("fxBlankSub1", lang)
      : gwFill("fxBlankSub", lang, { k: nCov });

    var pausedLine = (s.pausedLeagues || []).map(function (p) {
      return gwFill("fxLeaguePaused", lang, { league: nameOf(p.name, lang), date: p.from });
    }).join(lang === "en" ? " · " : " · ");

    var answer =
      '<div class="gwj-answer">' +
        '<div class="gwj-a1">' +
          (nBlank === 1 ? gwFill("fxBlankSum1", lang) : gwFill("fxBlankSum", lang, { n: nBlank })) +
        "</div>" +
        '<div class="gwj-a2">' + line2 + "</div>" +

        /* the expansion. INLINE — an accordion, not a sheet: a sheet over a
           sheet is where beginners get lost and this user is already unhappy.
           Four elements, no links out; the explanation terminates. [spec §J.5]
           <details> delivers the whole behaviour with no host JavaScript,
           which keeps this function pure. */
        '<details class="gwj-acc">' +
          "<summary>" + gwFill("fxBlankWhyCta", lang) + "</summary>" +
          '<div class="gwj-accbody">' +
            (s.calendar
              ? gwCalendarHtml({
                  lang: lang, density: "inline",
                  days: s.calendar.days,
                  leagues: (s.calendar.leagues && s.calendar.leagues.length)
                    ? [s.calendar.leagues[0]]
                    : [{ mine: true, days: s.calendar.dots || [] }]
                })
              : "") +
            '<p class="gwx-hero">' + gwFill("fxGwOneA", lang) +
              "<b>" + gwFill("fxGwOneB", lang) + "</b></p>" +
            '<p class="gwx-why">' + gwFill("fxGwOneWhy", lang) + "</p>" +
            (pausedLine ? '<div class="gwj-paused">' + pausedLine + "</div>" : "") +
          "</div>" +
        "</details>" +
      "</div>";

    /* ---- the proof, per club, with the dates. A claim they can check is a
       claim they believe. Blanked clubs first — they are the question. */
    var ordered = blanks.concat(clubs.filter(function (c) { return !c.blank; }));

    var rows = ordered.map(function (c) {
      var isBlank = !!c.blank;
      var sub = "";

      if (isBlank) {
        /* the LEAGUE-level reason, not the club-level one. A user who reads it
           twice on the same screen has learned, without being taught, that
           blanks travel by league — the exact insight that improves their next
           transfer.                                               [spec §J.4] */
        sub = c.pausedFrom
          ? gwFill("fxLeaguePaused", lang, { league: nameOf(c.league, lang), date: c.pausedFrom })
          : gwEsc(nameOf(c.league, lang));
      } else {
        var bits = [gwEsc(nameOf(c.league, lang))];
        if (c.captain) bits.push(gwFill("fxCaptainOf", lang));
        if (typeof c.matches === "number") bits.push(gwMatchesLabel(c.matches, lang));
        sub = bits.join(" · ");
      }

      var badge = isBlank
        ? gwBadge({ lang: lang, kind: "blank" })
        : (typeof c.matches === "number" && c.matches > 1
            ? gwBadge({ lang: lang, matches: c.matches })
            : "");

      var tail;
      if (!isBlank) {
        tail = "";
      } else if (c.sub) {
        /* the safety net working is the best news available and it is usually
           invisible. Make it visible.                             [spec §J.1] */
        tail =
          '<div class="gwj-sup">' +
            '<span aria-hidden="true">&#8627;</span>' +
            gwFill("fxSubIn", lang, { name: nameOf(c.sub.name, lang) }) +
            (c.sub.slot != null ? " (" + gwFill("fxBenchN", lang, { n: c.sub.slot }) + ")" : "") +
            '<span class="v" dir="ltr">+' + gwEsc(gwNum(c.sub.pts == null ? 0 : c.sub.pts)) + "</span>" +
          "</div>" +
          (c.firstEver ? '<div class="gwj-first">' + gwFill("fxSubFirst", lang) + "</div>" : "");
      } else {
        /* and the substitution that did NOT happen, stated as plainly as the
           one that did. The temptation is to render an uncovered blank as a
           plain zero and move on; that is how "the app is broken" is born —
           the user sees one club covered and another not and finds no
           explanation for the difference.                         [spec §J.4] */
        tail =
          '<div class="gwj-nosub">' +
            '<span aria-hidden="true">&#10005;</span>' +
            gwFill("fxNoSubLeft", lang) +
          "</div>";
      }

      var pts = c.pts == null ? 0 : c.pts;

      return '<div class="gwj-row' + (isBlank ? " blank" : "") + '">' +
        '<div class="gwj-main">' +
          '<span class="gwj-code" dir="ltr" aria-hidden="true">' + gwEsc(c.code || "") + "</span>" +
          '<span class="gwj-nm">' +
            '<span class="gwj-n">' + gwEsc(nameOf(c.name, lang)) + "</span>" +
            '<span class="gwj-sub">' + sub + "</span>" +
          "</span>" +
          (badge || "") +
          '<span class="gwj-pts' + (isBlank ? " zero" : "") + '" dir="ltr">' +
            gwEsc(gwNum(pts)) +
          "</span>" +
        "</div>" +
        tail +
      "</div>";
    }).join("");

    /* ---- the next action. Anger with nothing to do becomes churn; anger with
       a button becomes engagement. It names a DATE, never a countdown: on the
       Monday of a 14-day round the next deadline can be nine days away, and
       "locks in 9 days" is not motivation, it is permission to close the app.
                                                                   [spec §J.4] */
    var next =
      '<div class="gwj-next">' +
        '<div class="gwj-nexth">' + gwFill("fxBackNext", lang, { n: s.nextGw }) + "</div>" +
        '<div class="gwj-nextd">' +
          (s.nextMissing
            ? gwFill("fxBackNextD", lang, { date: s.nextDate, k: s.nextMissing })
            : gwFill("fxBackNextAll", lang, { date: s.nextDate })) +
        "</div>" +
        '<button type="button" class="gwj-cta" data-gw-cta="' + attr(s.nextGw) + '">' +
          gwFill("fxDecCta", lang, { n: s.nextGw }) +
        "</button>" +
      "</div>";

    /* No copy fixes a zero — a rule does. This renders only when the per-squad
       relief rule has actually fired.                             [spec §J.6] */
    var relief = s.relief
      ? '<div class="gwj-relief">' + gwFill("fxRelief", lang) + "</div>"
      : "";

    return '<div class="gwj">' + score + answer +
      '<div class="gwj-list">' + rows + "</div>" +
      next + relief +
    "</div>";
  }


  /* ==========================================================================
     7. EXPORT
     ========================================================================== */

  var API = {
    GW_STR: GW_STR,
    gwT: gwT,
    gwFill: gwFill,
    gwFillText: gwFillText,
    gwEsc: gwEsc,
    gwNum: gwNum,
    gwTier: gwTier,
    gwBadge: gwBadge,
    gwCalendarHtml: gwCalendarHtml,
    gwExplainerHtml: gwExplainerHtml,
    gwDeadlineHtml: gwDeadlineHtml,
    gwBlankSheetHtml: gwBlankSheetHtml
  };

  if (typeof module === "object" && module && module.exports) {
    module.exports = API;                 /* Node — this is how the test reaches it */
  } else {
    for (var k in API) {                  /* browser — bare calls, house style */
      if (Object.prototype.hasOwnProperty.call(API, k)) glob[k] = API[k];
    }
  }

})(typeof globalThis !== "undefined" ? globalThis : this);
