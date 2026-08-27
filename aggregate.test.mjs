/* THE TWO-LEGGED TIE, TESTED AGAINST THE SHIPPED SOURCE.
 *
 * An aggregate is the number that decides who goes through, and this app spent its whole life
 * showing it only after full time and only on one surface. The version that replaced it does
 * arithmetic on two different matches, so it can be wrong in ways a scoreline cannot: it can
 * add the wrong leg, add a leg to itself, credit the away goals to the home club, or - worst -
 * invent an aggregate for two clubs who merely met twice in a league phase and never played a
 * tie at all.
 *
 * None of that is visible in a screenshot of a match that happens to look right, so the logic
 * is lifted out of the shipped index.html and run against synthetic ties. Same reason
 * transfers.test.mjs lifts the transfer block: a copy of the logic would prove nothing.
 *
 * The three helpers it leans on - evState, statusName, voidedKey - are lifted too, by name.
 * slugForEvent is STUBBED, and deliberately: which competition an event belongs to is an
 * input to this logic, not part of it.
 *
 *   node aggregate.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(HERE, "index.html"), "utf8");

const from = HTML.indexOf("const legIdx = {}");
const to = HTML.indexOf("/* the fantasy build already knows all 126");
if (from < 0 || to < 0 || to < from) {
  console.log("FAIL  cannot find the two-legged block in index.html");
  process.exit(1);
}
const SRC = HTML.slice(from, to);

/* lift a named function whole, by matching its braces - the same shape check-sync.mjs uses */
function liftFn(name) {
  const i = HTML.indexOf("function " + name + "(");
  if (i < 0) { console.log("FAIL  cannot find " + name + "() in index.html"); process.exit(1); }
  let depth = 0;
  for (let k = HTML.indexOf("{", i); k < HTML.length; k++) {
    if (HTML[k] === "{") depth++;
    else if (HTML[k] === "}") { depth--; if (!depth) return HTML.slice(i, k + 1); }
  }
  console.log("FAIL  " + name + "() has unbalanced braces");
  process.exit(1);
}
const DEPS = ["statusName", "evState", "voidedKey"].map(liftFn).join("\n");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL  " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", wanted " + JSON.stringify(b) + ")");

/* a fresh world per case: legIdx is module state in the shipped file, so it must not leak */
function world(lang) {
  const ctx = {
    LANG: lang || "en",
    /* the slug is an input: the shipped slugForEvent reads _gkCompetition/_gkLeagueId, which
       is the fetchers' business, not this block's */
    slugForEvent: e => (e && e._gkSlug) || "",
    String, Number, Date, Object, Math, isFinite, JSON, Array
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(DEPS, ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

/* ESPN's shape, only the fields this logic reads */
function ev(o) {
  const c = h => ({
    homeAway: h ? "home" : "away",
    score: String(h ? o.hs : o.as),
    team: { id: String(h ? o.hid : o.aid) },
    aggregateScore: h ? o.hagg : o.aagg
  });
  return {
    id: String(o.id),
    date: o.date,
    _gkQual: o.qual ? 1 : 0,
    _gkSlug: o.slug || "uefa.europa_qual",
    status: { type: { state: o.state || "post", name: o.name || "STATUS_FULL_TIME" } },
    competitions: [{
      notes: o.notes ? [{ headline: o.notes }] : [],
      competitors: [c(true), c(false)]
    }]
  };
}
const sides = e => {
  const cs = e.competitions[0].competitors;
  return [cs.find(x => x.homeAway === "home"), cs.find(x => x.homeAway === "away")];
};
/* index one event as a first leg, then ask for the aggregate of another */
function agg(w, legs, second) {
  w.legIndexEvents(second._gkSlug, legs);
  const [H, A] = sides(second);
  return w.aggTxt(second, H, A);
}

/* TRA = 100, FER = 200. First leg at Ferencvaros, second leg at Trabzonspor. */
const LEG1 = o => ev(Object.assign({ id: 1, date: "2026-08-20T18:45Z", hid: 200, aid: 100, qual: 1 }, o));
const LEG2 = o => ev(Object.assign({ id: 2, date: "2026-08-27T18:45Z", hid: 100, aid: 200, qual: 1 }, o));

console.log("\n1 · the aggregate is computed across the two legs, per club");
{
  /* leg 1: Ferencvaros 2 Trabzonspor 1. leg 2: Trabzonspor 3 Ferencvaros 0.
     Trabzonspor 1+3 = 4, Ferencvaros 2+0 = 2. The home/away swap is the whole trick. */
  const w = world();
  eq(agg(w, [LEG1({ hs: 2, as: 1 })], LEG2({ hs: 3, as: 0 })), "4 - 2",
    "home club's away goals from leg 1 are added to its home goals in leg 2");
}
{
  const w = world();
  eq(agg(w, [LEG1({ hs: 0, as: 2 })], LEG2({ hs: 0, as: 1 })), "2 - 1",
    "and the away club's aggregate is its own two legs, not the home club's");
}
{
  /* LIVE, which is the case that showed nothing at all before */
  const w = world();
  eq(agg(w, [LEG1({ hs: 2, as: 1 })], LEG2({ hs: 1, as: 0, state: "in", name: "STATUS_IN_PROGRESS" })), "2 - 2",
    "a live second leg carries a running aggregate");
}
{
  /* half-time of the second leg: still live, still correct */
  const w = world();
  eq(agg(w, [LEG1({ hs: 1, as: 1 })], LEG2({ hs: 0, as: 0, state: "in", name: "STATUS_HALFTIME" })), "1 - 1",
    "0-0 at half-time of the second leg still reports the tie");
}

console.log("\n2 · a 0-0 first leg is still worth saying");
{
  /* the old rule suppressed any aggregate equal to the scoreline, which erased exactly this */
  const w = world();
  eq(agg(w, [LEG1({ hs: 0, as: 0 })], LEG2({ hs: 2, as: 1 })), "2 - 1",
    "a computed aggregate is shown even when it equals this leg's score");
}

console.log("\n3 · the false positive, which would invent a result");
{
  /* two clubs meeting twice in a league phase is NOT a tie: no aggregateScore, no leg note,
     not a qualifier. Printing an aggregate here would be a fabricated scoreline. */
  const w = world();
  const l1 = ev({ id: 1, date: "2026-08-20T18:45Z", hid: 200, aid: 100, hs: 2, as: 1, slug: "uefa.champions" });
  const l2 = ev({ id: 2, date: "2026-08-27T18:45Z", hid: 100, aid: 200, hs: 3, as: 0, slug: "uefa.champions" });
  eq(agg(w, [l1], l2), "", "a league-phase rematch reports no aggregate");
}
{
  /* ... but the same rematch DOES report one once the feed itself calls it a tie */
  const w = world();
  const l1 = ev({ id: 1, date: "2026-08-20T18:45Z", hid: 200, aid: 100, hs: 2, as: 1, slug: "uefa.champions" });
  const l2 = ev({ id: 2, date: "2026-08-27T18:45Z", hid: 100, aid: 200, hs: 3, as: 0, slug: "uefa.champions",
    hagg: 4, aagg: 2 });
  eq(agg(w, [l1], l2), "4 - 2", "the feed's own aggregateScore is signal enough");
}
{
  /* and when the round names itself, which is how a knockout second leg identifies itself */
  const w = world();
  const l1 = ev({ id: 1, date: "2026-08-20T18:45Z", hid: 200, aid: 100, hs: 1, as: 1, slug: "uefa.champions" });
  const l2 = ev({ id: 2, date: "2026-08-27T18:45Z", hid: 100, aid: 200, hs: 2, as: 0, slug: "uefa.champions",
    notes: "UEFA Champions League - Round of 16 - Leg 2 of 2" });
  eq(agg(w, [l1], l2), "3 - 1", "a 'Leg 2 of 2' note marks a tie on its own");
}

console.log("\n4 · the first leg itself has nothing to add");
{
  /* the feed sets aggregateScore equal to the score on a first leg; that is not information */
  const w = world();
  const l1 = LEG1({ hs: 2, as: 1, hagg: 2, aagg: 1 });
  const [H, A] = sides(l1);
  eq(w.aggTxt(l1, H, A), "", "a first leg does not print its own scoreline twice");
}

console.log("\n5 · which meeting counts as the first leg");
{
  /* a LATER fixture is not a first leg, however tempting the arithmetic */
  const w = world();
  const later = ev({ id: 3, date: "2026-09-03T18:45Z", hid: 200, aid: 100, hs: 5, as: 5, qual: 1 });
  eq(agg(w, [later], LEG2({ hs: 1, as: 0 })), "", "a fixture after this one is ignored");
}
{
  /* three meetings: the most recent one BEFORE this match is the leg that counts */
  const w = world();
  const old = ev({ id: 9, date: "2026-08-06T18:45Z", hid: 200, aid: 100, hs: 9, as: 9, qual: 1 });
  eq(agg(w, [old, LEG1({ hs: 2, as: 1 })], LEG2({ hs: 3, as: 0 })), "4 - 2",
    "the nearest earlier meeting wins, not the oldest");
}
{
  /* a match can never be its own first leg, even if it somehow reaches the index */
  const w = world();
  const l2 = LEG2({ hs: 3, as: 0 });
  w.legIndexEvents(l2._gkSlug, [l2]);
  const [H, A] = sides(l2);
  eq(w.aggTxt(l2, H, A), "", "a match is never aggregated with itself");
}
{
  /* THE ID GUARD, and what it is actually for. The timestamp check alone stops a match being
     its own first leg only while the two dates agree - but ESPN moves kick-off times, so the
     same event id can already sit in the index under an EARLIER date. Without the id check
     that stale copy of itself becomes its own first leg and the score is doubled. */
  const w = world();
  const stale = LEG2({ hs: 3, as: 0 });
  stale.date = "2026-08-20T18:45Z";              /* same id 2, the kick-off it was first listed at */
  w.legIndexEvents(stale._gkSlug, [stale]);
  const l2 = LEG2({ hs: 3, as: 0 });             /* id 2 again, rescheduled a week later */
  const [H, A] = sides(l2);
  eq(w.aggTxt(l2, H, A), "", "a rescheduled match is not its own first leg");
}
{
  /* an unfinished earlier meeting has no score to carry */
  const w = world();
  const unplayed = LEG1({ hs: 0, as: 0, state: "pre", name: "STATUS_SCHEDULED" });
  eq(agg(w, [unplayed], LEG2({ hs: 1, as: 0 })), "", "a first leg that has not been played is not indexed");
}
{
  /* nor an abandoned one - its partial score is not a result */
  const w = world();
  const dead = LEG1({ hs: 1, as: 0, name: "STATUS_ABANDONED" });
  eq(agg(w, [dead], LEG2({ hs: 1, as: 0 })), "", "an abandoned first leg is not indexed");
}
{
  /* a different competition is a different tie */
  const w = world();
  const other = ev({ id: 1, date: "2026-08-20T18:45Z", hid: 200, aid: 100, hs: 2, as: 1, qual: 1, slug: "uefa.champions_qual" });
  const w2 = world();
  w2.legIndexEvents("uefa.champions_qual", [other]);
  const l2 = LEG2({ hs: 3, as: 0 });
  const [H, A] = sides(l2);
  eq(w2.aggTxt(l2, H, A), "", "a meeting in another competition is not this tie's first leg");
}

console.log("\n6 · the fallback, which is what shipped before this");
{
  /* a tie whose first leg we never fetched still reports the feed's own aggregate */
  const w = world();
  const l2 = LEG2({ hs: 1, as: 0, hagg: 3, aagg: 2 });
  const [H, A] = sides(l2);
  eq(w.aggTxt(l2, H, A), "3 - 2", "with no first leg in hand the feed's aggregateScore is used");
}
{
  /* and a tie with neither says nothing rather than guessing */
  const w = world();
  const l2 = LEG2({ hs: 1, as: 0 });
  const [H, A] = sides(l2);
  eq(w.aggTxt(l2, H, A), "", "no first leg and no feed aggregate prints nothing");
}

console.log("\n7 · the Arabic interface reads the pair the other way");
{
  const w = world("ar");
  eq(agg(w, [LEG1({ hs: 2, as: 1 })], LEG2({ hs: 3, as: 0 })), "2 - 4",
    "right-to-left puts the away club's aggregate first");
}

console.log("\n" + "=".repeat(64));
console.log(fail ? "FAILED  " + fail + " of " + (pass + fail)
                 : "PASSED  " + pass + " assertions, 0 failures");
console.log("=".repeat(64) + "\n");
process.exit(fail ? 1 : 0);
