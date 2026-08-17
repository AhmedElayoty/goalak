/* ============================================================================
   GOALLAK FANTASY — THE COLD-TRAFFIC LANDING (screen 0)
   Implements design/fantasy-conversion.md §A, §B, §D, §G, §H, §I.

   ----------------------------------------------------------------------------
   INTEGRATION NOTE — read this before dropping it in
   ----------------------------------------------------------------------------

   FILES
     modules/landing.css   — paste inside the existing <style> block, or link
                             it. Declares no tokens; consumes the --fx-* set
                             that :root already defines in index.html.
     modules/landing.js    — paste inside the existing <script>, or load it
                             BEFORE the script that calls it.

   WHAT IT EXPORTS (assigned onto the global object, like the app's own helpers)

       LND_STR                          bilingual [ar, en] pairs, STR-shaped
       lndEntry(input)      -> object   classify how this visitor arrived
       lndRoute(entry)      -> object   decide which screen boots
       landingHtml(state)   -> string   screen 0, cold visitor
       lndResumeHtml(state) -> string   screen 0, returning visitor
       lndGuestHtml(state)  -> string   screen 0, arrived on a friend's squad
       lndT(key, lang)      -> string   raw, unescaped — for aria/title
       lndFill(key,lang,v)  -> string   escaped HTML, numbers dir="ltr"

     In Node it sets module.exports instead, so this file is testable headless.
     Every function here is PURE: state in, string out. Nothing reads a global,
     nothing touches the DOM, nothing writes localStorage. The one impure act
     the app must perform — persisting the entry class — is described in §D of
     the spec and left to the caller, deliberately, so this file stays testable
     and so the storage policy is visible at the call site rather than buried.

   MERGING THE STRINGS
       Object.assign(STR, LND_STR);
     Every key is lnd-prefixed. Nothing collides with the demo's current STR,
     nor with GW_STR from modules/gameweek.js.

   WHERE IT MOUNTS
     boot() in index.html currently ends with:
         if(!onboarded) openWizard();
     That single line is the entire cold-traffic strategy today, and it is what
     this module replaces. The new sequence is:

         const entry = lndEntry({ search: location.search,
                                  referrer: document.referrer,
                                  ua: navigator.userAgent,
                                  lang: navigator.language,
                                  hasSquad: squad.length > 0,
                                  onboarded: !!onboarded });
         const route = lndRoute(entry);
         switch(route.screen){
           case "landing": mountLanding(landingHtml(...)); break;   // cold
           case "resume":  mountLanding(lndResumeHtml(...)); break; // returning
           case "guest":   mountLanding(lndGuestHtml(...)); break;  // friend's squad
           case "app":     render(); break;                         // straight in
         }

     The landing's primary CTA calls the TUTORIAL, not the old wizard:
         onclick="lndStart()"  ->  closes .lnd, then opens tutorial step 1.

   BOUNDARY WITH THE TUTORIAL (modules/tutorial.*) — DO NOT CROSS
     This module owns the screen BEFORE the first tutorial step and nothing
     after it. It teaches no rules. It does not explain the budget, the bench,
     the captain, blanks or the 3-per-league cap. Those belong to the tutorial
     and duplicating them here would make the funnel longer, not shorter.
     The handoff is one function call and no shared state.

   BOUNDARY WITH SHARE (modules/share.*)
     The squad code in `?s=` is minted and decoded by the share module. This
     file only detects that the parameter is PRESENT and well-formed enough to
     route on. It never decodes it. `state.guest` is supplied by the caller
     after share.* has parsed it.
   ============================================================================ */

(function (root) {
  "use strict";

  /* ==========================================================================
     1. STRINGS
     Arabic is Egyptian colloquial, matching the register of the app's best
     copy (wiz1p, "من فين جت النقاط؟"). It deliberately does NOT match the
     register of the demo banner or the glossary, which fantasy-usability.md §F
     identifies as MSA-contaminated and machine-translated in feel.

     This is not a polish concern. UserQ's MENA survey (n=504, Egypt 41.5%)
     found 75.4% of Arabic-speaking users name translation quality as the
     single biggest problem with Arabic digital products, and 48.8% abandon
     Arabic for English when the translation feels unclear. Register is a
     conversion variable in this market.

     Western digits throughout, per index.html's own stated rule (`num`).
     ========================================================================== */
  var LND_STR = {
    /* --- the three-second answer ------------------------------------------ */
    lndEyebrow:   ["7 دوريات · 126 نادي", "7 leagues · 126 clubs"],
    lndH1a:       ["فريقك 15 نادي،", "Your team is 15 clubs,"],
    lndH1b:       ["مش 15 لاعب.", "not 15 players."],
    lndSub1:      ["كل أسبوع، نتايج أنديتك الحقيقية بتجيب لك نقط.",
                   "Every week, your clubs' real results score your points."],
    lndSub2:      ["مفيش لاعيبة، مفيش إصابات، مفيش تشكيلات. <b>إنت المدرب.</b>",
                   "No players, no injuries, no line-ups. <b>You're the manager.</b>"],

    /* --- hero -------------------------------------------------------------- */
    lndHeroCap:   ["15 نادي · 11 في الملعب و4 على الدكة",
                   "15 clubs · 11 on the pitch, 4 on the bench"],
    lndMore:      ["+10", "+10"],

    /* --- the honest-proof strip -------------------------------------------- */
    lndFact1:     ["ببلاش", "Free"],
    lndFact2:     ["من غير حساب", "No account"],
    lndFact3:     ["مش مراهنات", "No betting"],

    /* --- the ask ----------------------------------------------------------- */
    lndCta:       ["يلا نجهز فريقك", "Build my team"],
    /* The landing promised 40 seconds and the very next screen — the tutorial — promised
       three minutes. Two numbers for the same act, one tap apart. The tutorial's is the
       honest one, so the landing moves to meet it: a promise broken in the first minute
       costs more than a slower promise kept. */
    lndAssure:    ["دقيقتين ويبقى عندك فريق · من غير تسجيل ولا تحميل",
                   "Two minutes to a team · no sign-up, no download"],
    lndAlt:       ["وريني فريق جاهز الأول", "Show me a ready-made team first"],

    /* --- returning visitor (§H) -------------------------------------------- */
    lndBackH1:    ["فريقك مستنيك.", "Your team is waiting."],
    lndBackSub:   ["سيبناه زي ما هو. تقدر تغيّر اللي إنت عايزه.",
                   "We kept it exactly as you left it. Change whatever you like."],
    lndBackCta:   ["كمّل", "Continue"],
    lndBackClubs: ["أنديتك", "Your clubs"],
    lndBackCap:   ["الكابتن", "Captain"],
    lndBackPts:   ["نقطك", "Your points"],

    /* --- arrived on a friend's squad (§H) ---------------------------------- */
    lndGuestEye:  ["فريق صاحبك", "Your friend's team"],
    lndGuestH1:   ["ده فريق {name}.", "This is {name}'s team."],
    lndGuestSub:  ["شوف اختياراته، وبعدين اعمل فريقك إنت.",
                   "See what they picked, then build your own."],
    lndGuestCta:  ["اعمل فريقي أنا", "Build my own team"],
    lndGuestAlt:  ["شوف فريقه بالتفصيل", "Look at their team in detail"],
    lndGuestMeta: ["{n} نادي · كابتن {cap}", "{n} clubs · captain {cap}"],

    /* --- resume an unfinished first session (§H.3) ------------------------- */
    lndResumeH1:  ["كنت في نص الفريق.", "You were halfway through."],
    lndResumeSub: ["اخترت {n} من 15 نادي. نكمّل؟",
                   "You picked {n} of 15 clubs. Shall we finish?"],
    lndResumeCta: ["كمّل الفريق", "Finish my team"],
    lndResumeAlt: ["ابدأ من الأول", "Start again"],

    /* --- accessibility ----------------------------------------------------- */
    lndKitAria:   ["قميص نادي", "Club shirt"],
    lndLangAria:  ["English", "العربية"]
  };

  /* ==========================================================================
     2. STRING HELPERS — same shape as gameweek.js's gwT / gwFill
     ========================================================================== */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* Numbers get an explicit dir="ltr" run. This is the technique the app
     already applies correctly everywhere (fantasy-usability.md §F.4) and the
     reason no price or rank in this product renders mirrored. */
  function ltr(s) { return '<span dir="ltr">' + esc(s) + "</span>"; }

  function lndT(key, lang) {
    var e = LND_STR[key];
    return e ? e[lang === "en" ? 1 : 0] : key;
  }
  /* Substitutes {tokens}. Values are escaped; numeric values are wrapped ltr.
     The template itself is trusted (it is ours) so <b> in lndSub2 survives. */
  function lndFill(key, lang, vars) {
    var s = lndT(key, lang);
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      if (!(k in vars)) return m;
      var v = vars[k];
      return typeof v === "number" ? ltr(String(v)) : esc(String(v));
    });
  }

  /* ==========================================================================
     3. ENTRY CLASSIFICATION — §D of the spec
     ------------------------------------------------------------------------
     THE PRIVACY LINE, stated once and enforced by the shape of this function.

     Everything below classifies THE LINK, not the person. There is no device
     id, no fingerprint, no cookie, no third-party call, and nothing here is
     ever transmitted. `lndEntry` is a pure function of a URL string, a UA
     string and two booleans; it cannot phone home because it has no way to.

     `?c=` is a label the OWNER puts on his own ad URLs before he publishes
     them. It says "this link was printed on an Instagram ad." It says nothing
     about who tapped it. That distinction is the whole difference between
     attribution and surveillance, and it is why this design needs no consent
     banner.

     WHY REFERRER IS NOT ENOUGH — and this is the load-bearing technical fact:
     WhatsApp, TikTok, Slack, Discord and Mastodon all deliver clicks with NO
     referrer; they arrive indistinguishable from someone typing the URL
     (SparkToro, on "dark social"). Instagram and Facebook in-app browsers are
     similarly unreliable. Referrer is therefore used ONLY as a weak
     corroborator and never as the primary signal. If the owner does not tag
     his own links, he will attribute every channel to "direct" and learn
     nothing from his ad spend.
     ========================================================================== */

  /* The campaign vocabulary. Deliberately tiny and closed: an unknown value is
     treated as untagged rather than trusted, so a stray or spoofed parameter
     cannot steer the UI. */
  var CAMPAIGNS = { ig: "instagram", tk: "tiktok", x: "x", wa: "whatsapp", fb: "facebook", qr: "qr" };

  function parseQuery(search) {
    var out = {};
    if (!search) return out;
    String(search).replace(/^[?#]/, "").split("&").forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf("=");
      var k = i < 0 ? pair : pair.slice(0, i);
      var v = i < 0 ? "" : pair.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " ")); }
      catch (_) { out[k] = v; }
    });
    return out;
  }

  /* In-app browser detection. This is DEVICE-CAPABILITY detection, not user
     tracking, and it exists for one functional reason: an Instagram or TikTok
     in-app webview cannot install a PWA and frequently has no working
     navigator.share. Offering "add to home screen" there is offering something
     that does not work. */
  function detectInApp(ua) {
    var u = String(ua || "");
    if (/FBAN|FBAV|FB_IAB|Instagram/i.test(u)) return "meta";
    if (/BytedanceWebview|TikTok|musical_ly/i.test(u)) return "tiktok";
    if (/\bLine\/|KAKAOTALK|Snapchat/i.test(u)) return "other";
    return null;
  }

  function lndEntry(input) {
    input = input || {};
    var q = parseQuery(input.search);
    var inApp = detectInApp(input.ua);
    var ref = String(input.referrer || "");

    /* A squad code is a share artefact. We check only that it looks like one;
       modules/share.* owns the actual encoding. */
    var squadCode = typeof q.s === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(q.s) ? q.s : null;

    var campaign = Object.prototype.hasOwnProperty.call(CAMPAIGNS, q.c) ? CAMPAIGNS[q.c] : null;

    /* Weak corroboration only — see the note above on why this cannot lead. */
    if (!campaign && ref) {
      if (/instagram\.com/i.test(ref)) campaign = "instagram";
      else if (/tiktok\.com/i.test(ref)) campaign = "tiktok";
      else if (/(^|\/\/)(x|twitter)\.com/i.test(ref)) campaign = "x";
      else if (/facebook\.com/i.test(ref)) campaign = "facebook";
    }
    if (!campaign && inApp === "meta") campaign = "instagram";
    if (!campaign && inApp === "tiktok") campaign = "tiktok";

    /* Language: honour an explicit ?l=, else the device, else Arabic.
       Arabic is the default and English is the override, never the reverse.
       Northwestern Qatar's 7-nation survey (2019) found only 21% of Egyptian
       nationals online use English-language content at all — defaulting to
       English on an Arabic device would misserve roughly four in five. */
    var lang = q.l === "en" || q.l === "ar" ? q.l
             : /^ar\b/i.test(String(input.lang || "")) ? "ar"
             : String(input.lang || "").length ? "en"
             : "ar";

    return {
      kind: squadCode ? "guest" : campaign ? "campaign" : "direct",
      campaign: campaign,          /* instagram | tiktok | x | whatsapp | facebook | qr | null */
      squadCode: squadCode,        /* opaque; share.* decodes it */
      inApp: inApp,                /* meta | tiktok | other | null */
      canInstall: !inApp,          /* an in-app webview cannot add to home screen */
      lang: lang,
      hasSquad: !!input.hasSquad,
      onboarded: !!input.onboarded,
      partial: typeof input.pickedCount === "number" ? input.pickedCount : 0
    };
  }

  /* ==========================================================================
     4. THE ROUTER — §H of the spec
     ------------------------------------------------------------------------
     The single rule this encodes:

        The landing is shown to exactly one audience — a device with no saved
        state that did not arrive on a friend's squad. Everyone else routes
        past it.

     The current build gets this exactly backwards in one respect and exactly
     right in another. Right: a returning visitor with a squad skips the wizard
     (fantasy-usability.md §C, 0:00). Wrong: a visitor who arrives on a shared
     link, or who quit halfway through, is treated as brand new.
     ========================================================================== */
  function lndRoute(entry) {
    entry = entry || {};

    /* 1. A friend's squad beats everything. They came to see a specific thing;
          show them that thing. Even a returning player gets this screen,
          because the reason they tapped was the link, not the game. */
    if (entry.squadCode) return { screen: "guest", showBeginnerPitch: false, reason: "shared-squad" };

    /* 2. A complete squad means they have played. Never pitch them again. */
    if (entry.hasSquad) return { screen: "resume", showBeginnerPitch: false, reason: "returning" };

    /* 3. Started and abandoned. Resume, do not restart — restarting discards
          work they already did and is the reason people do not come back to
          half-finished flows. */
    if (entry.onboarded || entry.partial > 0) {
      return { screen: "resume", showBeginnerPitch: false, reason: "unfinished", partial: entry.partial };
    }

    /* 4. Genuinely cold. This is the only audience the pitch is for. */
    return { screen: "landing", showBeginnerPitch: true, reason: "cold" };
  }

  /* ==========================================================================
     5. THE HERO KITS
     ------------------------------------------------------------------------
     Colours and patterns only — no 3-letter codes, no names, no crests.
     Inside the product the code stays on the tile because it is a functional
     identifier the user needs. On a marketing surface it is not needed, and
     colour+pattern+code together identifies a specific club more strongly
     than the product's own no-crest constraint is comfortable with. See §C.5.

     The caller passes real clubs (sorted by `fame`, which is present on all
     126 records in clubs.json and currently used nowhere in the app). If it
     passes nothing, the neutral set below renders and the screen still works.
     ========================================================================== */
  var NEUTRAL_KITS = [
    { c1: "#D42A3C", c2: "#FFFFFF", pat: "stripes" },
    { c1: "#1B4FA8", c2: "#0E2A5C", pat: "solid" },
    { c1: "#F2F2F2", c2: "#111111", pat: "halves" },
    { c1: "#0E7A46", c2: "#F5F5F5", pat: "hoops" },
    { c1: "#F7C51E", c2: "#1A1A1A", pat: "sash" }
  ];

  function kitsHtml(kits, lang, count) {
    var list = (kits && kits.length ? kits : NEUTRAL_KITS).slice(0, count || 5);
    var aria = lndT("lndKitAria", lang);
    var h = "";
    for (var i = 0; i < list.length; i++) {
      var k = list[i] || {};
      h += '<span class="lnd__kit" role="img" aria-label="' + esc(aria) + '"'
         + ' data-pat="' + esc(k.pat || "solid") + '"'
         + ' style="--c1:' + esc(k.c1 || "#888") + ";--c2:" + esc(k.c2 || "#444") + '"></span>';
    }
    h += '<span class="lnd__more" dir="ltr" aria-hidden="true">' + esc(lndT("lndMore", lang)) + "</span>";
    return h;
  }

  /* ==========================================================================
     6. SHARED CHROME
     ========================================================================== */
  function topHtml(lang) {
    /* The wordmark is NEVER mirrored for RTL — the brand guide's explicit
       rule. The Arabic composition is used in Arabic; the Latin one in
       English. They are different lockups, not one lockup flipped. */
    var brand = lang === "en"
      ? '<b>Goallak</b> Fantasy'
      : '<b>جولك</b> فانتازي';
    return '<div class="lnd__top">'
      + '<div class="lnd__brand">' + brand + "</div>"
      + '<button type="button" class="lnd__lang" onclick="lndToggleLang()"'
      + ' aria-label="' + esc(lndT("lndLangAria", lang)) + '">'
      + (lang === "en" ? "ع" : "EN") + "</button>"
      + "</div>";
  }

  function ctaHtml(lang, ctaKey, altKey, onStart, onAlt, assure) {
    var h = '<div class="lnd__ctawrap">'
      + '<button type="button" class="lnd__cta" onclick="' + onStart + '">'
      + esc(lndT(ctaKey, lang)) + "</button>";
    if (assure) h += '<div class="lnd__assure">' + esc(lndT(assure, lang)) + "</div>";
    if (altKey) {
      h += '<button type="button" class="lnd__alt" onclick="' + onAlt + '">'
        + esc(lndT(altKey, lang)) + "</button>";
    }
    return h + "</div>";
  }

  /* ==========================================================================
     7. SCREEN 0 — THE COLD VISITOR
     ========================================================================== */
  function landingHtml(state) {
    state = state || {};
    var lang = state.lang === "en" ? "en" : "ar";
    var kitCount = state.narrow ? 4 : 5;

    return '<div class="lnd" id="lnd" dir="' + (lang === "en" ? "ltr" : "rtl") + '">'
      + topHtml(lang)
      + '<div class="lnd__body">'

      /* Proof first, claim second. The eyebrow is two numbers the visitor can
         verify inside the product in ten seconds. */
      + '<div class="lnd__eyebrow" dir="ltr">' + esc(lndT("lndEyebrow", lang)) + "</div>"

      + '<h1 class="lnd__h1">' + esc(lndT("lndH1a", lang))
      + '<br><em>' + esc(lndT("lndH1b", lang)) + "</em></h1>"

      + '<p class="lnd__sub">' + esc(lndT("lndSub1", lang)) + "</p>"
      + '<p class="lnd__sub">' + lndT("lndSub2", lang) + "</p>"   /* trusted template, carries <b> */

      + '<div class="lnd__hero">'
      +   '<div class="lnd__kits">' + kitsHtml(state.kits, lang, kitCount) + "</div>"
      +   '<div class="lnd__herocap">' + esc(lndT("lndHeroCap", lang)) + "</div>"
      + "</div>"

      + '<div class="lnd__facts">'
      +   '<span class="lnd__fact"><i>✓</i>' + esc(lndT("lndFact1", lang)) + "</span>"
      +   '<span class="lnd__fact"><i>✓</i>' + esc(lndT("lndFact2", lang)) + "</span>"
      +   '<span class="lnd__fact"><i>✓</i>' + esc(lndT("lndFact3", lang)) + "</span>"
      + "</div>"

      + ctaHtml(lang, "lndCta", "lndAlt", "lndStart()", "lndPreview()", "lndAssure")
      + "</div></div>";
  }

  /* ==========================================================================
     8. SCREEN 0 — THE RETURNING VISITOR (§H.1) and THE UNFINISHED ONE (§H.3)
     Neither ever sees the beginner pitch.
     ========================================================================== */
  function lndResumeHtml(state) {
    state = state || {};
    var lang = state.lang === "en" ? "en" : "ar";
    var unfinished = state.partial > 0 && !state.hasSquad;

    var h = '<div class="lnd lnd--resume" id="lnd" dir="' + (lang === "en" ? "ltr" : "rtl") + '">'
      + topHtml(lang)
      + '<div class="lnd__body">'
      + '<h1 class="lnd__h1">'
      + esc(lndT(unfinished ? "lndResumeH1" : "lndBackH1", lang)) + "</h1>"
      + '<p class="lnd__sub">'
      + (unfinished ? lndFill("lndResumeSub", lang, { n: state.partial })
                    : esc(lndT("lndBackSub", lang)))
      + "</p>";

    /* A returning player gets facts about THEIR team, not claims about ours. */
    if (!unfinished) {
      h += '<div class="lnd__resume">'
        + row(lndT("lndBackClubs", lang), state.clubCount != null ? state.clubCount : 15)
        + (state.captain ? row(lndT("lndBackCap", lang), state.captain) : "")
        + (state.points != null ? row(lndT("lndBackPts", lang), state.points) : "")
        + "</div>";
    }

    h += ctaHtml(lang,
          unfinished ? "lndResumeCta" : "lndBackCta",
          unfinished ? "lndResumeAlt" : null,
          "lndContinue()", "lndRestart()", null);

    return h + "</div></div>";

    function row(lab, val) {
      return '<div class="lnd__resumerow">'
        + '<span class="lnd__resumelab">' + esc(lab) + "</span>"
        + '<span class="lnd__resumeval">'
        + (typeof val === "number" ? ltr(String(val)) : esc(String(val)))
        + "</span></div>";
    }
  }

  /* ==========================================================================
     9. SCREEN 0 — ARRIVED ON A FRIEND'S SQUAD (§H.2)
     They tapped to see a specific thing. Show that thing first. The pitch for
     the game comes second, and it comes as a comparison rather than a lecture
     — the friend's team IS the explanation of what the game is.
     ========================================================================== */
  function lndGuestHtml(state) {
    state = state || {};
    var lang = state.lang === "en" ? "en" : "ar";
    var g = state.guest || {};
    var name = g.name || (lang === "en" ? "your friend" : "صاحبك");

    return '<div class="lnd lnd--guest" id="lnd" dir="' + (lang === "en" ? "ltr" : "rtl") + '">'
      + topHtml(lang)
      + '<div class="lnd__body">'
      + '<div class="lnd__eyebrow">' + esc(lndT("lndGuestEye", lang)) + "</div>"
      + '<h1 class="lnd__h1">' + lndFill("lndGuestH1", lang, { name: name }) + "</h1>"
      + '<p class="lnd__sub">' + esc(lndT("lndGuestSub", lang)) + "</p>"

      + '<div class="lnd__guestcard">'
      +   '<div class="lnd__guestname">' + esc(g.teamName || name) + "</div>"
      +   '<div class="lnd__guestmeta">'
      +     lndFill("lndGuestMeta", lang, { n: g.clubCount != null ? g.clubCount : 15, cap: g.captain || "—" })
      +   "</div>"
      +   '<div class="lnd__kits" style="margin-block-start:.75rem">'
      +     kitsHtml(g.kits, lang, state.narrow ? 4 : 5)
      +   "</div>"
      + "</div>"

      + ctaHtml(lang, "lndGuestCta", "lndGuestAlt", "lndStart()", "lndViewGuest()", "lndAssure")
      + "</div></div>";
  }

  /* ==========================================================================
     10. EXPORT
     ========================================================================== */
  var API = {
    LND_STR: LND_STR,
    lndEntry: lndEntry,
    lndRoute: lndRoute,
    landingHtml: landingHtml,
    lndResumeHtml: lndResumeHtml,
    lndGuestHtml: lndGuestHtml,
    lndT: lndT,
    lndFill: lndFill
  };

  if (typeof module === "object" && module && module.exports) {
    module.exports = API;                 /* Node — headless tests reach it here */
  } else {
    for (var k in API) if (Object.prototype.hasOwnProperty.call(API, k)) root[k] = API[k];
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
