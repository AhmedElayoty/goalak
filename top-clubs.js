/* ============ GOALLAK · TOP-CLUBS DATASET ============
   WHY THIS FILE EXISTS
   The app used to fetch a FIXED list of LEAGUE scoreboards, so a top club playing a CUP was
   invisible. The owner's example: Barcelona v Al Ahly, Wed 19 Aug 2026 — absent from the league
   feed and absent from friendlies too, because it is the Trofeo Joan Gamper (ESPN competition
   id 17929). index.html now also reads the cross-competition feed .../soccer/all/scoreboard and
   keeps the events in which one of the clubs below is playing. This file is the club list and the
   competition-id -> name map that makes that work with ZERO extra runtime lookups.

   PROVENANCE — derived from the API, never typed from memory
   top5   https://site.api.espn.com/apis/v2/sports/soccer/{slug}/standings?season=2025
          season=2025 is ESPN's key for the 2025-26 campaign; the feed names it back to you as
          "2025-26 English Premier League". Verified COMPLETE, not assumed: every table returns a
          full fixture count — 38 played in ENG/ESP/ITA/SCO, 34 in GER/FRA/TUR. season=2026 returns
          the same tables with gamesPlayed 0, i.e. the campaign now starting, so it cannot be the
          source of a final ranking.
          MIND THE HOST PATH: apis/v2, NOT apis/site/v2. apis/site/v2/.../standings answers HTTP
          200 with an empty body — worse than an error, because it reads as a real reply. (This is
          the same base the app already keeps in its STAND constant.)
   comps  https://site.api.espn.com/apis/site/v2/leagues/dropdown?sport=soccer&limit=400
          Read once, baked in here. Measured 2026-08-17: that response is 570 KB, so fetching it
          at runtime merely to print a competition name would cost more than the fixtures do.
          Coverage measured over 6,056 distinct events across 40 days of all/scoreboard: every
          competition id resolved, zero misses. index.html still degrades to the event's own
          season.slug if an unknown id ever appears.

   REFRESHING: after each European season ends, re-run the standings call with the season year that
   just finished and replace the top5 blocks. UEFA club competitions are deliberately absent — they
   have no domestic table to rank by, and their clubs already sit in their own league's five.

   DELIBERATELY NOT HERE: Arabic CLUB names. index.html already owns that register (AR_TEAMS) and a
   second copy would drift out of step with it.
   ==================================================== */
window.GK_TOP_CLUBS = {
 "season": "2025-26",
 "espnSeason": 2025,
 "generated": "2026-08-17",
 "verifiedGamesPlayed": {
  "eng.1": 38,
  "esp.1": 38,
  "ita.1": 38,
  "ger.1": 34,
  "fra.1": 34,
  "tur.1": 34,
  "sco.1": 38
 },
 "leagues": {
  "epl": {
   "slug": "eng.1",
   "en": "Premier League",
   "top5": [
    {
     "r": 1,
     "id": "359",
     "n": "Arsenal"
    },
    {
     "r": 2,
     "id": "382",
     "n": "Manchester City"
    },
    {
     "r": 3,
     "id": "360",
     "n": "Manchester United"
    },
    {
     "r": 4,
     "id": "362",
     "n": "Aston Villa"
    },
    {
     "r": 5,
     "id": "364",
     "n": "Liverpool"
    }
   ]
  },
  "liga": {
   "slug": "esp.1",
   "en": "La Liga",
   "top5": [
    {
     "r": 1,
     "id": "83",
     "n": "Barcelona"
    },
    {
     "r": 2,
     "id": "86",
     "n": "Real Madrid"
    },
    {
     "r": 3,
     "id": "102",
     "n": "Villarreal"
    },
    {
     "r": 4,
     "id": "1068",
     "n": "Atlético Madrid"
    },
    {
     "r": 5,
     "id": "244",
     "n": "Real Betis"
    }
   ]
  },
  "seriea": {
   "slug": "ita.1",
   "en": "Serie A",
   "top5": [
    {
     "r": 1,
     "id": "110",
     "n": "Internazionale"
    },
    {
     "r": 2,
     "id": "114",
     "n": "Napoli"
    },
    {
     "r": 3,
     "id": "104",
     "n": "AS Roma"
    },
    {
     "r": 4,
     "id": "2572",
     "n": "Como"
    },
    {
     "r": 5,
     "id": "103",
     "n": "AC Milan"
    }
   ]
  },
  "bun": {
   "slug": "ger.1",
   "en": "Bundesliga",
   "top5": [
    {
     "r": 1,
     "id": "132",
     "n": "Bayern Munich"
    },
    {
     "r": 2,
     "id": "124",
     "n": "Borussia Dortmund"
    },
    {
     "r": 3,
     "id": "11420",
     "n": "RB Leipzig"
    },
    {
     "r": 4,
     "id": "134",
     "n": "VfB Stuttgart"
    },
    {
     "r": 5,
     "id": "7911",
     "n": "TSG Hoffenheim"
    }
   ]
  },
  "fl1": {
   "slug": "fra.1",
   "en": "Ligue 1",
   "top5": [
    {
     "r": 1,
     "id": "160",
     "n": "Paris Saint-Germain"
    },
    {
     "r": 2,
     "id": "175",
     "n": "Lens"
    },
    {
     "r": 3,
     "id": "166",
     "n": "Lille"
    },
    {
     "r": 4,
     "id": "167",
     "n": "Lyon"
    },
    {
     "r": 5,
     "id": "176",
     "n": "Marseille"
    }
   ]
  },
  "tsl": {
   "slug": "tur.1",
   "en": "Super Lig",
   "top5": [
    {
     "r": 1,
     "id": "432",
     "n": "Galatasaray"
    },
    {
     "r": 2,
     "id": "436",
     "n": "Fenerbahce"
    },
    {
     "r": 3,
     "id": "997",
     "n": "Trabzonspor"
    },
    {
     "r": 4,
     "id": "1895",
     "n": "Besiktas"
    },
    {
     "r": 5,
     "id": "7914",
     "n": "Istanbul Basaksehir"
    }
   ]
  },
  "spl": {
   "slug": "sco.1",
   "en": "Scottish Premiership",
   "top5": [
    {
     "r": 1,
     "id": "256",
     "n": "Celtic"
    },
    {
     "r": 2,
     "id": "262",
     "n": "Heart of Midlothian"
    },
    {
     "r": 3,
     "id": "257",
     "n": "Rangers"
    },
    {
     "r": 4,
     "id": "266",
     "n": "Motherwell"
    },
    {
     "r": 5,
     "id": "258",
     "n": "Hibernian"
    }
   ]
  }
 }
};

/* ESPN competition id -> [slug, English name, Arabic name?]. The id is the l: value inside an event
   uid (s:600~l:17929~e:401900551) — the ONLY competition marker all/scoreboard gives you; it carries
   no league name at all. The slug is load-bearing twice over: index.html uses it to tell that a
   competition is ALREADY covered by a league fetch (so nothing is double-counted), and it is the path
   that opens the match sheet (.../soccer/{slug}/summary?event=...). Arabic is filled in for the
   competitions that realistically host these clubs; everything else falls back to English on purpose. */
window.GK_COMPETITIONS = {"606":["fifa.world","FIFA World Cup","كأس العالم"],"620":["bol.1","Bolivian Liga Profesional"],"630":["bra.1","Brazil Serie A"],"640":["chi.1","Chilean Primera"],"650":["col.1","Colombian Primera A"],"660":["ecu.1","LigaPro Ecuador"],"670":["per.1","Peru Liga 1"],"680":["uru.1","Liga AUF Uruguaya"],"700":["eng.1","Premier League","الدوري الإنجليزي الممتاز"],"710":["fra.1","Ligue 1","الدوري الفرنسي"],"715":["por.1","Liga Portugal"],"720":["ger.1","Bundesliga","الدوري الألماني"],"725":["ned.1","Eredivisie"],"730":["ita.1","Serie A","الدوري الإيطالي"],"735":["sco.1","SPFL Premiership","الدوري الأسكتلندي الممتاز"],"740":["esp.1","LALIGA","الدوري الإسباني"],"745":["arg.1","Argentine LPF"],"750":["jpn.1","Japanese J1 League"],"760":["mex.1","Liga MX"],"770":["usa.1","MLS"],"775":["uefa.champions","UEFA Champions League","دوري أبطال أوروبا"],"776":["uefa.europa","UEFA Europa League","الدوري الأوروبي"],"780":["conmebol.america","Copa América"],"781":["uefa.euro","EURO","بطولة أمم أوروبا"],"782":["fifa.intercontinental.cup","Intercontinental Cup (India)"],"783":["conmebol.libertadores","CONMEBOL Libertadores"],"786":["fifa.worldq.uefa","WCQ - UEFA"],"787":["fifa.worldq.conmebol","WCQ - CONMEBOL"],"788":["fifa.worldq.concacaf","WCQ - Concacaf"],"789":["fifa.worldq.afc","WCQ - AFC"],"790":["fifa.worldq.caf","WCQ - CAF"],"792":["fifa.worldq.ofc","WCQ - OFC"],"795":["fifa.wwc","FIFA Women's World Cup"],"2265":["bra.camp.carioca","Brazil Carioca"],"2272":["bra.camp.gaucho","Brazil Gaucho"],"2391":["caf.champions","CAF Champions League"],"2395":["uefa.nations","UEFA Nations League","دوري الأمم الأوروبية"],"2466":["afc.cup","AFC Champions League Two"],"3901":["bel.1","Belgian Pro League"],"3902":["afc.champions","AFC Champions League Elite"],"3903":["arg.2","Argentine Nacional B"],"3904":["arg.3","Argentine Primera B"],"3906":["aus.1","A-League Men"],"3907":["aut.1","Austrian Bundesliga"],"3908":["caf.nations","Africa Cup of Nations"],"3911":["concacaf.u23","CONCACAF U23 Tournament"],"3913":["den.1","Danish Superliga"],"3914":["eng.2","EFL Championship","دوري البطولة الإنجليزية"],"3915":["eng.3","EFL League One","دوري الدرجة الأولى الإنجليزي"],"3916":["eng.4","EFL League Two","دوري الدرجة الثانية الإنجليزي"],"3917":["eng.5","National League"],"3918":["eng.fa","English FA Cup","كأس الاتحاد الإنجليزي"],"3920":["eng.league_cup","Carabao Cup","كأس الرابطة الإنجليزية"],"3921":["esp.2","LALIGA 2","دوري الدرجة الثانية الإسباني"],"3922":["fifa.friendly","Men's International Friendly","مباراة دولية ودية"],"3923":["fifa.friendly.w","Women's International Friendly"],"3924":["fifa.olympics","OLY Soccer (M)"],"3925":["fifa.w.olympics","OLY Soccer (W)"],"3926":["fra.2","Ligue 2","دوري الدرجة الثانية الفرنسي"],"3927":["ger.2","2. Bundesliga","دوري الدرجة الثانية الألماني"],"3928":["gua.1","Guatemalan Liga Nacional"],"3929":["hon.1","Honduran Liga Nacional"],"3931":["ita.2","Italian Serie B","دوري الدرجة الثانية الإيطالي"],"3932":["mex.2","Liga de Expansión MX"],"3933":["ned.2","Keuken Kampioen Divisie"],"3934":["par.1","Paraguayan Primera"],"3937":["rsa.1","South African Premier"],"3939":["rus.1","Russian Premier"],"3940":["sco.2","SPFL Championship","دوري الدرجة الأولى الأسكتلندي"],"3943":["slv.1","Salvadoran Primera"],"3945":["swe.1","Swedish Allsvenskan"],"3946":["tur.1","Turkish Super Lig","الدوري التركي"],"3947":["uefa.euroq","EURO Qualifying","تصفيات أمم أوروبا"],"3948":["uru.2","Segunda"],"3949":["ven.1","Liga FUTVE"],"3951":["esp.copa_del_rey","Copa del Rey","كأس ملك إسبانيا"],"3952":["fra.coupe_de_france","Coupe de France","كأس فرنسا"],"3954":["ger.dfb_pokal","German Cup","كأس ألمانيا"],"3955":["gre.1","Greek Super League"],"3956":["ita.coppa_italia","Coppa Italia","كأس إيطاليا"],"3957":["ned.cup","KNVB Beker","كأس هولندا"],"3959":["sco.tennents","Scottish Cup","كأس أسكتلندا"],"3960":["nor.1","Norwegian Eliteserien"],"4002":["usa.usl.1","USL Championship"],"4004":["concacaf.gold","Gold Cup"],"4005":["crc.1","Liga FPD"],"4007":["bra.2","Brazil Serie B"],"5329":["eng.charity","Community Shield","درع المجتمع الإنجليزي"],"5330":["sco.cis","Scottish League Cup","كأس الرابطة الأسكتلندية"],"5331":["sco.challenge","SPFL Challenge Cup","كأس التحدي الأسكتلندي"],"5337":["usa.open","U.S. Open Cup"],"5342":["fifa.w.concacaf.olympicsq","Concacaf Women's Olympic Qualifying"],"5454":["conmebol.sudamericana","CONMEBOL Sudamericana"],"5462":["uefa.super_cup","UEFA Super Cup","كأس السوبر الأوروبي"],"5487":["usa.ncaa.m.1","NCAAM Soccer"],"5499":["usa.ncaa.w.1","NCAAW Soccer"],"5501":["fifa.cwc","Club World Cup","كأس العالم للأندية"],"5662":["afc.cupq","Asian Cup Qualifiers"],"5672":["aff.championship","ASEAN Champ"],"5692":["concacaf.champions_cup","Champions Cup"],"5693":["uefa.euro_u21","EURO Under-21"],"5694":["fifa.world.u20","FIFA U-20 World Cup"],"5697":["fifa.world.u17","FIFA U-17 World Cup"],"5698":["uefa.euro.u19","EURO Under-19"],"5699":["concacaf.champions","Concacaf Champions Cup"],"8097":["eng.w.1","Women's Super League"],"8101":["ger.super_cup","German SuperCup","كأس السوبر الألماني"],"8102":["esp.super_cup","Spanish Supercopa","كأس السوبر الإسباني"],"8103":["ita.super_cup","Italian Supercoppa","كأس السوبر الإيطالي"],"8107":["arg.copa","Copa Argentina"],"8207":["bra.camp.paulista","Brazil Paulista"],"8301":["usa.nwsl","NWSL"],"8304":["ger.playoff.relegation","Bundesliga Pro/Rel"],"8305":["ned.playoff.relegation","Eredivisie Pro/Rel"],"8306":["bra.copa_do_brazil","Copa Do Brazil"],"8312":["chi.copa_chi","Copa Chile"],"8313":["col.copa","Copa Colombia"],"8315":["caf.nations_qual","AFCON Qualifying"],"8316":["ind.1","Indian Super League"],"8333":["conmebol.recopa","CONMEBOL Recopa"],"8346":["arg.supercopa","Argentine Supercopa"],"8357":["fra.super_cup","Trophee des Champions","كأس السوبر الفرنسي"],"8360":["concacaf.confederations_playoff","Confed Cup Playoff"],"8364":["chi.super_cup","Chilean Supercopa"],"8365":["caf.championship","CHAN"],"8376":["chn.1","Chinese Super League"],"10749":["ned.supercup","Johan Cruyff Shield","درع يوهان كرويف"],"10872":["bra.camp.mineiro","Brazil Mineiro"],"11108":["friendly.emirates_cup","Emirates Cup","كأس الإمارات"],"17893":["mex.campeon","Campeon de Campeones"],"17915":["uefa.weuro","Women's EURO"],"17929":["esp.joan_gamper","Trofeo Joan Gamper","كأس جوان غامبر"],"17931":["jpn.world_challenge","J.League World Challenge"],"18000":["caf.confed","CAF Confederation Cup"],"18481":["eng.trophy","EFL Trophy","كأس درع الرابطة الإنجليزية"],"18771":["campeones.cup","Campeones Cup","كأس الأبطال"],"18914":["afc.saff.championship","SAFF Championship"],"18969":["concacaf.womens.championship","Concacaf W Championship"],"18992":["aus.w.1","A-League Women"],"19112":["col.superliga","Colombian Superliga"],"19264":["arg.copa_de_la_superliga","ARGCOPASUPERLIGA"],"19267":["concacaf.nations.league","Concacaf Nations League"],"19425":["concacaf.leagues.cup","Leagues Cup","كأس الدوريات"],"19483":["uefa.wchampions","UEFA Women's Champions League"],"19705":["arg.trofeo_de_la_campeones","Argentine Trofeo de Campeones"],"19721":["bra.supercopa_do_brazil","Supercopa Rei"],"19725":["nonfifa","NONFIFA"],"19727":["fifa.conmebol.olympicsq","CONMEBOL Pre-Olympic Tournament"],"19728":["fifa.shebelieves","SheBelieves Cup"],"19778":["concacaf.gold_qual","Concacaf Gold Cup Qualifying"],"19831":["fifa.concacaf.olympicsq","Men's Olympic Qualifying Playoff"],"19834":["club.friendly","Club Friendly","مباراة ودية للأندية"],"19868":["usa.nwsl.cup","NWSL Challenge Cup"],"19871":["ger.2.promotion.relegation","2. Bundesliga Pro/Rel"],"19874":["uefa.champions_qual","UCL Qualifying","تصفيات دوري أبطال أوروبا"],"19887":["uefa.europa_qual","UEL Qualifying","تصفيات الدوري الأوروبي"],"19915":["usa.usl.l1","USL League One"],"19945":["ned.w.1","Dutch Vrouwen Eredivisie"],"19948":["chn.1.promotion.relegation","Chinese Pro/Rel"],"19968":["swe.1.promotion.relegation","Swedish Allsvenskan Pro/Rel"],"19989":["nor.1.promotion.relegation","Eliteserien Pro/Rel"],"20114":["uefa.euro_u21_qual","EURO U-21 Qualifying"],"20115":["ned.w.knvb_cup","Dutch Vrouwen KNVB Beker"],"20116":["bel.promotion.relegation","Belgian Pro League Pro/Rel"],"20132":["fifa.friendly_u21","Men's U-21 Friendly"],"20133":["sco.1.promotion.relegation","SPFL Premiership Pro/Rel"],"20134":["sco.2.promotion.relegation","SPFL Championship Pro/Rel"],"20159":["fra.1.promotion.relegation","Ligue 1 Pro/Rel"],"20186":["por.1.promotion.relegation","Portuguese Liga Pro/Rel"],"20219":["afc.asian.cup","AFC Asian Cup"],"20220":["caf.cosafa","COSAFA Cup"],"20221":["uefa.europa.conf_qual","UECL Qualifying","تصفيات دوري المؤتمر الأوروبي"],"20226":["eng.w.fa","Women's FA Cup"],"20296":["uefa.europa.conf","UEFA Conference League","دوري المؤتمر الأوروبي"],"20381":["esp.copa_de_la_reina","Copa de la Reina"],"20524":["chi.1.promotion.relegation","Chilean Pro/Rel"],"20525":["bol.ply.rel","Bolivian Liga Pro/Rel"],"20526":["par.1.supercopa","Paraguayan Supercopa"],"20566":["global.arnold.clark_cup","Arnold Clark Cup"],"20571":["global.pinatar_cup","Pinatar Cup"],"20649":["fifa.wworldq.uefa","WWCQ - UEFA"],"20703":["conmebol.america.femenina","Copa América Femenina"],"20704":["global.finalissima","Men's Finalissima","الفينالسيما"],"20731":["rus.1.promotion.relegation","Russian Premier League Pro/Rel"],"20798":["ned.3.promotion.relegation","Dutch Tweede Divisie Pro/Rel Playoffs"],"20865":["fifa.wworld.u17","U-17 WWC"],"20922":["por.taca.portugal","Taca de Portugal"],"20955":["fra.w.1","Première Ligue"],"20956":["esp.w.1","Liga F"],"21191":["global.w.finalissima","Women's Finalissima"],"21231":["ksa.1","Saudi Pro League"],"21597":["global.club_challenge","CONMEBOL-UEFA Club Challenge","تحدي الأندية (كونميبول - يويفا)"],"22057":["ksa.kings.cup","Saudi King's Cup","كأس الملك السعودي"],"22059":["usa.usl.l1.cup","USL Cup"],"22060":["concacaf.w.gold"," W Gold Cup"],"22781":["global.u20.intercontinental_cup","U20 Intercontinental Cup"],"22902":["fifa.intercontinental_cup","Intercontinental Cup","كأس القارات للأندية"],"22946":["concacaf.w.champions_cup","W Champions Cup"],"22947":["concacaf.central.american.cup","Concacaf Central American Cup"],"23088":["uefa.w.nations","Women's Nations League"],"23107":["global.gulf_cup","Arabian Gulf Cup","كأس الخليج العربي"],"23284":["bol.copa","Copa Bolivia"],"23286":["can.w.nsl","Northern Super League"],"23348":["arg.supercopa.internacional","Supercopa Internacional"],"23390":["eng.w.league_cup","Women's League Cup"],"23449":["fifa.wcq.ply","WCQ - Playoff Tournament"],"23523":["caf.w.nations","Women's Africa Cup of Nations"],"23537":["afc.w.asian.cup","AFC Women's Asian Cup"],"23633":["usa.w.usl.1","USL Super League"],"24079":["uefa.w.europa","Women's Europa Cup"],"24081":["fifa.w.champions_cup","Women's Champions Cup"],"24405":["eng.w.promotion.relegation","Women's Super League Pro/Rel"],"24452":["afc.champions_qual","AFC Champions League Elite Qualifying"],"24455":["afc.cup_qual","AFC Champions League Two Qualifying"],"24458":["uefa.wchampions_qual","UEFA Women's Champions League Qualifying"]};
