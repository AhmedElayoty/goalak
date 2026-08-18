/* Does index.html parse, and does everything it references exist?
 *
 * Run by .git/hooks/pre-commit, which REFUSES the commit on failure. It is wired that way
 * because the soft version of this check already failed once in the way that matters: it
 * printed SYNTAX ERROR beside a commit that went through anyway, and the deployed demo was
 * a blank page until someone read the right line of output.
 *
 * Run directly:  node check.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const s = fs.readFileSync(path.join(HERE, "index.html"), "utf8");
const fail = [];

/* 1. the page's own script must parse */
const blocks = (s.match(/<script>([\s\S]*?)<\/script>/g) || []).map(b => b.slice(8, -9));
for (const b of blocks) {
  if (!b.trim()) continue;
  try { new Function(b); } catch (e) { fail.push("index.html does not parse: " + e.message); }
}
const body = blocks.join("\n");

/* 2. the shipped bundle must parse too — it is generated, and a bad strip breaks it silently */
const modPath = path.join(HERE, "modules.js");
if (fs.existsSync(modPath)) {
  try { new Function(fs.readFileSync(modPath, "utf8")); }
  catch (e) { fail.push("modules.js does not parse: " + e.message); }
}

/* 3. every onclick target must exist — the pitch is built as strings, so a renamed
      function is invisible until a user taps it */
const called = new Set();
for (const m of s.matchAll(/onclick\s*=\s*["'][^"']*?([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[1]);
for (const m of body.matchAll(/onclick="([A-Za-z_$][\w$]*)\(/g)) called.add(m[1]);
const defined = new Set();
for (const m of body.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
for (const m of body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
const missingFns = [...called].filter(x => !defined.has(x) && !["window", "document"].includes(x));
if (missingFns.length) fail.push("onclick targets not defined: " + missingFns.join(", "));

/* 4. every t() key must exist, or the UI renders the key name at the user */
const keys = new Set([...body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\[/g)].map(m => m[1]));
const usedKeys = new Set([...body.matchAll(/\bt\(\s*["']([A-Za-z_$][\w$]*)["']/g)].map(m => m[1]));
const missingKeys = [...usedKeys].filter(k => !keys.has(k) && !/^tier$/.test(k));
if (missingKeys.length) fail.push("t() keys missing from STR: " + missingKeys.join(", "));

/* 5. the data files must be valid JSON and carry what the app reads */
for (const [f, need] of [["clubs.json", ["clubs", "leagues"]], ["prices.json", ["clubs"]],
                         ["calendar.json", ["gws"]]]) {
  const p = path.join(HERE, f);
  if (!fs.existsSync(p)) { fail.push(f + " is missing"); continue; }
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const k of need) if (!j[k]) fail.push(f + " has no `" + k + "`");
  } catch (e) { fail.push(f + " is not valid JSON: " + e.message); }
}

/* 6. every club must have a price and a calibrated strength, or it scores as an average one */
try {
  const clubs = JSON.parse(fs.readFileSync(path.join(HERE, "clubs.json"), "utf8")).clubs;
  const prices = JSON.parse(fs.readFileSync(path.join(HERE, "prices.json"), "utf8")).clubs;
  const byId = new Map(prices.map(p => [String(p.id), p]));
  const noPrice = clubs.filter(c => !byId.has(String(c.id))).map(c => c.code);
  const noStr = prices.filter(p => typeof p.str !== "number").length;
  if (noPrice.length) fail.push("clubs with no price: " + noPrice.join(", "));
  if (noStr) fail.push(noStr + " clubs have no calibrated `str` — run scripts/build-strength.mjs");
} catch (_) { /* already reported above */ }

/* 7. NEVER AGAIN: a 3D transform on the row stack.
      translateZ/rotateX inside a perspective context made every card in the affected rows
      completely untappable — elementFromPoint returned nothing anywhere on them — and it
      shipped because the checks measured geometry and contrast, neither of which notices
      that a control has stopped existing. Depth on the pitch is a 2D scale. */
const css = s.slice(s.indexOf("<style>"), s.indexOf("</style>"));
const rowRule = (css.match(/\.st__row\{[^}]*\}/) || [""])[0];
if (/translateZ|rotateX|rotate3d|matrix3d/.test(rowRule))
  fail.push(".st__row uses a 3D transform — that makes every card in the row untappable");
if (/\.st__cards\{[^}]*(perspective|preserve-3d)/.test(css))
  fail.push(".st__cards declares a perspective/preserve-3d context — cards inside stop hit-testing");

/* 8. AN ID THE SCRIPT USES MUST EXIST IN THE MARKUP.
      Three times in one session an edit script raised before its final write, so the code
      that REFERENCED a new element landed while the element itself did not - and because the
      reference sat inside a try/catch, the page carried on and the feature was simply absent.
      $("x") with no id="x" is now a refused commit, not a silent nothing. */
const idsUsed = new Set([...body.matchAll(/\$\("([A-Za-z][\w-]*)"\)/g)].map(m => m[1]));
const idsInMarkup = new Set([...s.matchAll(/id="([A-Za-z][\w-]*)"/g)].map(m => m[1]));
const created = new Set([...body.matchAll(/\.id\s*=\s*"([A-Za-z][\w-]*)"/g)].map(m => m[1]));
const orphan = [...idsUsed].filter(id => !idsInMarkup.has(id) && !created.has(id));
if (orphan.length) fail.push("the script reads ids that no element has: " + orphan.join(", "));

/* 9. NO DUPLICATE ids. An edit that adds a replacement element without removing the old one
      leaves two, and getElementById silently returns the first - so the code updates the
      wrong node and the visible one never changes. That is exactly how a back control ended
      up present twice, one of them invisible. */
const idCounts = {};
for (const m of s.matchAll(/id="([A-Za-z][\w-]*)"/g)) idCounts[m[1]] = (idCounts[m[1]] || 0) + 1;
const dupes = Object.keys(idCounts).filter(k => idCounts[k] > 1);
if (dupes.length) fail.push("duplicate ids in the markup: " + dupes.join(", "));

/* 10. THE FIXTURE SLUGS MUST BE GATHERED WHEN THE FETCH RUNS, NOT WHEN THE FILE PARSES.
      A `const` built from LEAGUES at parse time evaluates to [] - clubs.json fills LEAGUES in
      afterwards - so every league match disappears while the code reads perfectly. Round 1
      came back with 42 of 126 clubs playing. No static check could see it; only the live feed
      could. This one can at least stop the shape coming back.
      (The competition sweep that briefly lived here is gone on the owner's instruction:
      league matches only, no Europe, no cups.) */
if (/const FIXT_SLUGS\s*=\s*\(LEAGUES/.test(body))
  fail.push("the fixture slug list reads LEAGUES at parse time — it is empty then, and every league match disappears");
if (!/function fixtSlugs\(\)/.test(body))
  fail.push("fixtSlugs() is gone — the league feeds are no longer gathered at call time");
for (const gone of ["uefa.champions", "uefa.europa", "eng.fa", "esp.copa_del_rey",
                    "ger.dfb_pokal", "ita.coppa_italia", "fra.coupe_de_france", "sco.cis"])
  if (body.includes('"' + gone + '"'))
    fail.push("the fixture feed asks for " + gone + " — the owner's rule is league matches only");

/* 11. THE TRANSFER ECONOMY MUST STILL BE THERE AND STILL BE WIRED.
      It is the only rule that can take points off a manager. Present-but-unwired is the worse
      failure of the two: the charge shows on screen and never reaches the score, or reaches
      the score and is never shown. Both halves are checked. */
if (!/const FT_MAX = \d+, HIT_COST = \d+;/.test(body)) fail.push("the transfer economy is gone from index.html");
/* COUNT THE CALL SITES, DO NOT JUST FIND THE NAME. The first version of this check passed a
   mutation that deleted the only call, because `function transferHtml(){` contains the very
   string it was looking for. A helper that exists and is never invoked is exactly the bug. */
const count = (hay, needle) => hay.split(needle).length - 1;
for (const fn of ["transferCost", "transferHtml"]) {
  const total = count(body, fn + "()");
  const defs  = count(body, "function " + fn + "()");
  if (total - defs < 1)
    fail.push(fn + "() is defined but never called — "
      + (fn === "transferCost" ? "the hit never reaches the score"
                               : "the manager never sees what a change costs"));
}
if (!body.includes('t("ftRule")')) fail.push("the rules screen no longer explains transfers");

if (fail.length) { fail.forEach(f => console.log("  FAIL  " + f)); process.exit(1); }
console.log("check.mjs: index.html parses, " + called.size + " handlers and "
  + usedKeys.size + " strings resolve, data files intact");
