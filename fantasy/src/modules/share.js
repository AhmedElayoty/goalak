/* ============================================================================
   GOALLAK FANTASY — الشريط · THE STRIP
   The share artifact. Implements design/fantasy-viral.md §B, §C, §D, §E, §G.

   ----------------------------------------------------------------------------
   INTEGRATION NOTE — read this before dropping it in
   ----------------------------------------------------------------------------

   FILES
     modules/share.css  — paste inside the existing <style> block, or link it.
                          Declares no tokens; consumes the --fx-* set that
                          :root already defines in index.html.
     modules/share.js   — paste inside the existing <script>, or load it BEFORE
                          the script that calls it.

   WHAT IT EXPORTS
     In a browser it assigns these onto the global object, so they are callable
     bare, exactly like the app's own render helpers:

       SHARE_STR                        bilingual [ar, en] pairs, STR-shaped
       shareCardSvg(state, opts) -> string   the artifact, 1080x1350 or 1080x1920
       shareStripSvg(state, opts)-> string   just the 15-tile grid, standalone
       shareStripHtml(state)     -> string   DOM version, reuses .fxkit
       shareSheetHtml(state)     -> string   the in-app preview sheet
       shareText(state, opts)    -> string   the WhatsApp caption. NO LINK unless
                                             opts.link — see the note on it
       shareRevealPlan(state)    -> array    staged disclosure of a known answer
       shareEmojiStrip(clubs)    -> string   15 Unicode colour squares
       shareLandingSvg(state)    -> string   the cold-link hero, §D
       shareFilename(state)      -> string

     Everything above is PURE: state in, string out. No DOM, no canvas, no
     network, no Date.now(), no Math.random(). All of it is unit-testable in
     Node with nothing but an object literal.

     Two IMPURE helpers live in one clearly-fenced block at the bottom, because
     turning a string into a file the OS can share cannot be pure:

       shareCardPng(svg, w, h)   -> Promise<Blob>   SVG data-URI -> <img> -> canvas
       shareHandoff(blob, text)  -> Promise<string> navigator.share, with fallback

   MERGING THE STRINGS
     Object.assign(STR, SHARE_STR);
     Every key is sh-prefixed. Nothing collides with the demo's STR or GW_STR.

   NO ASSETS, EVER
     The SVG references no font file, no image, no <foreignObject>, and no
     external URL of any kind. That is what lets it rasterise inside a data:
     URI without tainting the canvas and without a single network request.
     Fonts are named system families only — the same stack index.html uses.

   RTL
     The card mirrors: in Arabic the grid fills right-to-left and cell 1 (the
     captain) is top-RIGHT. Scorelines are never rendered as one bidi string —
     each number is its own positioned <text>, so there is no bidi to get wrong.
     `sash` never mirrors (fantasy-ui.md §G.5), and that is preserved here.

   THE STATE CONTRACT — everything the artifact needs, and nothing more
   ----------------------------------------------------------------------------
     {
       lang:    "ar" | "en",
       variant: "report" | "guess" | "season",
       round:   7,
       manager: { name: "أحمد", team: "أسود الجول" },
       score:   64,                  // null when variant === "guess"
       captain: <club>,              // one of starters; null in "guess"
       captainPts: 32,               // what the captain scored. THE shared referent
                                     // across managers — see §B.3a. null = omit
       starters:[ <club> x 11 ],     // formation order, back to front
       bench:   [ <club> x 4  ],
       derby:   { name:"عمر", you:64, them:51, w:5, d:0, l:3 } | null,
       table:   [ { name, pts, you:true|false, move:+1|0|-1 } ] | null,
       group:   { name:"الشلة", code:"x7k2", size:6 },
       season:  { best:81, worst:24, titles:2, cap:<club>, capPts:214 } | null
     }
     <club> is exactly a row of site/clubs.json:
       { code, c1, c2, pat, rim, ink, iso, ar, short, name }
   ============================================================================ */
(function (root) {
  "use strict";

  /* ------------------------------------------------------------------ i18n */
  var SHARE_STR = {
    shGwPts:     ["نقطة في الجولة دي", "points this round"],
    shRound:     ["الجولة {n}", "Round {n}"],
    shBeat:      ["فزت على {name}", "You beat {name}"],
    shLost:      ["خسرت من {name}", "You lost to {name}"],
    shDrew:      ["تعادلت مع {name}", "You drew with {name}"],
    shRecord:    ["سجلك معاه {w}–{d}–{l}", "Record {w}–{d}–{l}"],
    shGuessTtl:  ["خمّن فريقي", "Guess my team"],
    shGuessSub:  ["15 نادي. 120 مليون. كام واحد هتعرفه؟",
                  "15 clubs. 120M. How many can you name?"],
    shGuessLine: ["نادي بـ 120 مليون · الكابتن مستخبي",
                  "clubs for 120M · captain hidden"],
    /* The captain line. This is the shared referent — see fantasy-viral.md
       §B.3a. Every manager's squad is different, but every manager appoints
       ONE captain, from the same 126 clubs, under the same deadline, settled
       by the same fixtures. It is the closest thing this product has to
       Wordle's "same word for everyone", and it belongs on every card. */
    shCapLine:   ["الكابتن · {club} · {n}", "Captain · {club} · {n}"],
    shCapLineNo: ["الكابتن · {club}", "Captain · {club}"],
    shSeasonTtl: ["موسمي", "My season"],
    shBest:      ["أعلى جولة", "Best round"],
    shWorst:     ["أسوأ جولة", "Worst round"],
    shTitles:    ["ألقاب الشهر", "Monthly titles"],
    shTopCap:    ["كابتن الموسم", "Captain of the season"],
    shBench:     ["الدكة", "Bench"],
    shTeamOf:    ["فريق {name}", "{name}'s team"],
    shTapToPlay: ["ادخل معاهم", "Play with them"],
    shSend:      ["ابعتها", "Send it"],
    shCopy:      ["انسخ النص", "Copy the text"],
    shCopied:    ["اتنسخ", "Copied"],
    shPreview:   ["دي اللي هتتبعت", "This is what gets sent"],
    shNoShare:   ["الصورة اتحفظت. ابعتها من المعرض.",
                  "Image saved. Send it from your gallery."],
    /* landing, §D */
    shLandWho:   ["{name} بعتلك فريقه", "{name} sent you their team"],
    shLandWhat:  ["جولك فانتازي — تختار 15 نادي بـ 120 مليون، ونقاطك من نتايج الماتشات الحقيقية.",
                  "Goallak Fantasy — pick 15 clubs for 120M. Your points come from real results."],
    shLandCta:   ["اختار فريقك", "Pick your team"],
    shLandGrp:   ["{name} · {n} مدربين", "{name} · {n} managers"],
    shLandFree:  ["من غير حساب. من غير تحميل.", "No account. No download."]
  };

  /* --------------------------------------------------------------- helpers */
  function pick(k, lang) {
    var e = SHARE_STR[k];
    return e ? e[lang === "en" ? 1 : 0] : k;
  }
  function fill(k, lang, vars) {
    return String(pick(k, lang)).replace(/\{(\w+)\}/g, function (_, n) {
      return vars && n in vars ? String(vars[n]) : "";
    });
  }
  /* XML-safe. The SVG is a document, not innerHTML — & and < are fatal here. */
  function x(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function n2(v) { return Math.round(v * 100) / 100; }
  function clubLabel(c, lang) {
    if (!c) return "";
    return lang === "en" ? (c.short || c.name || c.code) : (c.ar || c.short || c.code);
  }

  /* The one font declaration in the file. System families only — no @font-face,
     no URL, so it survives rasterisation inside a data: URI. */
  var FONT = "'Segoe UI',system-ui,-apple-system,'Noto Sans Arabic',Tahoma,sans-serif";

  /* Tokens, copied from fantasy-color.md §A.4. Duplicated as literals rather
     than read from CSS because the SVG is rendered detached from the document
     and cannot resolve a var(). Any change to :root must be mirrored here. */
  var T = {
    bg: "#070B1A", surface: "#101736", surface2: "#182246", surface3: "#212D57",
    line: "#2A3560", line2: "#3D4C82", line3: "#55689F",
    ink: "#F2F5FF", inkDim: "#A9B7E4", inkMute: "#7C8AB8",
    gold: "#FFC53D", pos: "#3BE07F", neg: "#FF6070", acc: "#FF7A45",
    live: "#35D0F5", chip: "#A77BFF", blank: "#63719C"
  };

  /* ====================================================================== */
  /*  THE KIT TILE — the same nine patterns as .fxkit, drawn as SVG shapes.  */
  /*  Not <pattern>: explicit rects and polygons inside a clip, so the tile   */
  /*  is pixel-identical at 176 px on the card and 44 px in the app.          */
  /* ====================================================================== */

  /* Pattern geometry as fractions of the tile side. Mirrors the CSS in
     index.html line 73-84 exactly; if one changes the other must. */
  function patShapes(pat, s, c1, c2) {
    var r = [], p = function (a, b, c, d, f) {
      r.push('<rect x="' + n2(a) + '" y="' + n2(b) + '" width="' + n2(c) +
             '" height="' + n2(d) + '" fill="' + x(f) + '"/>');
    }, poly = function (pts, f) {
      r.push('<polygon points="' + pts + '" fill="' + x(f) + '"/>');
    };
    p(0, 0, s, s, c1);                                    /* base is always c1 */

    switch (pat) {
      case "stripes":                                     /* 7 bands of 14.285% */
        for (var i = 1; i < 7; i += 2) p(s * i / 7, 0, s / 7, s, c2);
        break;
      case "hoops":                                       /* 5 bands of 20%     */
        for (var j = 1; j < 5; j += 2) p(0, s * j / 5, s, s / 5, c2);
        break;
      case "halves":  p(s * 0.5, 0, s * 0.5, s, c2); break;
      case "band":    p(0, s * 0.62, s, s * 0.38, c2); break;
      case "sleeves": p(0, 0, s * 0.16, s, c2); p(s * 0.84, 0, s * 0.16, s, c2); break;
      case "diagonal":
        poly(n2(s) + ",0 " + n2(s) + "," + n2(s) + " 0," + n2(s), c2);
        break;
      case "sash":
        /* CSS: linear-gradient(58deg, c1 0 38%, c2 38% 62%, c1 62%).
           A band perpendicular to 58deg, i.e. running low-left to high-right.
           NEVER mirrored in RTL — fantasy-ui.md §G.5, and it is load-bearing:
           a sash tilting the other way makes PSG look like a different club. */
        poly([n2(s * -0.10) + "," + n2(s * 0.92),
              n2(s * 0.62) + ",0",
              n2(s * 1.10) + ",0",
              n2(s * 0.38) + "," + n2(s * 1.10)].join(" "), c2);
        break;
      case "chevron":
        poly([ "0,0", n2(s * 0.34) + ",0", n2(s * 0.5) + "," + n2(s * 0.30),
               n2(s * 0.66) + ",0", n2(s) + ",0",
               n2(s) + "," + n2(s * 0.20), n2(s * 0.5) + "," + n2(s * 0.62),
               "0," + n2(s * 0.20)].join(" "), c2);
        break;
      default:
        /* solid. A plain kit still has a collar and cuffs, or the twelve white
           clubs render as identical blank rectangles. index.html line 73. */
        p(0, 0, s, s * 0.12, c2);
        p(0, 0, s * 0.10, s, c2);
        p(s * 0.90, 0, s * 0.10, s, c2);
    }
    return r.join("");
  }

  var RIM = {
    contain:  { c: "rgba(6,10,26,.62)",   halo: 0 },
    standard: { c: "rgba(255,255,255,.55)", halo: 0 },
    rescue:   { c: "rgba(255,255,255,.86)", halo: 0.10 }
  };

  /* One tile. `opts.code:false` hides the 3-letter code — that is the whole
     "guess" variant. `opts.dim` is the bench. `opts.cap` is the gold ring. */
  function kitTile(c, tx, ty, s, opts) {
    opts = opts || {};
    var rad = s * 0.14, sw = Math.max(2, s * 0.028);
    var rim = RIM[c.rim] || RIM.standard;
    /* Deterministic, collision-free id. Two card SVGs can sit inline in the
       same document (preview sheet + landing hero), and a duplicated clipPath
       id makes the second one clip to the first one's geometry. The prefix is
       derived from state, never from Math.random — these functions stay pure
       so they can be snapshot-tested. */
    var id = (opts.idp || "s") + "k" + Math.round(s) + "_" +
             Math.round(tx) + "_" + Math.round(ty);
    var out = [];

    out.push('<g transform="translate(' + n2(tx) + ',' + n2(ty) + ')"' +
             (opts.dim ? ' opacity="0.5"' : "") + ">");
    out.push('<defs><clipPath id="' + id + '"><rect width="' + n2(s) +
             '" height="' + n2(s) + '" rx="' + n2(rad) + '"/></clipPath></defs>');
    out.push('<g clip-path="url(#' + id + ')">');
    out.push(patShapes(c.pat, s, c.c1, c.c2));
    /* the .fxkit ::after gloss, flattened to one linear pass so it survives
       JPEG recompression in a chat thread without banding */
    out.push('<rect width="' + n2(s) + '" height="' + n2(s * 0.42) +
             '" fill="url(#shGloss)"/>');
    out.push("</g>");

    if (rim.halo) {
      out.push('<rect x="' + n2(-sw) + '" y="' + n2(-sw) + '" width="' + n2(s + sw * 2) +
               '" height="' + n2(s + sw * 2) + '" rx="' + n2(rad + sw) +
               '" fill="none" stroke="rgba(255,255,255,' + rim.halo +
               ')" stroke-width="' + n2(sw * 1.5) + '"/>');
    }
    out.push('<rect x="' + n2(sw / 2) + '" y="' + n2(sw / 2) + '" width="' + n2(s - sw) +
             '" height="' + n2(s - sw) + '" rx="' + n2(rad) + '" fill="none" stroke="' +
             rim.c + '" stroke-width="' + n2(sw) + '"/>');

    /* the captain ring — gold, outside the rim, never a colour on the kit
       itself. fantasy-color.md §C.1: club colour owns the tile and nothing
       else; the UI palette owns everything that is not the tile. */
    if (opts.cap) {
      out.push('<rect x="' + n2(-sw * 2.2) + '" y="' + n2(-sw * 2.2) +
               '" width="' + n2(s + sw * 4.4) + '" height="' + n2(s + sw * 4.4) +
               '" rx="' + n2(rad + sw * 2.2) + '" fill="none" stroke="' + T.gold +
               '" stroke-width="' + n2(sw * 1.4) + '"/>');
    }

    if (opts.code !== false) {
      /* Mandatory outline on the code — fantasy-color.md §D.4.3. The outline
         is the opposite of the ink, so the code survives landing on either
         half of a halves/stripes kit. */
      var dark = /^#?[0-9a-f]{6}$/i.test(c.ink) && lum(c.ink) < 0.5;
      out.push('<text x="' + n2(s / 2) + '" y="' + n2(s / 2) + '" fill="' + x(c.ink) +
               '" stroke="' + (dark ? "#F2F5FF" : "#060A1A") + '" stroke-width="' +
               n2(s * 0.045) + '" paint-order="stroke" stroke-linejoin="round"' +
               ' font-family="' + FONT + '" font-size="' + n2(s * 0.27) +
               '" font-weight="900" letter-spacing="' + n2(s * 0.01) +
               '" text-anchor="middle" dominant-baseline="central"' +
               ' direction="ltr">' + x(c.code) + "</text>");
    }
    out.push("</g>");
    return out.join("");
  }

  function lum(hex) {
    var h = String(hex).replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = [0, 2, 4].map(function (i) {
      var c = parseInt(h.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }

  /* ====================================================================== */
  /*  THE STRIP — 5 x 3, always. The one constant shape in the product.      */
  /*  Order is fixed and never varies:                                       */
  /*    cell 1        the captain          (gold ring, always top-of-read)   */
  /*    cells 2-11    the rest of the XI   (formation order, back to front)  */
  /*    cells 12-15   the bench            (dimmed, no ring)                 */
  /*  Wordle's grid works because the shape is identical every single day.   */
  /*  This is that property, applied to a squad. §B.2 of fantasy-viral.md.   */
  /* ====================================================================== */

  var GRID = { cols: 5, rows: 3, s: 176, g: 18, m: 64 };

  function stripOrder(state) {
    var st = (state.starters || []).slice(), cap = state.captain, out = [];
    if (cap) {
      out.push(cap);
      for (var i = 0; i < st.length; i++) if (st[i] !== cap && st[i].code !== cap.code) out.push(st[i]);
    } else {
      out = st.slice();
    }
    out = out.slice(0, 11);
    return out.concat((state.bench || []).slice(0, 4));
  }

  /* opts: { x, y, s, g, cols, rtl, codes, W } */
  function shareStripSvg(state, opts) {
    opts = opts || {};
    var s = opts.s || GRID.s, g = opts.g == null ? GRID.g : opts.g,
        cols = opts.cols || GRID.cols, ox = opts.x == null ? GRID.m : opts.x,
        oy = opts.y || 0, W = opts.W || 1080,
        rtl = opts.rtl == null ? (state.lang !== "en") : opts.rtl,
        codes = opts.codes !== false,
        clubs = stripOrder(state), out = [];

    /* The tile gloss lives in the card's <defs>. When the strip is used on its
       own — a landing hero, a test snapshot — it must carry its own, or every
       tile references a paint server that does not exist. Duplicate ids inside
       one document are harmless because the definition is byte-identical. */
    if (opts.defs !== false) {
      out.push('<defs><linearGradient id="shGloss" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.13"/>' +
        '<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient></defs>');
    }

    for (var i = 0; i < clubs.length; i++) {
      var col = i % cols, row = Math.floor(i / cols);
      /* RTL fills right-to-left, so cell 1 is under the reader's thumb in
         Arabic and under their eye in English. Same object, mirrored. */
      var tx = rtl ? (W - ox - s - col * (s + g)) : (ox + col * (s + g));
      var ty = oy + row * (s + g);
      out.push(kitTile(clubs[i], tx, ty, s, {
        cap:  codes && state.captain && clubs[i].code === state.captain.code,
        dim:  i >= 11,
        code: codes,
        idp:  opts.idp
      }));
    }
    return out.join("");
  }

  /* ====================================================================== */
  /*  THE CARD                                                               */
  /*  1080 x 1350 (4:5, the largest portrait WhatsApp and Instagram accept    */
  /*  without cropping) or 1080 x 1920 (status / story), same skeleton.       */
  /*                                                                         */
  /*  FIXED SKELETON — the reason it becomes recognisable:                    */
  /*      0 -  96   header rail    wordmark + round                          */
  /*     96 - 356   hero           the number, or the guess title            */
  /*    380 - 944   THE STRIP      never moves, never resizes                */
  /*    976 - 1176  the band       swappable: derby / table / season         */
  /*   1200 - 1310  footer         url + one line                            */
  /* ====================================================================== */

  /* The captain line sits between the number and the Strip, and its slot is
     occupied on EVERY variant — even the guess card, which fills it with
     "captain hidden". If the slot were conditional the Strip would move
     between variants, and a Strip that moves is not a recognisable shape. */
  var LAY = { W: 1080, H: 1350, m: 64, headY: 62, heroLabelY: 146, heroNumY: 312,
              capLineY: 366, stripY: 392, bandY: 988, bandH: 190,
              footY: 1248, foot2Y: 1300 };

  function txt(o) {
    return '<text x="' + n2(o.x) + '" y="' + n2(o.y) + '" fill="' + x(o.fill || T.ink) +
      '" font-family="' + FONT + '" font-size="' + n2(o.size) +
      '" font-weight="' + (o.weight || 700) + '"' +
      (o.anchor ? ' text-anchor="' + o.anchor + '"' : "") +
      (o.ls ? ' letter-spacing="' + n2(o.ls) + '"' : "") +
      (o.ltr ? ' direction="ltr"' : "") +
      (o.op ? ' opacity="' + o.op + '"' : "") +
      ">" + x(o.t) + "</text>";
  }
  function rrect(o) {
    return '<rect x="' + n2(o.x) + '" y="' + n2(o.y) + '" width="' + n2(o.w) +
      '" height="' + n2(o.h) + '" rx="' + n2(o.r == null ? 24 : o.r) +
      '" fill="' + x(o.fill || "none") + '"' +
      (o.stroke ? ' stroke="' + x(o.stroke) + '" stroke-width="' + n2(o.sw || 2) + '"' : "") +
      (o.op ? ' opacity="' + o.op + '"' : "") + "/>";
  }

  function shareCardSvg(state, opts) {
    opts = opts || {};
    var lang = state.lang === "en" ? "en" : "ar",
        rtl = lang !== "en",
        story = opts.frame === "story",
        W = LAY.W, CH = LAY.H, H = story ? 1920 : CH,
        top = story ? Math.round((1920 - CH) / 2) : 0,
        variant = state.variant || "report",
        near = function (v) { return rtl ? W - v : v; },        /* reading edge */
        far  = function (v) { return rtl ? v : W - v; },        /* far edge     */
        /* text-anchor is ALREADY direction-relative in SVG: with direction=rtl,
           "start" is the right edge of the run. Mirroring it as well as the x
           double-mirrors and throws every Arabic line off the canvas. These two
           are therefore constant, and only x flips. */
        anch = "start", anchFar = "end",
        /* ...but a run forced to direction="ltr" (a URL, a bare numeral) has
           LTR start/end semantics again, so inside an RTL card its anchors are
           the mirror of the Arabic ones. Two pairs, and they are not
           interchangeable — mixing them is how a footer walks off the canvas. */
        lanch = rtl ? "end" : "start", lanchFar = rtl ? "start" : "end",
        o = [];

    o.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
           '" viewBox="0 0 ' + W + " " + H + '" direction="' + (rtl ? "rtl" : "ltr") + '">');

    /* ---- defs: three gradients, nothing else. No filters — a blur costs
            2-4x rasterisation time on a mid-range Android and is invisible
            once WhatsApp has recompressed the JPEG. ---- */
    o.push("<defs>" +
      '<radialGradient id="shFlood" cx="50%" cy="0%" r="72%">' +
        '<stop offset="0" stop-color="#5A78FF" stop-opacity="0.16"/>' +
        '<stop offset="0.68" stop-color="#5A78FF" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="shGloss" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.13"/>' +
        '<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="shRule" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="' + T.gold + '" stop-opacity="0.85"/>' +
        '<stop offset="1" stop-color="' + T.gold + '" stop-opacity="0"/></linearGradient>' +
      "</defs>");

    o.push('<rect width="' + W + '" height="' + H + '" fill="' + T.bg + '"/>');
    o.push('<rect width="' + W + '" height="' + Math.round(H * 0.62) + '" fill="url(#shFlood)"/>');

    o.push('<g transform="translate(0,' + top + ')">');

    /* ---------------------------------------------------- 1. header rail  */
    /* No letter-spacing on Arabic: it is a joined script and tracking it breaks
       the joins in several rasterisers. Latin gets the tracking, Arabic does not. */
    o.push(txt({ x: near(LAY.m), y: LAY.headY, t: lang === "en" ? "GOALLAK FANTASY" : "جولك فانتازي",
                 size: 32, weight: 900, fill: T.ink, anchor: anch, ls: rtl ? 0 : 1.2 }));
    o.push(txt({ x: far(LAY.m), y: LAY.headY, size: 30, weight: 700, fill: T.gold,
                 anchor: anchFar, t: fill("shRound", lang, { n: state.round }) }));
    o.push('<rect x="' + LAY.m + '" y="' + (LAY.headY + 22) + '" width="' + (W - LAY.m * 2) +
           '" height="2" fill="url(#shRule)"' + (rtl ? ' transform="translate(' + W + ',0) scale(-1,1)"' : "") + "/>");

    /* ---------------------------------------------------- 2. the hero     */
    /* EVERY variant leads with a number, including the guess card, which leads
       with 15. Strava's share card carries exactly three stats and the user
       cannot choose them; that rigidity is why every one of its cards is
       instantly legible, and Duolingo's own A/B result was to lead with the
       number rather than the icon. Both are in fantasy-viral.md §A.9.
       The user has ZERO control over what appears here. The moment decides. */
    var heroLabel, heroNum;
    if (variant === "guess")       { heroLabel = pick("shGuessTtl", lang);  heroNum = "15"; }
    else if (variant === "season") { heroLabel = pick("shSeasonTtl", lang); heroNum = String(state.score); }
    else                           { heroLabel = pick("shGwPts", lang);     heroNum = String(state.score); }

    o.push(txt({ x: W / 2, y: LAY.heroLabelY, anchor: "middle", size: 34, weight: 700,
                 fill: T.inkDim, t: heroLabel }));
    /* Gold means VALUE, not "good" — fantasy-color.md §C.2. A 24 is printed in
       exactly the same gold as an 84. The card never congratulates. */
    o.push(txt({ x: W / 2, y: LAY.heroNumY, anchor: "middle", size: 200, weight: 900,
                 fill: T.gold, ltr: true, t: heroNum }));

    /* --------------------------------------- 2b. THE SHARED REFERENT ------
       Wordle worked because everybody solved the SAME puzzle: "if everybody
       was getting a different word... it wouldn't have caught on."
       Every Goallak squad is different, so the squad is not a shared referent.
       The CAPTAIN is: one decision, from the same 126 clubs, at the same
       deadline, settled by the same fixtures, made by every manager alive.
       It is the only directly comparable thing on the card and it therefore
       gets a named line of its own — not just a gold ring. §B.3a. */
    var capLine;
    if (variant === "guess") {
      capLine = pick("shGuessLine", lang);
    } else if (variant === "season") {
      capLine = (state.manager && state.manager.team) || "";
    } else if (state.captain) {
      capLine = state.captainPts == null
        ? fill("shCapLineNo", lang, { club: clubLabel(state.captain, lang) })
        : fill("shCapLine", lang, { club: clubLabel(state.captain, lang), n: state.captainPts });
    } else { capLine = ""; }
    if (capLine) {
      /* Step down for long club names. "مانشستر يونايتد" and "Borussia
         Dortmund" are both long enough to reach the margins at 34 px, and a
         line that touches the edge looks like a bug. No ellipsis: the captain
         is the one fact on this card that must never be truncated. */
      var capSize = capLine.length > 34 ? 27 : capLine.length > 26 ? 30 : 34;
      o.push(txt({ x: W / 2, y: LAY.capLineY, anchor: "middle", size: capSize,
                   weight: 900, fill: T.ink, t: capLine }));
    }

    /* ---------------------------------------------------- 3. THE STRIP    */
    o.push(shareStripSvg(state, {
      y: LAY.stripY, W: W, rtl: rtl, codes: variant !== "guess", defs: false,
      idp: opts.idp || (variant.charAt(0) + (state.round || 0) + (story ? "s" : "p"))
    }));

    /* ---------------------------------------------------- 4. the band     */
    o.push(bandSvg(state, lang, rtl, variant, near, far, anch, anchFar, lanch, lanchFar));

    /* ---------------------------------------------------- 5. footer       */
    /* A BARE DOMAIN, AND NEVER A GROUP SLUG.
       Wardle shipped Wordle's share text with no link at all — "one of those
       things that's the opposite of what you're meant to do" — and it is what
       stopped the post reading as spam. A "/g/x7k2" on the card reads as a
       tracking parameter, which is exactly the wrong register for a message
       between friends. The domain stays because it is a watermark on an image,
       not a link in a message; the group invite is its own deliberate act with
       its own button (fantasy-engagement.md §C.1). §B.6a. */
    o.push(txt({ x: near(LAY.m), y: LAY.footY, anchor: lanch, size: 32, weight: 900,
                 fill: T.ink, ltr: true, t: "goallak.com" }));
    o.push(txt({ x: far(LAY.m), y: LAY.footY, anchor: anchFar, size: 27, weight: 700,
                 fill: T.inkMute, t: pick("shLandFree", lang) }));

    o.push("</g></svg>");
    return o.join("");
  }

  /* ------------------------------------------------------------ the band */
  function bandSvg(state, lang, rtl, variant, near, far, anch, anchFar, lanch, lanchFar) {
    var W = LAY.W, y = LAY.bandY, h = LAY.bandH, m = LAY.m, o = [];
    o.push(rrect({ x: m, y: y, w: W - m * 2, h: h, r: 26,
                   fill: T.surface2, stroke: T.line2, sw: 2 }));

    if (variant === "report" && state.derby) {
      var d = state.derby,
          won = d.you > d.them, lost = d.you < d.them,
          key = won ? "shBeat" : lost ? "shLost" : "shDrew",
          word = won ? T.pos : lost ? T.neg : T.inkDim;
      /* The WORD carries win/loss colour. The NUMBERS stay gold and ink —
         gold is value, never approval. §C.2 again, and it is the rule that
         keeps a losing card from looking like a punishment. */
      o.push(txt({ x: near(m + 36), y: y + 78, anchor: anch, size: 42, weight: 900,
                   fill: word, t: fill(key, lang, { name: d.name }) }));
      if (d.w != null) {
        o.push(txt({ x: near(m + 36), y: y + 132, anchor: anch, size: 28, weight: 700,
                     fill: T.inkMute,
                     t: fill("shRecord", lang, { w: d.w, d: d.d, l: d.l }) }));
      }
      /* The scoreline is three separately positioned <text> runs, never one
         string — so there is no bidi algorithm involved and it cannot reorder.
         It ALWAYS reads you–them left to right, in both languages: digits are
         LTR everywhere, and Arabic sports media writes scorelines LTR too.
         Only the block's position on the card mirrors. */
      var pc = rtl ? (m + 190) : (W - m - 190);
      o.push(txt({ x: pc - 82, y: y + 122, anchor: "middle", size: 78,
                   weight: 900, fill: T.gold, ltr: true, t: String(d.you) }));
      o.push(txt({ x: pc, y: y + 116, anchor: "middle", size: 46,
                   weight: 700, fill: T.inkMute, t: "–" }));
      o.push(txt({ x: pc + 82, y: y + 122, anchor: "middle", size: 78,
                   weight: 900, fill: T.ink, ltr: true, t: String(d.them) }));

    } else if (variant === "report" && state.table) {
      var rows = state.table.slice(0, 4), rh = 44, ty0 = y + 40;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i], ry = ty0 + i * rh;
        if (r.you) o.push(rrect({ x: m + 14, y: ry - 30, w: W - m * 2 - 28, h: 40,
                                  r: 10, fill: T.surface3 }));
        o.push(txt({ x: near(m + 40), y: ry, anchor: lanch, size: 27, weight: 700,
                     fill: T.inkMute, ltr: true, t: String(i + 1) }));
        o.push(txt({ x: near(m + 84), y: ry, anchor: anch, size: 29,
                     weight: r.you ? 900 : 700, fill: r.you ? T.ink : T.inkDim, t: r.name }));
        o.push(txt({ x: far(m + 40), y: ry, anchor: lanchFar, size: 29, weight: 900,
                     fill: r.you ? T.gold : T.inkDim, ltr: true, t: String(r.pts) }));
      }

    } else if (variant === "guess") {
      o.push(txt({ x: W / 2, y: y + 82, anchor: "middle", size: 40, weight: 900,
                   fill: T.ink,
                   t: fill("shTeamOf", lang, { name: (state.manager || {}).name || "" }) }));
      o.push(txt({ x: W / 2, y: y + 140, anchor: "middle", size: 30, weight: 700,
                   fill: T.inkMute,
                   t: state.group ? fill("shLandGrp", lang,
                        { name: state.group.name, n: state.group.size }) : "" }));

    } else if (variant === "season") {
      var s = state.season || {},
          cells = [
            [pick("shBest", lang),   s.best],
            [pick("shWorst", lang),  s.worst],
            [pick("shTitles", lang), s.titles],
            [pick("shTopCap", lang), s.cap ? clubLabel(s.cap, lang) : "—"]
          ];
      for (var k = 0; k < 4; k++) {
        var colW = (W - m * 2) / 4,
            ccx = rtl ? (W - m - colW * (k + 0.5)) : (m + colW * (k + 0.5)),
            isNum = typeof cells[k][1] === "number";
        o.push(txt({ x: ccx, y: y + 76, anchor: "middle", size: isNum ? 60 : 34,
                     weight: 900, fill: T.gold, ltr: isNum, t: String(cells[k][1]) }));
        o.push(txt({ x: ccx, y: y + 132, anchor: "middle", size: 25, weight: 700,
                     fill: T.inkMute, t: cells[k][0] }));
      }
    }
    return o.join("");
  }

  /* ====================================================================== */
  /*  THE TEXT CARRIER — the caption, and the fallback when there is no      */
  /*  image pipeline. This is the piece that is closest to Wordle, and it is */
  /*  deliberately weaker than Wordle: nine Unicode squares cannot carry 126 */
  /*  club identities, so the emoji strip is a TEASE, never the artifact.    */
  /*  fantasy-viral.md §B.5 argues this honestly.                            */
  /* ====================================================================== */

  var SQ = { red: "🟥", orange: "🟧", yellow: "🟨",
             green: "🟩", blue: "🟦", purple: "🟪",
             brown: "🟫", black: "⬛", white: "⬜" };

  function hsl(hex) {
    var h = String(hex).replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16) / 255,
        g = parseInt(h.substr(2, 2), 16) / 255,
        b = parseInt(h.substr(4, 2), 16) / 255,
        mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, s = 0, hh = 0;
    if (mx !== mn) {
      s = l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
      hh = mx === r ? ((g - b) / (mx - mn) + (g < b ? 6 : 0))
         : mx === g ? ((b - r) / (mx - mn) + 2)
         : ((r - g) / (mx - mn) + 4);
      hh *= 60;
    }
    return { h: hh, s: s, l: l };
  }

  /* Nearest of nine. Thresholds, not principles — same discipline as
     fantasy-color.md §D.4. Deterministic, so the same club is always the
     same square and the strip is stable across weeks. */
  function emojiFor(c) {
    var v = hsl(c.c1);
    if (v.l < 0.16) return SQ.black;
    if (v.s < 0.13) return v.l > 0.62 ? SQ.white : SQ.black;
    /* brown currently matches zero of the 126 clubs [MEASURED]. The branch is
       kept because a genuinely brown kit in a future league would otherwise
       fall through to orange, which is a worse lie than brown. */
    if (v.h >= 15 && v.h < 45 && v.l < 0.34) return SQ.brown;
    /* 336, not 345: claret and crimson read as red to a football eye. At 345
       Galatasaray, Leipzig and Trabzonspor all came out purple [MEASURED].
       Barcelona at h=335 stays purple, which is what blaugrana should be. */
    if (v.h < 15 || v.h >= 336) return SQ.red;
    if (v.h < 45)  return SQ.orange;
    if (v.h < 70)  return SQ.yellow;
    if (v.h < 165) return SQ.green;
    if (v.h < 255) return SQ.blue;
    return SQ.purple;
  }

  function shareEmojiStrip(clubs) {
    var out = [], i;
    for (i = 0; i < clubs.length; i++) {
      out.push(emojiFor(clubs[i]));
      if (i === 4 || i === 9) out.push("\n");
    }
    return out.join("");
  }

  /* The caption. Every line survives being read with no image loaded — which
     is what happens on a slow connection, and what a screen reader gets.

     NO LINK, BY DEFAULT. This is the single most counter-intuitive rule in the
     whole feature and it comes straight from Wardle: Wordle's share text
     carried no URL, deliberately, and that is what let it read as
     self-expression instead of as a referral. `opts.link` exists for exactly
     one caller — the invite flow, where the whole point of the message IS the
     link and the user pressed a button that says so. §B.6a.

     The emoji squares are single codepoints (U+1F7E5-EB, U+2B1B/1C), NOT
     Regional Indicator pairs. That distinction is load-bearing: the Windows
     rendering failure that kills flag emoji is specifically a ligature
     failure, and single-codepoint squares are not exposed to it. Never put a
     flag emoji in this string. §B.5a. */
  function shareText(state, opts) {
    opts = opts || {};
    var lang = state.lang === "en" ? "en" : "ar",
        L = [], clubs = stripOrder(state);

    if (state.variant === "guess") {
      L.push((lang === "en" ? "Goallak · Round " : "جولك · الجولة ") + state.round);
      L.push(shareEmojiStrip(clubs));
      L.push(pick("shGuessSub", lang));
    } else {
      L.push((lang === "en" ? "Goallak · Round " : "جولك · الجولة ") +
             state.round + "  —  " + state.score +
             (lang === "en" ? " pts" : " نقطة"));
      L.push(shareEmojiStrip(clubs));
      /* the shared referent, in text form too */
      if (state.captain) {
        L.push(state.captainPts == null
          ? fill("shCapLineNo", lang, { club: clubLabel(state.captain, lang) })
          : fill("shCapLine", lang, { club: clubLabel(state.captain, lang), n: state.captainPts }));
      }
      if (state.derby) {
        var d = state.derby, k = d.you > d.them ? "shBeat" : d.you < d.them ? "shLost" : "shDrew";
        L.push(fill(k, lang, { name: d.name }) + "  " + d.you + " – " + d.them);
      }
    }
    if (opts.link && state.group && state.group.code) {
      L.push("goallak.com/g/" + state.group.code);
    }
    return L.join("\n");
  }

  function shareFilename(state) {
    return "goallak-" + (state.variant || "report") + "-gw" + (state.round || 0) + ".png";
  }

  /* ====================================================================== */
  /*  DOM RENDERERS — the in-app preview, and the cold-link landing hero.    */
  /*  These return HTML for innerHTML, so they use the app's own .fxkit and  */
  /*  the app's own escaping rules, not the XML escaper above.               */
  /* ====================================================================== */

  function h(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* The strip, as DOM. Identical order and identical dimming to the SVG, so
     the preview is not a lie about what will be sent. */
  function shareStripHtml(state) {
    var clubs = stripOrder(state), codes = state.variant !== "guess", out = [];
    out.push('<div class="shstrip" role="img" aria-label="' +
             h((state.lang === "en" ? "15 clubs" : "15 نادي")) + '">');
    for (var i = 0; i < clubs.length; i++) {
      var c = clubs[i],
          cap = codes && state.captain && c.code === state.captain.code;
      out.push('<span class="shtile' + (i >= 11 ? " shtile--bench" : "") +
        (cap ? " shtile--cap" : "") + ' fxkit" data-pat="' + h(c.pat) +
        '" data-rim="' + h(c.rim) + '"' + (c.iso ? ' data-iso="1"' : "") +
        ' style="--c1:' + h(c.c1) + ";--c2:" + h(c.c2) + ";--ink:" + h(c.ink) + '">' +
        (codes ? '<span class="fxcode" dir="ltr">' + h(c.code) + "</span>" : "") +
        "</span>");
    }
    out.push("</div>");
    return out.join("");
  }

  /* The preview sheet. One primary button, one secondary, and the honest
     label "this is what gets sent". No nag, no second ask, no "share to
     unlock" — fantasy-viral.md §H. */
  function shareSheetHtml(state) {
    var lang = state.lang === "en" ? "en" : "ar";
    return '<section class="shsheet">' +
      '<div class="shsheet__lbl">' + h(pick("shPreview", lang)) + "</div>" +
      '<div class="shsheet__frame">' + shareCardSvg(state, { frame: "post" }) + "</div>" +
      '<div class="shsheet__acts">' +
        '<button class="shbtn shbtn--go" data-sh="send">' + h(pick("shSend", lang)) + "</button>" +
        '<button class="shbtn" data-sh="copy">' + h(pick("shCopy", lang)) + "</button>" +
      "</div>" +
      '<pre class="shsheet__txt" dir="auto">' + h(shareText(state)) + "</pre>" +
      "</section>";
  }

  /* The cold-link landing hero — §D. Three seconds: a name they know, a
     number, fifteen colours, one button. No account, no download, no wall. */
  function shareLandingSvg(state) {
    var lang = state.lang === "en" ? "en" : "ar",
        name = (state.manager || {}).name || "",
        g = state.group || {};
    return '<header class="shland" dir="' + (lang === "en" ? "ltr" : "rtl") + '">' +
      '<p class="shland__who">' + h(fill("shLandWho", lang, { name: name })) + "</p>" +
      (g.name ? '<p class="shland__grp">' +
        h(fill("shLandGrp", lang, { name: g.name, n: g.size })) + "</p>" : "") +
      shareStripHtml(Object.assign({}, state, { variant: "guess" })) +
      '<p class="shland__what">' + h(pick("shLandWhat", lang)) + "</p>" +
      '<button class="shbtn shbtn--go shland__cta">' + h(pick("shLandCta", lang)) + "</button>" +
      '<p class="shland__free">' + h(pick("shLandFree", lang)) + "</p>" +
      "</header>";
  }

  /* ====================================================================== */
  /*  THE REVEAL — staged disclosure of an ALREADY-DECIDED outcome.          */
  /*                                                                         */
  /*  Borrowed from the FUT pack reveal, and it is worth being precise about */
  /*  what is and is not being borrowed. Regulator analyses (Norwegian       */
  /*  Consumer Council; Belgian Gaming Commission) establish that the entire */
  /*  payload of that animation is SEQUENCING: the outcome is decided before */
  /*  frame one, and the animation only controls when each detail becomes    */
  /*  visible, with a "tell" that fires seconds early.                       */
  /*                                                                         */
  /*  The sequencing is neutral and free — CSS transitions and setTimeout.   */
  /*  The randomised outcome is what makes a pack a pack, and it is REFUSED  */
  /*  (fantasy-engagement.md §J.2). Here the answer already exists, is fully */
  /*  determined by the sender's squad, and nothing is drawn from a          */
  /*  distribution. We are staging a fact, not rolling a die.                */
  /*                                                                         */
  /*  Order is cheapest-information-first, most-valuable-last, exactly as    */
  /*  FUT runs position -> nation -> league -> club -> rating:               */
  /*      the tell (which tile is captain)  ->  bench  ->  XI  ->  captain   */
  /*  Returns a plan, not an animation. Pure: same state, same array.        */
  /*                                                                         */
  /*  SCOPING, which matters: this runs on the ANSWER screen, after the      */
  /*  visitor taps "see the answer". It never runs on first paint — a cold   */
  /*  visitor has three seconds of patience and §D.1 spends all three.       */
  /* ====================================================================== */

  function shareRevealPlan(state, opts) {
    opts = opts || {};
    var clubs = stripOrder(state),
        capIdx = 0,                               /* cell 1 is always the captain */
        step = opts.step == null ? 90 : opts.step,
        plan = [], t = 0, i;

    /* the tell — the gold ring lands early, so you know WHICH one matters
       before you know WHAT it is. This is the whole trick. */
    plan.push({ at: 0,   step: "tell", index: capIdx });
    t = 420;

    for (i = clubs.length - 1; i >= 1; i--) {     /* bench first, then the XI */
      plan.push({ at: t, step: "code", index: i, code: clubs[i].code });
      t += step;
    }
    plan.push({ at: t + 260, step: "code", index: capIdx, code: clubs[capIdx].code });
    plan.push({ at: t + 260, step: "captain", index: capIdx });
    if (state.score != null) plan.push({ at: t + 700, step: "score", value: state.score });
    plan.push({ at: t + 1100, step: "done" });
    return plan;
  }

  /* ====================================================================== */
  /*  IMPURE EDGE — the only two functions here that touch the platform.     */
  /*  Everything above is a pure function and is tested as one. These two    */
  /*  are the boundary and are kept deliberately small.                      */
  /* ====================================================================== */

  /* SVG string -> PNG Blob, entirely on device.
     The data: URI is what makes this work: it loads without a network request
     AND without tainting the canvas, so toBlob() succeeds. This is also why
     the SVG may never contain <foreignObject>, an external font, or a remote
     image — any one of those breaks rasterisation, taints the canvas, or both. */
  function shareCardPng(svg, w, h2) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement("canvas");
          cv.width = w; cv.height = h2;
          var ctx = cv.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h2);
          cv.toBlob(function (b) { b ? res(b) : rej(new Error("toBlob")); }, "image/png");
        } catch (e) { rej(e); }
      };
      img.onerror = function () { rej(new Error("svg raster")); };
      /* encodeURIComponent, not btoa: btoa throws on Arabic. */
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }

  /* Hand the file to the OS. The app never sends anything to anyone — it
     renders an object and gives it to the share sheet. fantasy-engagement.md
     §J.6, and it is not negotiable.
     Returns which path was taken, so §I can measure the fallback rate. */
  function shareHandoff(blob, text, filename) {
    var file = null;
    try { file = new File([blob], filename || "goallak.png", { type: "image/png" }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], text: text })
        .then(function () { return "files"; })
        .catch(function (e) { return e && e.name === "AbortError" ? "cancelled" : "failed"; });
    }
    if (navigator.share) {
      return navigator.share({ text: text })
        .then(function () { return "text"; })
        .catch(function () { return "failed"; });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return "clipboard"; });
    }
    return Promise.resolve("none");
  }

  /* ----------------------------------------------------------------- export */
  var API = {
    SHARE_STR: SHARE_STR,
    shareCardSvg: shareCardSvg,
    shareStripSvg: shareStripSvg,
    shareStripHtml: shareStripHtml,
    shareSheetHtml: shareSheetHtml,
    shareLandingSvg: shareLandingSvg,
    shareText: shareText,
    shareRevealPlan: shareRevealPlan,
    shareEmojiStrip: shareEmojiStrip,
    shareFilename: shareFilename,
    shareCardPng: shareCardPng,
    shareHandoff: shareHandoff,
    /* exposed for tests and for the app's own inline uses */
    _stripOrder: stripOrder,
    _emojiFor: emojiFor,
    _kitTile: kitTile
  };

  if (typeof module === "object" && module && module.exports) {
    module.exports = API;                 /* Node — this is how a test reaches it */
  } else {
    for (var k in API) if (Object.prototype.hasOwnProperty.call(API, k)) root[k] = API[k];
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
