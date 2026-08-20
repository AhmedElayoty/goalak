/* RIGOROUS WC -> GOALLAK AUDIT.
 *
 * The owner's instruction: compare the WC app to Goallak feature by feature, against the
 * DEPLOYED source, and say what was left behind. 331 WC functions have no namesake in
 * Goallak, but most of those are World Cup itself — groups, brackets, nations, the Egypt
 * celebration. A name-diff alone would be noise.
 *
 * So this checks CAPABILITIES, not identifiers: for each one, a signature in each app that
 * would be present however it happens to be named. Anything marked N/A is World Cup domain
 * that a club-league product does not have.
 */
import fs from "node:fs";
const wc = fs.readFileSync(process.env.TEMP + "/wc-live.html", "utf8");
const gk = fs.readFileSync(process.env.TEMP + "/gk-deploy/index.html", "utf8");
const fx = fs.readFileSync(process.env.TEMP + "/gk-deploy/fantasy/index.html", "utf8");
const both = gk + "\n" + fx;

/* [area, capability, WC signature, Goallak signature, verdict-if-missing] */
const CHECKS = [
  /* ---- shell, PWA, lifecycle ---- */
  ["shell", "service worker registered", /serviceWorker\.register/, /serviceWorker\.register/, "offline and install both break"],
  ["shell", "install prompt (A2HS)", /beforeinstallprompt/, /beforeinstallprompt/, "nobody can install it"],
  ["shell", "forced refresh on new build", /FORCE_RELOAD/, /FORCE_RELOAD/, "users sit on stale builds"],
  ["shell", "version marker on screen", /APP_VERSION/, /APP_VERSION/, "no way to tell which build you have"],
  ["shell", "offline / retry handling", /navigator\.onLine|catch\s*\(/, /navigator\.onLine|catch\s*\(/, "a failed fetch looks like empty data"],
  ["shell", "back button / history", /popstate|history\.pushState/, /popstate|history\.pushState/, "Android back exits the app"],
  ["shell", "safe-area insets", /env\(safe-area-inset/, /env\(safe-area-inset/, "content under the notch"],
  ["shell", "theme (light/dark)", /data-theme|setTheme/, /setTheme/, "no light mode"],
  ["shell", "language toggle AR/EN", /setLang|toggleLang/, /setLang|toggleLang/, "single language only"],
  ["shell", "RTL support", /dir\s*=\s*["']rtl|direction:rtl|documentElement\.dir/, /documentElement\.dir/, "Arabic layout breaks"],

  /* ---- accounts ---- */
  ["accounts", "sign up", /signup|register/i, /signup|openAuth/i, "no accounts"],
  ["accounts", "sign in", /login|signIn/i, /login|openAuth/i, "no accounts"],
  ["accounts", "sign out", /logout|signOut/i, /signOut|logout/i, "cannot leave an account"],
  ["accounts", "password reset", /request-reset|forgot/i, /request-reset|forgot/i, "a lost password is a lost account"],
  ["accounts", "favourite club", /favClub|myClub|setClub/i, /myClub|set-club|favClub/i, "no personalisation"],

  /* ---- matches / data ---- */
  ["matches", "match list", /scoreboard|fixtures/i, /scoreboard/i, "no fixtures"],
  ["matches", "live scores", /live/i, /live/i, "no live scores"],
  ["matches", "match detail sheet", /openMatch|matchModal|renderMatchModal/, /openMatch|renderMatchModal/, "no match detail"],
  ["matches", "line-ups", /lineup/i, /lineup|mdNoLineups/i, "no line-ups"],
  ["matches", "standings table", /standings/i, /standings/i, "no table"],
  ["matches", "team crests", /logo|crest/i, /crestHtml|logo/i, "no badges"],
  ["matches", "date / day navigation", /dkey|loadDay|dayStrip/, /loadDay|buildStrip/, "cannot browse days"],
  ["matches", "timezone / clock format", /AM|24H|tickClock/, /tickClock|AM/, "wrong kick-off times"],

  /* ---- predictions ---- */
  ["predictions", "make a prediction", /savePred|submitPred|myPreds/, /myPreds/, "the core game is gone"],
  ["predictions", "prediction leaderboard", /leaderboard/i, /leaderboard|renderPred/i, "no competition"],
  ["predictions", "locked after kick-off", /lock/i, /lock/i, "you could predict a played match"],
  ["predictions", "scoring / points", /points|score/i, /points|score/i, "predictions mean nothing"],

  /* ---- chat ---- */
  ["chat", "send message", /sendMsg|sendChat/, /sendChat/, "no chat"],
  ["chat", "photo", /pickChatMedia|accept="image/, /pickChatMedia/, "no photos"],
  ["chat", "video", /video/i, /video/i, "no video"],
  ["chat", "voice note", /vnStart|toggleVoiceNote|vnEncodeWav/, /toggleVoiceNote|vnEncodeWav/, "no voice notes"],
  ["chat", "emoji picker", /toggleEmojiPanel/, /toggleEmojiPanel/, "no emoji"],
  ["chat", "reactions", /toggleReaction/, /toggleReaction/, "no reactions"],
  ["chat", "delete own message", /delMsg|deleteChatMsg/, /deleteChatMsg/, "cannot unsend"],
  ["chat", "photo lightbox", /openLightbox/, /openLightbox/, "photos open outside the app"],
  ["chat", "pause media when hidden", /stopAllChatMedia/, /stopAllChatMedia/, "video plays in the background"],
  ["chat", "auto-growing composer", /chatGrow/, /chatGrow/, "long messages are unreadable while typing"],
  ["chat", "unread badge", /chatBadge/, /chatBadge/, "no unread signal"],
  ["chat", "offline cache of the room", /chat_cache|CHAT_KEY/, /gk_chat_cache/, "the room is blank offline"],
  ["chat", "in-app toast", /showChatToast|toastWrap/, /showLocalChatNotification|toastMsg/, "new messages are silent"],

  /* ---- push ---- */
  ["push", "web push subscribe", /pushManager\.subscribe/, /pushManager\.subscribe/, "no notifications"],
  ["push", "notification permission flow", /Notification\.requestPermission/, /Notification\.requestPermission/, "cannot enable alerts"],
  ["push", "per-league / per-type prefs", /prefs|notifTypes|pushPrefs/i, /prefs|pushPrefs|notif/i, "all-or-nothing alerts"],

  /* ---- sharing / social ---- */
  ["social", "share a result or card", /navigator\.share|shareStrip/, /navigator\.share|shareStrip|openShare/, "nothing is shareable"],
  ["social", "canvas/image share artifact", /toDataURL|canvas/i, /shareStrip|canvas/i, "share is text only"],

  /* ---- accessibility ---- */
  ["a11y", "aria-labels on controls", /aria-label/, /aria-label/, "screen readers get nothing"],
  ["a11y", "reduced motion respected", /prefers-reduced-motion/, /prefers-reduced-motion/, "animation for people who asked for none"],
  ["a11y", "focus management in modals", /\.focus\(/, /\.focus\(/, "keyboard users get lost"],
  ["a11y", "Escape closes overlays", /key === "Escape"|Escape/, /Escape/, "no keyboard escape"],

  /* ---- WC-only, listed so the audit is honest about what it skipped ---- */
  ["N/A", "group stage tables", /groupStage|groups/i, null, "World Cup only"],
  ["N/A", "knockout bracket", /bracket|r32|roundOf/i, null, "World Cup only"],
  ["N/A", "nations / flags", /natflag|nation/i, null, "World Cup only"],
  ["N/A", "Egypt celebration", /celeb/i, null, "World Cup only"],
];

const rows = [];
let gaps = 0;
for (const [area, name, wre, gre, why] of CHECKS) {
  const inWC = wre.test(wc);
  if (gre === null) { rows.push([area, name, inWC ? "yes" : "no", "—", ""]); continue; }
  const inGK = gre.test(both);
  if (inWC && !inGK) gaps++;
  rows.push([area, name, inWC ? "yes" : "no", inGK ? "yes" : "MISSING", inWC && !inGK ? why : ""]);
}
console.log("area".padEnd(12) + "capability".padEnd(34) + "WC".padEnd(5) + "GK".padEnd(9) + "if missing");
console.log("-".repeat(100));
let last = "";
for (const [a, n, w, g, why] of rows) {
  if (a !== last) { console.log(""); last = a; }
  console.log(a.padEnd(12) + n.padEnd(34) + w.padEnd(5) + g.padEnd(9) + why);
}
console.log("\n" + "=".repeat(100));
console.log("capabilities checked: " + CHECKS.filter(c => c[3] !== null).length + "   gaps: " + gaps);
