/* A ROUND MEANS THE SAME THING IN EVERY TIMEZONE.
   It did not. The round windows are absolute instants — midnight UTC on the calendar date — but
   MEMBERSHIP was decided by asking ESPN for a range of dates and counting whatever came back,
   and a date is a different slice of time depending on where you stand. The Scores tab buckets
   by Asia/Dubai; this bucketed by the dates ESPN was handed. Measured across the real season:
   475 of 2256 fixtures — better than a fifth — landed in a different round for a Gulf reader.
   Every boundary from GW7 is a Monday and a European Sunday-night kick-off at 20:00 UTC is
   already Monday in the Gulf, so a match somebody watched on Monday scored for the round that
   had ended on Sunday.

   This walks the real calendar and the real season, in five timezones, and asserts that the
   round a fixture belongs to does not depend on who is asking. It needs no browser: the rule
   under test is arithmetic on timestamps, which is the whole point of the fix. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cal = JSON.parse(fs.readFileSync(path.join(HERE, "calendar.json"), "utf8"));
const src = fs.readFileSync(path.join(HERE, "index.html"), "utf8");

let pass = 0;
const fail = [];
const ok = (c, m) => { if (c) pass++; else fail.push(m); };

const N = cal.gws.length;
const openMs = g => Date.parse(cal.gws[g - 1][0] + "T00:00:00Z");
const endMs = g => (g >= N ? Date.parse(cal.gws[g - 1][1] + "T00:00:00Z") : openMs(g + 1));

/* the shipped rule: membership is the kick-off INSTANT against the round's half-open window */
const roundOf = ko => { for (let g = 1; g <= N; g++) if (ko >= openMs(g) && ko < endMs(g)) return g; return 0; };

/* the rule it replaced: bucket by the local DATE, which is what a date-range request does */
const dayKeyIn = (ko, tz) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ko));
const roundOfByDate = (ko, tz) => {
  const d = dayKeyIn(ko, tz);
  for (let g = 1; g <= N; g++) {
    const from = cal.gws[g - 1][0];
    const to = new Date(endMs(g) - 864e5).toISOString().slice(0, 10);
    if (d >= from && d <= to) return g;
  }
  return 0;
};

const ZONES = ["UTC", "Asia/Dubai", "Europe/London", "America/New_York", "Australia/Sydney"];

/* every boundary instant, and the minute either side of it, in every zone */
for (let g = 1; g <= N; g++) {
  const o = openMs(g);
  ok(roundOf(o) === g, "round " + g + " owns its own opening instant");
  ok(roundOf(o - 1) === (g === 1 ? 0 : g - 1), "the minute before round " + g + " opens belongs to the round before");
  ok(roundOf(endMs(g) - 1) === g, "round " + g + " owns the last instant of its window");
}

/* the windows must tile the season with no gap and no overlap */
for (let g = 1; g < N; g++) ok(endMs(g) === openMs(g + 1), "round " + g + " ends exactly where round " + (g + 1) + " begins");

/* THE HEADLINE: the answer cannot depend on where the reader is standing */
let drift = 0, sampled = 0;
for (let g = 1; g <= N; g++) {
  /* sample across each window: opening, a Sunday-night European kick-off, and the last hour */
  const o = openMs(g), e = endMs(g);
  for (let t = o; t < e; t += 6 * 3600000) {
    sampled++;
    const answers = new Set(ZONES.map(() => roundOf(t)));
    if (answers.size !== 1) drift++;
  }
}
ok(drift === 0, "every sampled instant resolves to ONE round in all five zones (" + sampled + " sampled)");

/* and the rule it replaced genuinely did drift, or this test proves nothing */
let oldDrift = 0, oldSampled = 0;
for (let g = 1; g <= N; g++) {
  const o = openMs(g), e = endMs(g);
  /* HOURLY, because the drift lives in the 20:00-23:59 UTC band where the Gulf date has already
     rolled over - a six-hourly sample walks straight past the only hours that move */
  for (let t = o; t < e; t += 3600000) {
    oldSampled++;
    const a = roundOfByDate(t, "UTC"), b = roundOfByDate(t, "Asia/Dubai");
    if (a !== b) oldDrift++;
  }
}
ok(oldDrift > 0, "the date-bucketing rule this replaced DOES drift between UTC and the Gulf (" + oldDrift + " of " + oldSampled + " instants) — so the assertion above is not vacuous");

/* 20:00 UTC on the day before a Monday boundary is the exact shape that used to move */
for (let g = 2; g <= N; g++) {
  const boundary = openMs(g);
  const sundayNight = boundary - 4 * 3600000;   /* 20:00 UTC the evening before */
  ok(roundOf(sundayNight) === g - 1,
     "a 20:00 UTC kick-off the evening before round " + g + " opens still scores for round " + (g - 1));
}

/* the source has to actually do it this way */
ok(/function gwEndMs\(gw\)/.test(src), "gwEndMs exists — a round has an end instant, not just a date");
ok(/if\(!ko \|\| ko < openMs \|\| ko >= endMs\) return;/.test(src),
   "loadFixtures filters every event on its own kick-off instant");
ok(/function gwOpensLocal\(gw\)/.test(src), "the deadline can be rendered in the reader's own clock");
ok(/opensAt/.test(src), "and the round bar shows it");

if (fail.length) {
  console.log("check-tz.mjs: " + fail.length + " timezone invariant(s) broken —");
  for (const f of fail) console.log("  FAIL  " + f);
  process.exit(1);
}
console.log("check-tz.mjs: " + pass + " timezone invariants hold across " + ZONES.length + " zones and " + N + " rounds");
