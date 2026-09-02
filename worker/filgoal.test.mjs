/* THE PUBLISHER'S PAGE, PARSED DEFENSIVELY. A sample of FilGoal's embedded JSON (shape captured
 * 2026-09-02) walks through the extractor, the mapping and the polling plan.  node filgoal.test.mjs */
import { extractViewModel, parseDay, fgToFixture, fgPlan, utcDay, wanted, parseMatchBlob, findTwin, norm, indexRows, fgEventsToAf } from "./src/filgoal.js";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL  " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", wanted " + JSON.stringify(b) + ")");
const NOW = Date.UTC(2026, 8, 1, 18, 40);
const html = 'junk <script>\n var viewModelData = [{"Date":"\\/Date(1788210000000)\\/","Matches":[' +
 '{"ChampionshipSlug":"الدوري-المصري","Id":375884,"HomeTeamId":1016,"HomeTeamName":"وادي دجلة","AwayTeamId":12,"AwayTeamName":"القناة","ChampionshipId":1667,"ChampionshipName":"الدوري المصري","Week":3,"Date":"\\/Date(1788282000000)\\/","HomeScore":0,"AwayScore":0,"StadiumName":"استاد السلام","MatchStatusName":"انتهت","CurrentMatchStatusText":"over","TimeElapsed":{"Minutes":796}},' +
 '{"Id":1,"HomeTeamId":5,"HomeTeamName":"الأهلي","AwayTeamId":6,"AwayTeamName":"الزمالك","ChampionshipId":1667,"ChampionshipName":"الدوري المصري","Week":3,"Date":"\\/Date(1788280800000)\\/","HomeScore":2,"AwayScore":1,"CurrentMatchStatusText":"live","CurrentMatchStatus":{"MatchStatusName":"الشوط الثاني","TimeElapsedBeforeStatus":45,"TimeElapsed":{"Minutes":22,"Seconds":10}}},' +
 '{"Id":2,"HomeTeamId":7,"HomeTeamName":"بيراميدز","AwayTeamId":8,"AwayTeamName":"المصري","ChampionshipId":1667,"ChampionshipName":"الدوري المصري","Week":3,"Date":"\\/Date(1788292800000)\\/","HomeScore":null,"AwayScore":null,"MatchStatusName":"لم تبدأ","CurrentMatchStatusText":"upcoming","TimeElapsed":null},' +
 '{"Id":3,"HomeTeamId":9,"HomeTeamName":"أودينيزي","AwayTeamId":10,"AwayTeamName":"فينيسيا","ChampionshipId":99,"ChampionshipName":"كأس إيطاليا","Date":"\\/Date(1788282000000)\\/","HomeScore":1,"AwayScore":0,"CurrentMatchStatusText":"over"}' +
 ']}];\n bindStreamingCalls();</script> "a ] } trap" ';
console.log("\n1 · extraction and filtering");
const vm = extractViewModel(html);
ok(Array.isArray(vm) && vm[0].Matches.length === 4, "the array is cut out of the page exactly, brackets inside strings notwithstanding");
const rows = parseDay(html, NOW);
eq(rows.length, 3, "only the Egyptian league survives (the Coppa Italia row is dropped)");
console.log("\n2 · mapping");
const [ft, live, pre] = rows;
eq(ft.fixture.status.short, "FT", "\"over\" is full time");
eq(ft.fixture.date, "2026-09-01T17:00:00.000Z", "/Date(ms)/ becomes ISO UTC (20:00 Cairo summer time)");
eq(ft.goals.home + "-" + ft.goals.away, "0-0", "finished score kept");
eq(live.fixture.status.short, "2H", "\"live\" in the second half");
eq(live.fixture.status.elapsed, 67, "the minute is 45 + minutes since the half began (CurrentMatchStatus, not the top level - a running match once read 0')");
const fh = fgToFixture({Id:8,HomeTeamId:1,AwayTeamId:2,HomeTeamName:"الجونة",AwayTeamName:"المقاولون العرب",ChampionshipId:1667,Date:"/Date(1788357600000)/",HomeScore:0,AwayScore:0,CurrentMatchStatusText:"live",CurrentMatchStatus:{MatchStatusName:"الشوط الاول",TimeElapsedBeforeStatus:0,TimeElapsed:{Minutes:17,Seconds:50}}}, 1788358700000);
eq(fh.fixture.status.short + "/" + fh.fixture.status.elapsed, "1H/17", "first half, 17th minute - the real payload of 2026-09-02");
const ht = fgToFixture({Id:8,HomeTeamId:1,AwayTeamId:2,HomeTeamName:"a",AwayTeamName:"b",ChampionshipId:1667,Date:"/Date(1788357600000)/",HomeScore:0,AwayScore:0,CurrentMatchStatusText:"live",CurrentMatchStatus:{MatchStatusName:"استراحة بين الشوطين",TimeElapsedBeforeStatus:45,TimeElapsed:{Minutes:5}}}, 1788361000000);
eq(ht.fixture.status.short, "HT", "the break is half time");
eq(live.teams.home.name, "Al Ahly", "known clubs travel in English (the shell maps back to Arabic)");
eq(live.teams.home.nameAr, "الأهلي", "and keep FilGoal's Arabic beside it");
eq(rows[0].teams.away.name, "El Qanah", "El Qanah too");
eq(pre.fixture.status.short, "NS", "an upcoming match is NS");
eq(pre.goals.home, null, "and carries no score - not a fake 0");
eq(live.league.id, 1667, "league id is FilGoal's");
console.log("\n2b · cups ride along, CAF does not");
ok(wanted({Id:9,HomeTeamName:"الأهلي",AwayTeamName:"الزمالك",ChampionshipId:5,ChampionshipName:"كأس مصر"}), "Egypt Cup with an Egyptian club: taken");
ok(!wanted({Id:9,HomeTeamName:"الأهلي",AwayTeamName:"صن داونز",ChampionshipId:7,ChampionshipName:"دوري أبطال أفريقيا"}), "CAF Champions League: left to ESPN's Top Clubs feed");
ok(!wanted({Id:9,HomeTeamName:"الهلال",AwayTeamName:"النصر",ChampionshipId:8,ChampionshipName:"كأس السوبر السعودي"}), "another country's cup: no");
eq(fgToFixture({Id:9,HomeTeamId:1,AwayTeamId:2,HomeTeamName:"الأهلي",AwayTeamName:"الزمالك",ChampionshipId:5,ChampionshipName:"كأس السوبر المصري",Date:"/Date(1788282000000)/",HomeScore:null,AwayScore:null,CurrentMatchStatusText:"upcoming"}, NOW).league.nameEn, "Egyptian Super Cup", "the cup's English name travels");
console.log("\n2c · a match page: commentary, clips, events");
const page = 'x {"TimeZoneConsidered":true,"Id":375883,"HomeTeamName":"غزل المحلة","AwayTeamName":"الشرقية إنبي","HomeScore":0,"AwayScore":0,"CurrentMatchStatusText":"over","HomeTeamCoachName":"أ","AwayTeamCoachName":"ب","Comments":[{"Id":1,"Time":49,"ContentUrl":"","Content":"تسديدة قوية","MatchStatusName":"الشوط الثاني"},{"Id":2,"Time":30,"ContentUrl":"<blockquote class=\\"twitter-tweet\\"><p lang=\\"ar\\">جول</p>&mdash; FilGoal (@FilGoal) <a href=\\"https://twitter.com/FilGoal/status/1234567890?ref_src=twsrc%5Etfw\\">September 2, 2026</a></blockquote>","Content":"جووول","MatchStatusName":"الشوط الأول"}],"Events":[{"MatchEventTypeName":"بطاقة صفراء","TeamName":"غزل المحلة","PlayerAName":"عمرو جمعة","Minute":12},{"MatchEventTypeName":"هدف","TeamName":"الشرقية إنبي","PlayerAName":"س","Minute":30}]} y';
const mb = parseMatchBlob(page, 375883);
eq(mb.comments.length, 2, "two commentary lines"); eq(mb.comments[1].url, "https://twitter.com/FilGoal/status/1234567890", "the clip link is pulled out of the embed HTML FilGoal calls a URL (2026-09-02: the raw embed became a 404 on goallak.com)"); eq(mb.events.filter(e => e.goal).length, 1, "one goal event"); eq(mb.events[0].yellow, true, "a yellow is a yellow"); eq(mb.over, true, "finished");
console.log("\n2c2 · events become goals, cards and subs the timeline understands");
const afe = fgEventsToAf(mb.events, rows[0]);
eq(afe.length, 2, "two events"); eq(afe[0].type + "/" + afe[0].detail, "Card/Yellow Card", "the yellow"); eq(afe[1].type + "/" + afe[1].detail, "Goal/Normal Goal", "the goal"); eq(afe[1].time.elapsed, 30, "at minute 30");
eq(fgEventsToAf([{type:"هدف من ضربة جزاء",team:"x",teamId:1,player:"p",min:88}])[0].detail, "Penalty", "a penalty goal is a penalty");
eq(fgEventsToAf([{type:"ضربة جزاء ضائعة",team:"x",teamId:1,player:"p",min:88}])[0].detail, "Missed Penalty", "a missed one is not a goal");
console.log("\n2d · finding a European match's twin by Arabic names and kick-off");
const idx = indexRows(html);
eq(idx.length, 4, "the index keeps every competition");
const ko = 1788280800000;
eq(findTwin(idx, "الأهلي", "الزمالك", ko).id, 1, "exact names");
eq(findTwin(idx, "نادي الأهلي", "الزمالك", ko + 60000).id, 1, "'نادي' and a minute's drift are forgiven");
eq(findTwin(idx, "ليفربول", "إيفرتون", ko), null, "no twin invents nothing");
eq(norm("نوتينجهام فورست"), norm("نوتينجهام فورست"), "normalisation is stable");
console.log("\n3 · the plan: one page a minute during a match, once a day otherwise");
const fx = rows;
eq(fgPlan(NOW, { scheduleDay: utcDay(NOW), lastLive: NOW - 61000 }, fx).kind, "live", "a match in its window: fetch the day page");
eq(fgPlan(NOW, { scheduleDay: utcDay(NOW), lastLive: NOW - 30000 }, fx), null, "but not twice inside a minute");
eq(fgPlan(NOW, { scheduleDay: null, lastLive: NOW }, fx).kind, "schedule", "the week ahead once a day");
const quiet = Date.UTC(2026, 8, 1, 9, 0);
eq(fgPlan(quiet, { scheduleDay: utcDay(quiet), lastLive: quiet - 31 * 60000 }, fx).kind, "live", "a quiet half-hourly look on a match day");
eq(fgPlan(quiet, { scheduleDay: utcDay(quiet), lastLive: quiet - 10 * 60000 }, fx), null, "and no more than that");
eq(fgPlan(Date.UTC(2026, 8, 3, 9, 0), { scheduleDay: "2026-09-03", lastLive: 0 }, fx), null, "a day with no Egyptian match: nothing at all");
console.log("\n" + (fail ? "FAILED  " + fail + " of " + (pass + fail) : "PASSED  " + pass + " assertions, 0 failures") + "\n");
process.exit(fail ? 1 : 0);
