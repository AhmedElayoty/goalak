/* A CHANGE THAT NEVER LEAVES THE DEVICE.
 *
 * The owner renamed his team to "Barca4ever FC" on his PC and his phone kept showing the old
 * name. It was not a sync failure: openRename() wrote fx_team to localStorage, repainted, and
 * stopped. Nothing published it. The name only reached the server later, by accident, because
 * an unrelated save() happened to sweep it into its snapshot.
 *
 * An audit of all ten fields fxSnapshot carries found SIX with the same defect:
 *
 *   fx_team        the team name             openRename
 *   fx_form        the formation             setFormation
 *   fx_ft          the transfer ledger       ftSave        <- worth POINTS
 *   fx_ledger      the ground ledger         markRound
 *   fx_onboarded   onboarding finished       closeWizard
 *   fx_tut_skips   how often it was deferred closeWizard / replayTutorial
 *
 * Every one is now routed through syncNow(). This refuses a commit that adds a seventh: it
 * reads which FUNCTION each write sits inside and checks that function publishes.
 *
 *   node check-sync.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = fs.readFileSync(path.join(HERE, "fantasy", "index.html"), "utf8");
const body = (fx.match(/<script>([\s\S]*?)<\/script>/g) || []).map(b => b.slice(8, -9)).join("\n");
const fail = [];

/* the contract: whatever fxSnapshot puts in the record is what has to travel */
const SYNCED = ["fx_team", "fx_form", "fx_ledger", "fx_ft", "fx_onboarded", "fx_tut_skips",
                "fx_chips", "fx_squad", "fx_cap", "fx_vice"];

/* fxApply is APPLYING the server's copy — pushing it back would be an echo. save/syncNow ARE
   the publishers. resetDemo pushes its own wipe explicitly. */
const EXEMPT = new Set(["fxApply", "save", "syncNow", "resetDemo"]);

function bodyOf(name) {
  const i = body.indexOf("function " + name + "(");
  if (i < 0) return "";
  let depth = 0;
  for (let k = body.indexOf("{", i); k < body.length; k++) {
    if (body[k] === "{") depth++;
    else if (body[k] === "}") { depth--; if (!depth) return body.slice(i, k + 1); }
  }
  return "";
}

let fn = "(top level)";
const offenders = new Map();
for (const line of body.split("\n")) {
  const m = line.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
  if (m) fn = m[1];
  for (const key of SYNCED) {
    if (!line.includes('setItem("' + key + '"') && !line.includes('removeItem("' + key + '"')) continue;
    if (EXEMPT.has(fn)) continue;
    if (!/syncNow\(\)|cloudPush\(|save\(\)/.test(bodyOf(fn))) {
      if (!offenders.has(fn)) offenders.set(fn, new Set());
      offenders.get(fn).add(key);
    }
  }
}

if (offenders.size) {
  for (const [where, keys] of offenders) {
    fail.push(where + "() changes " + [...keys].join(", ") + " and never publishes it — "
      + "that change would live on one device only");
  }
}
if (!/function syncNow\(\)/.test(body))
  fail.push("syncNow() is gone — every synced write would have to remember to push on its own");

/* and the publisher has to actually reach the network */
if (!/function cloudPush\(/.test(body)) fail.push("cloudPush() is gone");
if (!/fxTouch\(\); cloudPush\(\);/.test(body))
  fail.push("syncNow() no longer stamps AND pushes — a push without a stamp loses the merge race");

if (fail.length) {
  console.log("state that would never leave the device:");
  fail.forEach(f => console.log("  FAIL  " + f));
  process.exit(1);
}
console.log("check-sync.mjs: all " + SYNCED.length + " synced fields publish when they change");
