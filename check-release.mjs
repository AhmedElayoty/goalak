/* THE RELEASE MARKERS MUST MOVE, AND THIS IS WHY THIS FILE EXISTS.
 *
 * Three separate mechanisms exist so that a deploy actually reaches a running client, and all
 * three had quietly stopped working at once:
 *
 *   CACHE in sw.js        bumped every release — this one was being done
 *   APP_VERSION           sat on "5.4" through TWELVE releases. gkVersionCheck() fetches
 *                         index.html and reloads when the version differs; comparing 5.4 to
 *                         5.4, it never reloaded anybody. It is also the marker in settings,
 *                         the only place the owner can read which build he has — so it told
 *                         him 5.4 while the site served 6.10.
 *   FORCE_RELOAD          sat on the 2026-08-16 token. Its rule is "hard-reload once per
 *                         token", so every client that had already reloaded for that token
 *                         ignored the nine releases after it.
 *
 * Between them, an installed app that is only ever RESUMED — never navigated — had no path to
 * a new build at all. The owner asked "did you force refresh?" and the honest answer was no,
 * and had been no for a dozen releases.
 *
 * Bumping CACHE is the habit that stuck because a stale asset is visible. These two are
 * invisible until somebody notices they are looking at an old app, which is exactly the kind
 * of failure a commit gate is for.
 *
 *   node check-release.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sw = fs.readFileSync(path.join(HERE, "sw.js"), "utf8");
const app = fs.readFileSync(path.join(HERE, "index.html"), "utf8");
const fail = [];

/* the newest changelog entry is the release being shipped */
const entry = sw.match(/goalak-v(\d+)\s+(\d{4}-\d{2}-\d{2})\s+v([\d.]+)/);
if (!entry) fail.push("sw.js has no readable changelog entry — the release version cannot be checked");

const cache = (sw.match(/const CACHE = "goalak-v(\d+)"/) || [])[1];
const appV = (app.match(/const APP_VERSION = "([\d.]+)"/) || [])[1];
const force = (app.match(/const FORCE_RELOAD = "([^"]+)"/) || [])[1];

if (entry) {
  const [, entryCache, entryDate, entryVer] = entry;

  /* 1. the cache the worker uses must be the one the changelog says shipped */
  if (cache !== entryCache)
    fail.push(`CACHE is goalak-v${cache} but the newest changelog entry is goalak-v${entryCache}`);

  /* 2. THE ONE THAT KEPT FAILING. APP_VERSION drives both the reload check and the marker
        the owner reads; if it does not match the release, neither works. */
  if (appV !== entryVer)
    fail.push(`APP_VERSION is "${appV}" but this release is v${entryVer} — `
      + "gkVersionCheck() compares them, so a running client will never reload, "
      + "and the version in settings will lie to the owner");

  /* 3. FORCE_RELOAD reloads a client ONCE PER TOKEN, so a token that does not change is a
        token that never fires again. Tie it to the release so it cannot go stale silently. */
  const wantToken = entryDate + "-v" + entryVer.replace(/\./g, "");
  if (force !== wantToken)
    fail.push(`FORCE_RELOAD is "${force}" but this release wants "${wantToken}" — `
      + "clients already carrying the old token will not hard-reload");
}

/* 4. the fantasy page is a SEPARATE document with its own cache entry, so it can be a
      different age from the app. It carries its own marker, and that marker has to agree. */
const fx = fs.readFileSync(path.join(HERE, "fantasy", "index.html"), "utf8");
const fxV = (fx.match(/const FX_BUILD = "([\d.]+)"/) || [])[1];
if (entry && fxV !== entry[3])
  fail.push(`fantasy FX_BUILD is "${fxV}" but this release is v${entry[3]}`);

/* 5. and the worker must still be able to tell two pages apart. Writing every navigation into
      one "index.html" entry meant opening /fantasy/ overwrote the cached main app with the
      fantasy page, so the next offline open of / served Fantasy. */
if (/c\.put\("index\.html", cp\)/.test(sw))
  fail.push("sw.js caches every navigation under \"index.html\" — opening /fantasy/ overwrites the app shell");

/* 6. THE FANTASY SPLASH MUST STAY DELETED, AND THE GATE MUST STAY ON.
      What used to live here guarded the splash's subtitle, because four places wrote it and
      fixing one changed nothing a user could see. The owner then removed the screen itself —
      "no need for this page at all" — so the shape worth refusing is its return, plus the two
      rules that replaced it. The copy assertions moved to check-fantasy-tab.mjs, which runs
      the real functions rather than matching text. */
if (/id="fantPane"/.test(app))
  fail.push("the fantasy splash section is back in the markup — the nav item goes to the game");
if (/function paintFantasyGate\(/.test(app))
  fail.push("paintFantasyGate() is back — it only ever painted the splash");
if (!/function requireAccount\(/.test(app))
  fail.push("requireAccount() is gone — predictions, fantasy and chat would open signed out");
if (!/function goFantasy\(/.test(app))
  fail.push("goFantasy() is gone — the Fantasy tab has nowhere to send anybody");

/* 7. THE CHAT HAS EMOJIS AND REACTIONS, because the WC app did and this did not.
      Guarded on the WIRING, not the presence of a list: a picker nobody can open and a
      reaction that never reaches the socket are the two ways this quietly stops working. */
for (const [re, why] of [
  [/function toggleEmojiPanel\(/, "the emoji picker is gone"],
  [/function insertEmoji\(/, "insertEmoji() is gone — the picker would open and do nothing"],
  [/id="chatEmoji"/, "the emoji button is not in the composer, so nothing opens the picker"],
  [/function toggleReaction\(/, "reactions are gone"],
  [/function rxRow\(/, "rxRow() is gone — reactions would be invisible under messages"],
  /* the affordance is a SMILEY BUTTON beside the bubble, as it is in the WC app — not the whole
     message being tappable, which is undiscoverable and fires by accident while scrolling */
  [/class="rxbtn"/, "the smiley button beside each message is gone — nothing offers a reaction"],
  [/openReact\(event,this\.dataset\.mid\)/, "the smiley no longer opens the reaction bar"],
  [/type:"react"/, "toggleReaction never sends to the socket — nobody else would see it"],
  [/value\.type === "react"/, "the react frame is ignored, so the server's count never lands"]
]) if (!re.test(app)) fail.push(why);

if (fail.length) {
  console.log("release markers are not consistent:");
  fail.forEach(f => console.log("  FAIL  " + f));
  process.exit(1);
}
console.log(`check-release.mjs: v${entry[3]} · goalak-v${cache} · APP_VERSION ${appV} · FORCE_RELOAD ${force} — all consistent`);
