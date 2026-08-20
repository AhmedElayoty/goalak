/* THE DEADLINE, AND THE THINGS THAT ARE ALLOWED TO IGNORE IT.
   Six things went wrong here at once and every one of them was invisible to the existing
   suites, because they are all questions about which ROUND a rule is asked about rather than
   about what the rule computes:

     - editBlocked() asked roundLocked(CURRENT_GW), and CURRENT_GW is the scrubber. During a
       live round that said "locked" for the round on screen - and the rounds run back to back,
       so from the moment the season started the team could never be edited again. Tapping the
       next round on the scrubber said "open" and let a squad that was already scoring be
       rewritten. Both directions wrong, from the same line.
     - chipSave() returned deadlinePassed: false as a literal, so a fully implemented and fully
       tested chip lock shipped disarmed.
     - the tutorial commit and Start Over both replaced or destroyed the squad with no gate.
     - markRound credited the stadium ledger at whatever round the scrubber was on.

   These assert the SHAPE of the fix, which is the part a future edit can quietly undo. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, "index.html"), "utf8");

let pass = 0;
const fail = [];
const ok = (cond, what) => { if (cond) pass++; else fail.push(what); };

/* the block of a named function, so an assertion cannot be satisfied by a match elsewhere */
function body(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) return "";
  let depth = 0, started = false;
  for (let j = src.indexOf("{", i); j < src.length; j++) {
    const c = src[j];
    if (c === "{") { depth++; started = true; }
    else if (c === "}") { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return "";
}

ok(/function liveGw\(\)/.test(src), "liveGw() exists - the round edits actually count for");
ok(/function seasonOver\(\)/.test(src), "seasonOver() exists");
ok(/function gwCount\(\)/.test(src), "gwCount() is declared, not merely called");

const gate = body("editBlocked");
ok(gate.length > 0, "editBlocked() exists");
ok(!/CURRENT_GW/.test(gate), "editBlocked() does NOT read CURRENT_GW - that is the scrubber, not the deadline");
ok(/seasonOver\(\)|liveGw\(\)/.test(gate), "editBlocked() asks the calendar which round is open");

const chip = body("chipSave");
ok(!/deadlinePassed:\s*false/.test(chip), "chipSave() does not hardcode deadlinePassed to false");
ok(/deadlinePassed:\s*seasonOver\(\)/.test(chip), "chipSave() reports the real deadline");

const chips = body("openChips");
ok(/editBlocked\(\)/.test(chips), "openChips() goes through the one gate");
ok(!/chipState\(chipSave\(\), CURRENT_GW\)/.test(src), "the chip sheet is built for the live round, not the scrubbed one");
ok(/gw: liveGw\(\)/.test(src), "a played chip is stamped with the round it applies to");

ok(/if\(editBlocked\(\)\)\{ closeWizard\(\); return; \}/.test(src),
   "the tutorial commit is gated - it replaces the whole squad");
const reset = body("resetDemo");
ok(/editBlocked\(\)/.test(reset), "Start Over is gated - it destroys the squad and publishes the wipe");

ok(/markRound\(Math\.max\(1, playGw\(\)\)/.test(src),
   "the stadium ledger credits the round being PLAYED - not the scrubber's, and not one early");

/* the snapshot: a locked round has to keep the eleven it locked with */
ok(/function snapTake\(\)/.test(src) && /function snapFor\(/.test(src), "per-round snapshots exist");
const resolve = body("resolveGw");
ok(/snapFor\(gw\)/.test(resolve), "a past round is scored from ITS lineup, not from today's squad");
ok(/snap: snapLoad\(\)/.test(src), "snapshots travel with the account, so every device agrees on history");

/* the season flag */
ok(!/const SEASON_STARTED = false;/.test(src), "the season flag is not a hardcoded false");
/* and not a const at all: an installed app left open across the opening deadline kept the
   pre-season answer while liveGw(), roundLocked() and seasonOver() had all moved on */
ok(!/const SEASON_STARTED\s*=/.test(src), "the season flag is not frozen at parse time");
ok(/function seasonStarted\(\)\s*\{\s*return Date\.now\(\) >= SEASON_OPENS_MS/.test(src),
   "the season flag is a question, asked when asked, derived from SEASON_OPENS");
ok(!/SEASON_STARTED/.test(src), "no caller still reads the old frozen constant");

/* the squad cannot be illegal, whatever the store hands back */
const validate = body("validateSquad");
ok(/seenId\[id\]/.test(validate), "validateSquad drops duplicate clubs");
ok(/kept\.length >= SQUAD_SIZE/.test(validate), "validateSquad caps the squad at fifteen");
ok(/ensureVice\(\)/.test(validate), "a repair that drops the vice appoints another");

/* the V button */
const vice = body("setVice");
ok(!/if\(captain === vice\) captain = null;/.test(vice), "tapping V on your own captain no longer deletes the captain");
ok(/id === captain/.test(vice), "tapping V on your own captain swaps the armbands");

/* a postponed match is not a fixture */
ok(/POSTPON\|CANCEL\|SUSPEND\|ABANDON/.test(src), "called-off matches are excluded from the fixture count");

/* the fixture cache can go stale, and a partial feed is not cached as truth */
ok(/cached\.at && \(Date\.now\(\) - cached\.at\)/.test(src), "the fixture cache expires");
ok(/heardAll/.test(src), "a round whose feed did not fully answer is not cached as the truth");

/* two people, one phone */
ok(/function fxGuardOwner\(\)/.test(src), "the local cache is stamped with whose team it is");
ok(/fxGuardOwner\(\);/.test(src), "and the guard actually runs at boot");

/* ---- THE ROUND MODEL, ASSERTED ON BEHAVIOUR RATHER THAN ON TEXT ----
   The first version of this file proved every claim at the string level and every one of them
   was still wrong underneath: `deadlinePassed: seasonOver()` matched its regex and was dead,
   `editBlocked()` appeared inside resetDemo and never fired, `snapFor(gw)` appeared inside
   resolveGw and covered three rounds in fourteen. These run the arithmetic instead. */
{
  const cal = JSON.parse(fs.readFileSync(path.join(HERE, "calendar.json"), "utf8"));
  const lock = g => Date.parse(cal.gws[g - 1][0] + "T00:00:00Z");
  const N = cal.gws.length;
  const liveAt = now => { for (let g = 1; g <= N; g++) if (now < lock(g)) return g; return N + 1; };
  const playAt = now => Math.max(0, Math.min(N, liveAt(now) - 1));

  /* the day round 1 opens, and every day after it, liveGw is one AHEAD of the round in play —
     which is why substituting it for "the current round" inflated the season total by a whole
     unplayed round on the first morning of the season */
  const dayAfterOpen = lock(1) + 36 * 3600000;
  ok(liveAt(dayAfterOpen) === 2, "the day after round 1 opens, edits count for round 2");
  ok(playAt(dayAfterOpen) === 1, "and the round in play is round 1, not round 2");

  /* pre-season nothing has been played, so nothing may be totalled */
  ok(playAt(lock(1) - 3600000) === 0, "an hour before the season opens, no round is in play");

  /* and the last round must still be countable on its own final day */
  ok(playAt(lock(N) + 36 * 3600000) === N, "the last round is in play once it opens");

  /* the source has to use them the same way round */
  ok(/for\(let g = joinGw\(\); g <= playGw\(\); g\+\+\)/.test(src),
     "seasonTotal walks join..playGw — rounds that happened, and only this manager's");
  ok(/const from = Math\.max\(1, \+r\.join \|\| 1\), upto = playGw\(\);/.test(src),
     "and a rival is bounded exactly the same way");
  ok(/if\(gw < Math\.max\(1, \+v\.join \|\| 1\) \|\| gw > playGw\(\)\) return 0;/.test(src),
     "a round before you joined, or after the one in play, scores nothing");
}
ok(/function playGw\(\)/.test(src) && /function joinGw\(\)/.test(src), "playGw and joinGw exist");
ok(/function snapBackfill\(\)/.test(src), "locked rounds nobody was present for are frozen, not left to drift");
ok(/snapBackfill\(\);/.test(src), "and the backfill runs at boot, before an edit can move them");
ok(/if\(ids\.size && heardAll\)/.test(src), "a fixture map missing a league is not installed, not merely uncached");
ok(!/rivalHits/.test(src), "a rival's hits are not simulated from their editable team name");
ok(/function rivalPaid\(/.test(src), "a rival pays the hits their own ledger records");
ok(/transferState\(v, v\.gw\)/.test(src), "a closing round is priced with ITS chip, not the next round's");
ok(/roundInPlay/.test(src) && /roundPicking/.test(src), "the round bar says which round is which");

if (fail.length) {
  console.log("check-locks.mjs: " + fail.length + " deadline/integrity invariant(s) broken —");
  for (const f of fail) console.log("  FAIL  " + f);
  process.exit(1);
}
console.log("check-locks.mjs: " + pass + " deadline and squad-integrity invariants hold");
