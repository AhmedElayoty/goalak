/* THE FANTASY TAB AND THE SIGNED-IN TABS.
 *
 * This file used to assert what the fantasy SPLASH said, because that splash once shipped
 * reading "Soon…" on a build where the release gate had already been deleted — four different
 * places wrote its subtitle and fixing one changed nothing a user could see.
 *
 * The splash is gone (v6.16, the owner: "no need for this page at all"). So the thing worth
 * pinning changed with it, and this now asserts the two rules that replaced it:
 *
 *   1. the Fantasy nav item goes to the GAME, not to a screen holding a button
 *   2. Predictions, Fantasy and Chat all require an account — in the app AND on the fantasy
 *      page itself, because a gate only on the nav is one typed URL away from nothing
 *
 * No browser: the real functions and the real string table are lifted out of the shipped files
 * and run against a stub, the same way transfers.test.mjs does it.
 *
 *   node check-fantasy-tab.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(HERE, "index.html"), "utf8");
const FX = fs.readFileSync(path.join(HERE, "fantasy", "index.html"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL  " + m); } };

console.log("\nthe fantasy tab");

/* 1. the splash is really gone, not merely unreachable */
ok(!/id="fantPane"/.test(APP), "the fantasy splash section is still in the markup");
ok(!/id="fantSoon"/.test(APP), "#fantSoon still exists — that was the splash subtitle");
ok(!/function paintFantasyGate/.test(APP), "paintFantasyGate() still exists — it painted the splash");
ok(!/fantasyTag|fantasyCta|fantasyBrand/.test(APP), "the splash strings are still in STR");

/* 2. the nav item goes to the game */
ok(/id="bnFant"[^>]*onclick="goFantasy\(\)"/.test(APP),
   "the Fantasy nav button no longer calls goFantasy()");
ok(/function goFantasy\(\)/.test(APP), "goFantasy() is gone");
ok(/location\.href\s*=\s*"fantasy\/"/.test(APP), "goFantasy() does not navigate to fantasy/");

/* 3. the three tabs that need an account — driven through the real function */
console.log("\nthe signed-in tabs");
const need = APP.slice(APP.indexOf("const NEEDS_ACCOUNT"), APP.indexOf("function goFantasy"));
if (!need) { console.log("  FAIL  NEEDS_ACCOUNT / requireAccount are missing"); process.exit(1); }
function gate(signedIn) {
  const calls = [];
  const ctx = { gkUser: signedIn ? { uid: 1, username: "someone" } : null,
                openAuth: m => calls.push(m), console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(need, ctx);
  const out = {};
  for (const v of ["scores", "pred", "fant", "chat", "set"])
    out[v] = vm.runInContext(`requireAccount(${JSON.stringify(v)})`, ctx);
  out.prompts = calls.length;
  return out;
}
const out = gate(false), inn = gate(true);
for (const v of ["pred", "fant", "chat"])
  ok(out[v] === false, `a signed-out visitor is let into "${v}"`);
for (const v of ["scores", "set"])
  ok(out[v] === true, `"${v}" asks for an account — reading scores should never require one`);
ok(out.prompts === 3, "a refused tab does not open the sign-in sheet (" + out.prompts + " of 3 did)");
for (const v of ["scores", "pred", "fant", "chat", "set"])
  ok(inn[v] === true, `a signed-in user is refused "${v}"`);

/* 4. and showMain itself is gated, not just the buttons — a deep link is a caller too */
ok(/if\(!requireAccount\(v\)\) return;/.test(APP),
   "showMain() does not call requireAccount() — ?go=chat would walk straight in");
ok(/NEEDS_ACCOUNT\[mainView\]/.test(APP),
   "signing out leaves you sitting on a tab that now needs an account");

/* 5. the fantasy PAGE guards itself, or the nav gate is one typed URL away from nothing */
console.log("\nthe fantasy page");
ok(/function fxSignedIn\(\)/.test(FX), "the fantasy page does not check for an account");
ok(/if\(!fxSignedIn\(\)\)/.test(FX), "boot() does not act on fxSignedIn()");
ok(/gk_user/.test(FX), "the fantasy page does not read the app's account record");
ok(!/<input[^>]*type="password"/.test(FX),
   "the fantasy page has a password field — sign-in belongs to the app, this page must never collect one");

console.log("\n" + "=".repeat(64));
console.log(fail ? "FAILED  " + fail + " of " + (pass + fail)
                 : "PASSED  " + pass + " assertions, 0 failures");
console.log("=".repeat(64) + "\n");
process.exit(fail ? 1 : 0);
