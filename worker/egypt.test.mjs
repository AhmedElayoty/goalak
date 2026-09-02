/* THE HUNDRED-CALL RATION, PROVEN BEFORE A SINGLE CALL IS MADE.
 *
 * The scheduler decides what one provider call a tick may make; these cases walk whole
 * Egyptian match days through it - the real shapes measured from the 2026-27 schedule: two
 * kick-offs only, 14:00 and 17:00 UTC, one or two slots a day - and count the calls. The two
 * promises under test are the owner's: the day never ends with the league dark because the
 * quota ran out, and nothing is polled that cannot be afforded. The adapters are tested on
 * API-Football's documented v3 shapes; the first real key re-verifies them.
 *
 *   node egypt.test.mjs        (from goalak/worker)
 */
import { planTick, chargeBudget, freshBudget, affordable, toEspnEvent, toEspnSummary, toEspnStandings,
         seasonFor, utcDay, DAILY_LIMIT, RESERVE, LIVE_WINDOW_AFTER, budgetFor, retryAt, afDoor, RAPID_HOST } from "./src/egypt.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL  " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", wanted " + JSON.stringify(b) + ")");

const DAY = Date.UTC(2026, 8, 5);                       /* a Saturday, 00:00 UTC */
const KO1 = DAY + 14 * 3600000, KO2 = DAY + 17 * 3600000;
const fx = (id, ko, state) => ({ id, ko, state: state || "pre" });

/* simulate a whole day minute by minute: apply each decision as the tick would */
function runDay(fixtures, opts) {
  opts = opts || {};
  let budget = freshBudget(DAY), sched = opts.firstEver ? {} : { standingsDay: "2026-09-04" }, calls = [];
  const state = {}; fixtures.forEach(f => state[f.id] = "pre");
  for (let m = 0; m < 24 * 60; m++) {
    const now = DAY + m * 60000;
    const fs = fixtures.map(f => ({ id: f.id, ko: f.ko, state: state[f.id] }));
    /* the world: a match is in play from kick-off to KO+97 (90 + 7 stoppage/HT), then FT */
    fixtures.forEach(f => { if (now >= f.ko && now < f.ko + 97 * 60000) state[f.id] = "in"; if (now >= f.ko + 97 * 60000) state[f.id] = "post-real"; });
    /* the provider's live feed lists only matches in progress: a finished match VANISHES from it
       and only the dated sweep reveals FT - the scheduler must cope with that, so we model it */
    const known = fixtures.map(f => ({ id: f.id, ko: f.ko, state: state[f.id] === "post-real" ? (sched._seenFT && sched._seenFT[f.id] ? "post" : "in") : state[f.id],
                                       gone: !!(sched._gone && sched._gone[f.id]) }));
    const plan = planTick(now, budget, known, sched);
    if (!plan) continue;
    calls.push({ m, kind: plan.kind, interval: plan.interval });
    budget = chargeBudget(budget, null, {});                 /* no header: we count ourselves */
    if (plan.kind === "schedule") { sched.scheduleDay = utcDay(now); if (plan.refresh) sched.refreshDay = utcDay(now); }
    if (plan.kind === "live") { sched.lastLive = now; sched._gone = sched._gone || {}; fixtures.forEach(f => { if (state[f.id] === "post-real") sched._gone[f.id] = true; }); }
    if (plan.kind === "finals") { const k = String(plan.slot); sched.finals = sched.finals || {}; const e = sched.finals[k] || { n: 0, at: 0 }; e.n++; e.at = now; sched.finals[k] = e; sched._seenFT = sched._seenFT || {}; fixtures.forEach(f => { if (f.ko === plan.slot && state[f.id] === "post-real") sched._seenFT[f.id] = true; }); }
    if (plan.kind === "lineups") { sched.lineups = sched.lineups || {}; const l = sched.lineups[plan.fixture] || { n: 0, have: false }; l.n++; l.have = !opts.lineupsNeverPublish; sched.lineups[plan.fixture] = l; }
    if (plan.kind === "standings") sched.standingsDay = utcDay(now);
  }
  return { calls, budget, sched };
}
const count = (calls, kind) => calls.filter(c => c.kind === kind).length;
const liveGaps = calls => { const ms = calls.filter(c => c.kind === "live").map(c => c.m); const g = []; for (let i = 1; i < ms.length; i++) g.push(ms[i] - ms[i - 1]); return g; };

console.log("\n1 · the usual day: two slots, three matches - never over budget, live every ~2-3 minutes");
{
  const r = runDay([fx("a", KO1), fx("b", KO1), fx("c", KO2)]);
  ok(r.budget.used <= DAILY_LIMIT - RESERVE, "the day stays under the ceiling minus reserve: used " + r.budget.used);
  ok(r.budget.used >= 60, "and it does not hoard - most of the ration is spent on football: used " + r.budget.used);
  eq(count(r.calls, "schedule"), 2, "one schedule call at midnight and one noon refresh");
  eq(count(r.calls, "lineups"), 3, "one line-up call per match (they published first time)");
  eq(count(r.calls, "finals"), 2, "one final-results sweep per slot, fired the moment the live feed drops the match");
  const ft1 = r.calls.find(c => c.kind === "finals");
  ok(ft1 && ft1.m - (KO1 - DAY) / 60000 <= 100, "the first slot's FT is fetched within minutes of the whistle, not at KO+112: KO+" + (ft1.m - (KO1 - DAY) / 60000));
  eq(count(r.calls, "standings"), 1, "the table once, after the last whistle");
  const gaps = liveGaps(r.calls).filter(g => g < 60);        /* gaps inside a slot, not the dead hour */
  ok(gaps.length && Math.max(...gaps) <= 4, "live polls inside a slot are never more than 4 minutes apart: max " + Math.max(...gaps));
  ok(Math.min(...gaps) >= 1, "and never faster than the per-minute cron");
  const dead = r.calls.filter(c => c.kind === "live" && c.m > (KO1 - DAY) / 60000 + 116 && c.m < (KO2 - DAY) / 60000 - 2);
  eq(dead.length, 0, "nothing is polled in the dead hour between the slots");
}

console.log("\n2 · a one-slot day gets the fastest cadence the ration allows");
{
  const r = runDay([fx("a", KO1), fx("b", KO1)]);
  const gaps = liveGaps(r.calls);
  ok(gaps.length && Math.max(...gaps) <= 2, "live polls every 1-2 minutes on a one-slot day: max gap " + Math.max(...gaps));
  ok(r.budget.used <= DAILY_LIMIT - RESERVE, "still under the ceiling: " + r.budget.used);
}

console.log("\n3 · a four-match day costs no more than a two-match day (one live call covers all)");
{
  const two = runDay([fx("a", KO1), fx("b", KO2)]);
  const four = runDay([fx("a", KO1), fx("b", KO1), fx("c", KO2), fx("d", KO2)]);
  const dl = count(four.calls, "live") - count(two.calls, "live");
  ok(dl <= 0 && dl >= -4, "live polls do not grow with the match count (a few fewer, since two more line-ups are reserved): " + count(four.calls, "live") + " vs " + count(two.calls, "live"));
  eq(count(four.calls, "lineups") - count(two.calls, "lineups"), 2, "only the line-up calls grow, one per extra match");
  ok(four.budget.used <= DAILY_LIMIT - RESERVE, "and the heavier day is still under the ceiling: " + four.budget.used);
}

console.log("\n4 · a day with no football spends one call, and no more");
{
  const r = runDay([]);
  eq(r.budget.used, 1, "the schedule window only");
  eq(count(r.calls, "live") + count(r.calls, "standings") + count(r.calls, "finals"), 0, "nothing else");
  const first = runDay([], { firstEver: true });
  eq(first.budget.used, 2, "the very first day ever also fetches the table once - the club picker needs it before any match is played");
  eq(count(first.calls, "standings"), 1, "exactly once");
}

console.log("\n5 · the reserve is never spent, whatever the day looks like");
{
  /* an impossible day - four slots - forces the scheduler to stretch; it must stretch, not overspend */
  const r = runDay([fx("a", DAY + 10 * 3600000), fx("b", DAY + 13 * 3600000), fx("c", DAY + 16 * 3600000), fx("d", DAY + 19 * 3600000)]);
  ok(r.budget.used <= DAILY_LIMIT - RESERVE, "four slots: used " + r.budget.used + " of " + (DAILY_LIMIT - RESERVE));
  ok(count(r.calls, "live") > 0, "and it still polled live football rather than giving up");
}
{
  const b = Object.assign(freshBudget(DAY), { remaining: RESERVE });
  eq(planTick(KO1 + 60000, b, [fx("a", KO1, "in")], { scheduleDay: utcDay(DAY) }), null, "with only the reserve left, a live match is NOT polled");
  eq(affordable(b), 0, "affordable() says zero");
}

console.log("\n6 · the provider's own count is believed over ours, and its quota error ends the day");
{
  const h = new Headers({ "x-ratelimit-requests-remaining": "37" });
  const b = chargeBudget(freshBudget(DAY), h, {});
  eq(b.remaining, 37, "the header's remaining count wins");
  eq(b.used, 1, "our own counter still ticks");
  const q = chargeBudget(freshBudget(DAY), null, { errors: { requests: "You have reached the request limit for the day" } });
  eq(q.remaining, 0, "a 200 carrying errors.requests means the quota is gone");
  eq(q.exhausted, true, "and is marked exhausted, not retried");
  const m = chargeBudget(freshBudget(DAY), null, { errors: { rateLimit: "Too many requests. You have exceeded the limit of requests per minute of your subscription." } });
  eq(m.exhausted, false, "a per-MINUTE rebuff does not end the day (2026-09-02: it did, after the second call ever)");
  eq(m.blockKind, "minute", "it is a minute-block");
  eq(retryAt(Object.assign({}, m, { blockedAt: DAY })) - DAY, 2 * 60000, "retried two minutes later");
  const reopened = budgetFor({ day: utcDay(DAY), used: 2, remaining: 0, exhausted: true, reason: "quota", lastError: "Too many requests. You have exceeded the limit of requests per minute of your subscription." }, DAY);
  eq(reopened.exhausted, false, "a day written off for a per-minute rebuff by the old code is re-opened");
  eq(reopened.blockKind, "minute", "as a minute-block");
  const noHeader = chargeBudget(freshBudget(DAY), null, {});
  eq(noHeader.remaining, DAILY_LIMIT - 1, "with no header we count down ourselves");
  const emptyHeaders = chargeBudget(freshBudget(DAY), new Headers({}), {});
  eq(emptyHeaders.remaining, DAILY_LIMIT - 1, "a Headers object WITHOUT the count is not a count of zero (2026-09-02: it zeroed the day)");
  const fine = chargeBudget(freshBudget(DAY), null, { errors: [] });
  eq(fine.exhausted, false, "the provider's normal empty errors array is not an error");
  eq(fine.blocked, null, "and does not block");
}

console.log("\n6b · a plan / key / parameter error is NOT the quota: keep its words, back off, try again later");
{
  const p = chargeBudget(freshBudget(DAY), null, { errors: { plan: "Free plans do not have access to this season, try from 2021 to 2023." } });
  eq(p.exhausted, false, "a plan error does not write the day off");
  ok(/Free plans do not have access/.test(p.blocked), "the provider's sentence is kept for the status route: " + p.blocked);
  eq(p.blockN, 1, "first block");
  eq(planTick(DAY + 60000, Object.assign({}, p, { blockedAt: DAY }), [], {}), null, "while blocked, nothing is asked");
  ok(planTick(DAY + 31 * 60000, Object.assign({}, p, { blockedAt: DAY }), [], {}) !== null, "thirty minutes later, one more try");
  const p3 = chargeBudget(chargeBudget(p, null, { errors: { plan: "x" } }), null, { errors: { plan: "x" } });
  eq(p3.blockN, 3, "three blocks");
  eq(retryAt(Object.assign({}, p3, { blockedAt: DAY })) - DAY, 120 * 60000, "the third wait is two hours");
  const ok1 = chargeBudget(p3, null, { errors: [], response: [] });
  eq(ok1.blocked, null, "a clean answer clears the block");
  const legacy = budgetFor({ day: utcDay(DAY), used: 1, remaining: 0, exhausted: true }, DAY);
  eq(legacy.exhausted, false, "a record filed as exhausted before reasons were recorded is re-opened");
  eq(legacy.remaining, DAILY_LIMIT - 1, "with its count intact");
}

console.log("\n7 · line-ups: two attempts and then stop asking");
{
  const r = runDay([fx("a", KO1)], { lineupsNeverPublish: true });
  eq(count(r.calls, "lineups"), 2, "a match whose line-up never appears costs exactly two calls");
}

console.log("\n7b · the door: RapidAPI when we have its key (shared Worker IPs are refused at API-Sports' own door), else direct, else inert");
{
  eq(afDoor({}), null, "no key, no door - the whole module is inert");
  eq(afDoor({ EGY_FEED: "off", AF_RELAY_URL: "https://x/exec", AF_RELAY_TOKEN: "t", APIFOOTBALL_KEY: "k" }), null, "EGY_FEED=off closes every door however many keys exist (parked 2026-09-02 by owner decision)");
  eq(afDoor({ APIFOOTBALL_KEY: "k" }), null, "the direct key alone opens nothing from a Worker (shared egress: refused unread, and repeated refusals get keys banned)");
  eq(afDoor({ APIFOOTBALL_KEY: "k", AF_DIRECT_OK: "1" }).via, "direct", "the direct door needs the explicit AF_DIRECT_OK var - for a deployment with its own IP");
  const r = afDoor({ APIFOOTBALL_KEY: "k", RAPIDAPI_KEY: "r" });
  eq(r.via, "rapidapi", "with both keys, RapidAPI wins over direct");
  const rl = afDoor({ APIFOOTBALL_KEY: "k", RAPIDAPI_KEY: "r", AF_RELAY_URL: "https://script.google.com/macros/s/x/exec", AF_RELAY_TOKEN: "t" });
  eq(rl.via, "relay", "and the relay wins over everything - RapidAPI no longer lists API-Sports at all (2026-09-02)");
  eq(afDoor({ AF_RELAY_URL: "https://x/exec" }), null, "a relay URL without its token opens nothing - the relay would refuse anyway");
  eq(r.base, "https://" + RAPID_HOST + "/v3", "same v3 paths behind RapidAPI's host");
  eq(r.headers["x-rapidapi-host"], RAPID_HOST, "RapidAPI needs the host header as well as the key");
  ok(!("x-apisports-key" in r.headers), "and the direct key is not sent to RapidAPI");
}

console.log("\n8 · the season and the day are named the provider's way");
{
  eq(seasonFor(Date.UTC(2026, 8, 5)), 2026, "September 2026 is season 2026");
  eq(seasonFor(Date.UTC(2027, 3, 5)), 2026, "April 2027 is still season 2026");
  eq(utcDay(Date.UTC(2026, 8, 5, 23, 59)), "2026-09-05", "a UTC day ends at 23:59 UTC - Egyptian evening matches never cross it");
}

console.log("\n9 · the adapter speaks ESPN");
{
  const af = { fixture: { id: 1234, date: "2026-09-05T14:00:00+00:00", status: { short: "2H", elapsed: 67 }, venue: { name: "Cairo Stadium", city: "Cairo" } },
    league: { id: 233, name: "Premier League", country: "Egypt", season: 2026, round: "Regular Season - 3" },
    teams: { home: { id: 1040, name: "Al Ahly", winner: null }, away: { id: 1041, name: "Zamalek SC", winner: null } },
    goals: { home: 2, away: 1 },
    events: [
      { time: { elapsed: 12, extra: null }, team: { id: 1040 }, player: { id: 1, name: "Emam Ashour" }, assist: { id: 2, name: "Trezeguet" }, type: "Goal", detail: "Normal Goal" },
      { time: { elapsed: 45, extra: 2 }, team: { id: 1041 }, player: { id: 3, name: "Zizo" }, assist: { id: null, name: null }, type: "Goal", detail: "Penalty" },
      { time: { elapsed: 50 }, team: { id: 1041 }, player: { id: 4, name: "Some Defender" }, assist: { id: null, name: null }, type: "Card", detail: "Red Card" },
      { time: { elapsed: 55 }, team: { id: 1040 }, player: { id: 5, name: "Own Goaler" }, assist: { id: null, name: null }, type: "Goal", detail: "Own Goal" },
      { time: { elapsed: 60 }, team: { id: 1040 }, player: { id: 6, name: "Taker" }, assist: { id: null, name: null }, type: "Goal", detail: "Missed Penalty" },
      /* API-Football documents `player` as the one coming OFF and `assist` as the one coming ON - re-verify on the first real match */
      { time: { elapsed: 61 }, team: { id: 1040 }, player: { id: 7, name: "Goes Off" }, assist: { id: 8, name: "Comes On" }, type: "subst", detail: "Substitution 1" }
    ] };
  const e = toEspnEvent(af, 1000);
  eq(e.id, "1234", "id is a string");
  eq(e.status.type.state, "in", "2H is in play");
  eq(e.status.displayClock, "67'", "the clock is the elapsed minute the provider gave, not a running one");
  eq(e.competitions[0].competitors[0].homeAway, "home", "home first");
  eq(e.competitions[0].competitors[0].score, "2", "scores are strings, like ESPN");
  eq(e.competitions[0].competitors[1].team.shortDisplayName, "Zamalek SC", "the provider's name travels as shortDisplayName - AR_TEAMS keys on it");
  const d = e.competitions[0].details;
  eq(d.filter(x => x.scoringPlay).length, 3, "three scoring plays: normal, penalty, own goal");
  eq(d.filter(x => x.scoringPlay && x.ownGoal).length, 1, "the own goal is flagged");
  eq(d.filter(x => x.scoringPlay && x.penaltyKick).length, 1, "the penalty is flagged");
  eq(d.filter(x => x.redCard).length, 1, "the red card is a red card");
  ok(!d.some(x => /missed/i.test(x.type.text) && x.scoringPlay), "a missed penalty is NOT a scoring play");
  eq(d[1].clock.displayValue, "45+2'", "stoppage time reads 45+2'");
  eq(e._gkSrc, "af", "stamped with its source");
  eq(e._gkLeagueId, "egy", "and its league id");

  const pre = toEspnEvent({ fixture: { id: 9, date: "2026-09-06T14:00:00+00:00", status: { short: "NS", elapsed: null } }, teams: { home: { id: 1, name: "Pyramids FC" }, away: { id: 2, name: "Al Masry" } }, goals: { home: null, away: null }, events: [] }, 1);
  eq(pre.status.type.state, "pre", "NS is pre");
  eq(pre.competitions[0].competitors[0].score, "", "no score before kick-off - not a fake 0");
  const pst = toEspnEvent({ fixture: { id: 9, date: "2026-09-06T14:00:00+00:00", status: { short: "PST", elapsed: null } }, teams: { home: { id: 1, name: "A" }, away: { id: 2, name: "B" } }, goals: {}, events: [] }, 1);
  eq(pst.status.type.name, "STATUS_POSTPONED", "PST maps to the name isVoided() recognises");
  const ht = toEspnEvent({ fixture: { id: 9, date: "2026-09-06T14:00:00+00:00", status: { short: "HT", elapsed: 45 } }, teams: { home: { id: 1, name: "A" }, away: { id: 2, name: "B" } }, goals: { home: 0, away: 0 }, events: [] }, 1);
  eq(ht.status.type.name, "STATUS_HALFTIME", "HT maps to the name isHT() recognises");

  const sum = toEspnSummary(af, [
    { team: { id: 1040, name: "Al Ahly" }, formation: "4-2-3-1", startXI: Array.from({ length: 11 }, (_, i) => ({ player: { id: 100 + i, name: "P" + i, number: i + 1, pos: i ? "M" : "G" } })), substitutes: [{ player: { id: 200, name: "Sub", number: 20, pos: "F" } }] },
    { team: { id: 1041, name: "Zamalek SC" }, formation: "4-3-3", startXI: Array.from({ length: 11 }, (_, i) => ({ player: { id: 300 + i, name: "Z" + i, number: i + 1, pos: "D" } })), substitutes: [] }
  ], 1000);
  eq(sum.rosters.length, 2, "two rosters");
  eq(sum.rosters[0].roster.filter(p => p.starter).length, 11, "eleven starters - hasFullXI will accept it");
  eq(sum.rosters[0].roster[0].position.abbreviation, "G", "the keeper's position starts with G - the penalty dedup finds him");
  eq(sum.rosters[0].roster.find(p => !p.starter).formationPlace, "0", "the bench carries formationPlace 0, as the shell expects");
  eq(sum.keyEvents.filter(k => k.type.type === "substitution").length, 1, "the substitution is a keyEvent");
  eq(sum.keyEvents.find(k => k.type.type === "substitution").participants[0].athlete.displayName, "Comes On", "player coming ON is participant 0");
  eq(sum.keyEvents.filter(k => k.type.type === "penalty - missed").length, 1, "the missed penalty is a keyEvent the timeline draws");

  const st = toEspnStandings([{ league: { id: 233, name: "Premier League", standings: [[
    { rank: 1, team: { id: 1040, name: "Al Ahly" }, points: 9, goalsDiff: 7, all: { played: 3, win: 3, draw: 0, lose: 0, goals: { for: 8, against: 1 } } },
    { rank: 2, team: { id: 1041, name: "Zamalek SC" }, points: 7, goalsDiff: 3, all: { played: 3, win: 2, draw: 1, lose: 0, goals: { for: 5, against: 2 } } }
  ]] } }], 1000);
  const rows = st.children[0].standings.entries;
  eq(rows.length, 2, "two table rows");
  eq(rows[0].stats.find(s => s.name === "points").value, 9, "points travel by name, like ESPN");
  eq(rows[0].stats.find(s => s.name === "pointDifferential").displayValue, "+7", "goal difference shows its sign");
}

console.log("\n" + "=".repeat(64));
console.log(fail ? "FAILED  " + fail + " of " + (pass + fail) : "PASSED  " + pass + " assertions, 0 failures");
console.log("=".repeat(64) + "\n");
process.exit(fail ? 1 : 0);
