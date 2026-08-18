/* WHAT DOES THE FANTASY TAB ACTUALLY SAY?
 *
 * The release gate was deleted and the tab still read "Soon…", because paintFantasyGate was
 * one of FOUR places writing that line and the other three hard-wrote t("soon"). The static
 * guard in check-release.mjs stops a second writer coming back. This runs the real function
 * against the real string table and asserts what a user would read — because "no other writer
 * exists" and "the right words appear" are two different claims, and only the second one is
 * the thing the owner opened the app and did not see.
 *
 * No browser: the function and the string table are lifted out of the shipped index.html and
 * run against a stub DOM, the same way transfers.test.mjs does it. If somebody edits
 * index.html, this moves with it.
 *
 *   node check-fantasy-tab.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(HERE, "index.html"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL  " + m); } };

/* the string table, verbatim from the shipped file */
const strStart = HTML.indexOf("const STR = {");
const strEnd = HTML.indexOf("\n};", strStart) + 3;
if (strStart < 0 || strEnd < 3) { console.log("  FAIL  cannot find STR in index.html"); process.exit(1); }
const STR_SRC = HTML.slice(strStart, strEnd);

/* and the function under test */
const fnStart = HTML.indexOf("function paintFantasyGate(){");
const fnEnd = HTML.indexOf("\n}", fnStart) + 2;
if (fnStart < 0) { console.log("  FAIL  paintFantasyGate() is not in index.html"); process.exit(1); }
const FN_SRC = HTML.slice(fnStart, fnEnd);

function run(lang) {
  const els = {
    fantCta:  { textContent: "", classList: { _s: new Set(["hide"]),
      remove(c) { this._s.delete(c); }, add(c) { this._s.add(c); },
      contains(c) { return this._s.has(c); } } },
    fantSoon: { textContent: "" },
    fantWho:  { textContent: "" }
  };
  const ctx = {
    LANG: lang,
    $: id => els[id] || null,
    console, JSON, String, Object, Array
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(STR_SRC, ctx);
  /* t() in the app resolves LANG against STR; recreate exactly that contract */
  vm.runInContext(`function t(k, p){ const r = STR[k]; if(!r) return k;
    let s = r[LANG === "ar" ? 0 : 1];
    if(p) for(const x in p) s = s.split("{" + x + "}").join(p[x]);
    return s; }`, ctx);
  vm.runInContext(FN_SRC, ctx);
  vm.runInContext("paintFantasyGate()", ctx);
  return els;
}

console.log("\nthe fantasy tab, as a user reads it");
for (const lang of ["ar", "en"]) {
  const e = run(lang);
  const line = e.fantSoon.textContent;
  const cta = e.fantCta.textContent;
  console.log("  " + lang + "   \"" + line + "\"   [" + cta + "]");

  ok(!e.fantCta.classList.contains("hide"),
     lang + ": the way into the game is hidden — fantasy is open, the button must show");
  ok(!!cta, lang + ": the button has no label");
  ok(!!line, lang + ": the tab line is empty");
  /* the actual regression: a live game advertising itself as unreleased */
  ok(!/soon|قريب/i.test(line),
     lang + ': the tab still says "' + line + '" — fantasy is open, that is not true any more');
  ok(!/soon|قريب/i.test(cta),
     lang + ': the button says "' + cta + '"');
  ok(!e.fantWho.textContent,
     lang + ": the account line is populated — that belonged to the deleted gate");
}

console.log("\n" + "=".repeat(64));
console.log(fail ? "FAILED  " + fail + " of " + (pass + fail)
                 : "PASSED  " + pass + " assertions, 0 failures");
console.log("=".repeat(64) + "\n");
process.exit(fail ? 1 : 0);
