/* The edge proxy's freshness rule, tested against the SHIPPED worker source.
   This exists because the rule it guards cannot be observed on demand: proving the
   15-second window by hand needs a match that is actually being played, and the night it
   was written the whole world was between fixtures. The functions are lifted out of
   src/index.js rather than copied, so a future edit to the real file fails here instead
   of quietly restoring the 45-second lag on live scores. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, "src", "index.js"), "utf8");

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; } else { fail++; console.log("  FAIL: " + what); } };

/* ---- lift the two pure functions out of the shipped file ---- */
function lift(name) {
  const m = src.match(new RegExp("function " + name + "\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}", "m"));
  if (!m) throw new Error("could not find " + name + " in src/index.js");
  return m[0];
}
const ttlConst = src.match(/const ESPN_LIVE_TTL = (\d+);/);
ok(!!ttlConst, "ESPN_LIVE_TTL is declared in the worker");
const LIVE_TTL = ttlConst ? Number(ttlConst[1]) : null;
const { espnProxyTtl, espnBodyLive } = new Function(
  lift("espnProxyTtl") + "\n" + lift("espnBodyLive") + "\nreturn { espnProxyTtl, espnBodyLive };"
)();

/* ---- base TTLs by path ---- */
ok(espnProxyTtl("apis/site/v2/sports/soccer/eng.1/scoreboard") === 45, "a bare scoreboard is 45s");
ok(espnProxyTtl("apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260827") === 45, "a dated scoreboard is 45s");
ok(espnProxyTtl("apis/site/v2/sports/soccer/eng.1/summary?event=1") === 45, "a summary is 45s");
ok(espnProxyTtl("apis/site/v2/sports/soccer/eng.1/standings") === 300, "standings are 300s");
ok(espnProxyTtl("apis/site/v2/sports/soccer/eng.1/teams/83/schedule") === 3600, "a team schedule is 3600s");

/* ---- the live detector, against ESPN's real compact serialisation ---- */
ok(espnBodyLive('{"status":{"type":{"name":"STATUS_FIRST_HALF","state":"in","completed":false}}}'),
   "a match in play is detected");
ok(!espnBodyLive('{"status":{"type":{"name":"STATUS_FULL_TIME","state":"post","completed":true}}}'),
   "a finished match is not live");
ok(!espnBodyLive('{"status":{"type":{"name":"STATUS_SCHEDULED","state":"pre","completed":false}}}'),
   "a scheduled match is not live");
ok(espnBodyLive('{"events":[{"state":"post"},{"state":"in"}]}'),
   "one live match among finished ones still shortens the window");
ok(!espnBodyLive(""), "an empty body is not live");
ok(!espnBodyLive(null), "a missing body is not live");
/* the detector is a substring scan, so the exact spacing ESPN emits is part of the contract */
ok(!espnBodyLive('{"state": "in"}'), "spaced JSON is not what ESPN emits — documented, not supported");

/* ---- the rule itself, as written inline in espnProxy ---- */
const proxy = src.match(/async function espnProxy[\s\S]*?\n\}/)[0];
ok(/const ttlFor = live => \(live && base === 45 \? ESPN_LIVE_TTL : base\) \* 1000;/.test(proxy),
   "the live window applies ONLY where the base is 45 — standings and schedules keep theirs");
ok(/const wasLive = hit\.headers\.get\("x-gk-live"\) === "1";/.test(proxy),
   "the freshness check reads liveness back off the cached copy, not off the path");
ok(/now - ts < ttlFor\(wasLive\)/.test(proxy),
   "the cached copy's own liveness decides how long it may be served");
ok(/"x-gk-live": live \? "1" : "0",/.test(proxy),
   "the cache write records what the body contained");
ok(LIVE_TTL === 15, "the live window is 15 seconds — inside the client's 25-second repaint");
ok(LIVE_TTL < 45, "the live window is shorter than the idle one, or it is not a window at all");

/* ---- the reason the whole thing exists ---- */
ok(LIVE_TTL + 25 < 45 + 25, "a goal now reaches the phone in under a repaint-plus-window, not ~70s");

console.log("=".repeat(64));
console.log(fail ? `FAILED  ${fail} of ${pass + fail}` : `PASSED  ${pass} assertions, 0 failures`);
console.log("=".repeat(64));
process.exit(fail ? 1 : 0);
