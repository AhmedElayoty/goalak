/* EVERY ELEMENT THE SCRIPT REACHES FOR HAS TO EXIST IN THE MARKUP.
   The password-reset screen shipped opening $("auWrap") — an id that appears nowhere in the
   document — so the emailed deep link threw a TypeError before the form ever painted, and a
   deep link that crashes is indistinguishable from a dead one. check-defined catches a function
   that nothing declares; nothing caught an ID that nothing declares, and they are the same
   mistake in a different namespace. This collects every id the HTML defines and every id the
   script asks $() or getElementById for with a string literal, and refuses the difference.

   Ids built dynamically ("ph_" + eid, data-driven suffixes) cannot be checked this way and are
   skipped — the gate is for the fixed chrome, which is where the reset bug lived. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = [
  { file: path.join(HERE, "index.html"), name: "fantasy/index.html" },
  { file: path.join(HERE, "..", "index.html"), name: "index.html" }
];

let bad = 0;
for (const t of TARGETS) {
  if (!fs.existsSync(t.file)) continue;
  const raw = fs.readFileSync(t.file, "utf8");

  /* ids the document and the script CREATE */
  const defined = new Set();
  for (const m of raw.matchAll(/\sid="([A-Za-z][\w-]*)"/g)) defined.add(m[1]);
  /* ids assembled in strings the script injects via innerHTML: id="..." inside JS literals is
     already caught above since we scan the whole file; ids assigned via .id = "x" too */
  for (const m of raw.matchAll(/\.id\s*=\s*"([A-Za-z][\w-]*)"/g)) defined.add(m[1]);
  /* ids written as id=' + var or id="' + esc(...) are dynamic — nothing to assert */

  /* ids the script ASKS for, as complete literals only */
  const asked = new Map();
  for (const m of raw.matchAll(/\$\(\s*"([A-Za-z][\w-]*)"\s*\)|getElementById\(\s*"([A-Za-z][\w-]*)"\s*\)/g)) {
    const id = m[1] || m[2];
    if (!defined.has(id) && !asked.has(id)) {
      asked.set(id, raw.slice(0, m.index).split("\n").length);
    }
  }

  if (asked.size) {
    bad++;
    console.log(t.name + ": the script asks for " + asked.size + " id(s) the document never defines —");
    for (const [id, line] of asked) console.log('  FAIL  $("' + id + '")  around line ' + line);
  }
}

if (bad) process.exit(1);
console.log("check-ids.mjs: every id the script asks for exists, across " + TARGETS.length + " documents");
