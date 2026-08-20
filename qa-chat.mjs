import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERBOSE = process.argv.includes("--verbose");
const KEEP = process.argv.includes("--keep");
const DUMP = process.argv.includes("--dump-kits");

/* ============================================================================
   0. RESULTS
   ========================================================================== */
const results = [];
let ctx = "";
const setCtx = s => { ctx = s; };
function ok(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || "", ctx });
  if (!pass) console.log("  FAIL  [" + ctx + "] " + name + (detail ? "\n          " + String(detail).split("\n").join("\n          ") : ""));
  else if (VERBOSE) console.log("  pass  [" + ctx + "] " + name + (detail ? "  — " + detail : ""));
}
const notes = [];
function note(s) { notes.push(s); console.log("  note  " + s); }

/* ============================================================================
   1. STATIC SERVER — the app fetches clubs.json/prices.json/calendar.json.
   ========================================================================== */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
function startServer(root) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      const file = path.join(root, path.normalize(p).replace(/^[\\/]+/, ""));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { "content-type": "text/plain" }); return res.end("404");
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream",
        "cache-control": "no-store" });
      res.end(fs.readFileSync(file));
    });
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

/* ============================================================================
   2. CHROME + CDP
   ========================================================================== */
function findChrome() {
  if (process.env.GOALAK_CHROME && fs.existsSync(process.env.GOALAK_CHROME)) return process.env.GOALAK_CHROME;
  const c = [
    String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
    (process.env.LOCALAPPDATA || "") + String.raw`\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
    String.raw`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  for (const p of c) if (p && fs.existsSync(p)) return p;
  return null;
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.handlers = new Map();
    ws.addEventListener("message", e => {
      const m = JSON.parse(e.data);
      if (m.id != null) {
        const w = this.waiting.get(m.id); if (!w) return; this.waiting.delete(m.id);
        m.error ? w.rej(new Error(m.error.message)) : w.res(m.result);
      } else {
        const hs = this.handlers.get(m.method); if (hs) for (const h of hs) h(m.params);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      setTimeout(() => { if (this.waiting.delete(id)) rej(new Error("CDP timeout: " + method)); }, 40000);
    });
  }
  on(ev, fn) { if (!this.handlers.has(ev)) this.handlers.set(ev, []); this.handlers.get(ev).push(fn); }
}

async function connect(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
      const page = list.find(t => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        return new CDP(ws);
      }
    } catch (_) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("could not attach to Chrome on port " + port);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ============================================================================
   3. PAGE DRIVER
   ========================================================================== */
let cdp, BASE;
/* console errors, tagged with whatever context was current when they fired */
const consoleErrors = [];
const IGNORE_ERR = [/favicon\.ico/i];
function wireConsole(client) {
  const rec = (level, text) => {
    if (!/error|severe/i.test(level)) return;
    if (IGNORE_ERR.some(r => r.test(text))) return;
    consoleErrors.push({ ctx, text: String(text).slice(0, 220) });
  };
  client.on("Runtime.consoleAPICalled", p => { if (p.type === "error" || p.type === "assert")
    rec("error", (p.args || []).map(a => a.value ?? a.description ?? a.type).join(" ")); });
  client.on("Runtime.exceptionThrown", p => rec("error",
    (p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text));
  /* the URL matters: a network error's text is just "Failed to load resource", and whether
     that is a real fault or a missing favicon is only visible in the url field */
  client.on("Log.entryAdded", p => rec(p.entry.level,
    p.entry.text + (p.entry.url ? "  <" + p.entry.url + ">" : "")));
}

async function evaluate(expression, opts) {
  const r = await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true, userGesture: true, ...(opts || {})
  });
  if (r.exceptionDetails) {
    const e = r.exceptionDetails;
    throw new Error("in-page error: " + (e.exception && e.exception.description || e.text));
  }
  return r.result.value;
}
async function waitFor(expr, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 12000)) {
    try { if (await evaluate(expr)) return true; } catch (_) { }
    await sleep(60);
  }
  throw new Error("timed out waiting for " + (label || expr));
}
async function setViewport(w, h) {
  /* The OS window behind the tab has to be at least as big as the emulated viewport, or
     Chrome rasterises at the window size and Page.captureScreenshot returns an upscale of
     it. Emulation alone does not resize the window. */
  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds",
      { windowId, bounds: { width: Math.max(w, 400) + 40, height: Math.max(h, 400) + 120, windowState: "normal" } });
  } catch (_) { /* older Chrome, or no window — the calibration guard will catch the fallout */ }
  await cdp.send("Emulation.setDeviceMetricsOverride",
    { width: w, height: h, deviceScaleFactor: 1, mobile: false });
}
/* one-shot event wait. It has to be armed BEFORE the command that triggers it. The first
   version of loadApp polled for `CLUBS` straight after asking for a navigation, saw the OLD
   document's CLUBS still sitting there, and ran the whole matrix against a page that had
   never reloaded — every run silently in Arabic with the wizard still covering the pitch.
   The suite was reporting its own race. */
function once(event, ms) {
  return new Promise(res => {
    let done = false;
    const h = p => { if (!done) { done = true; res(p); } };
    cdp.on(event, h);
    setTimeout(() => h(null), ms || 20000);
  });
}
async function navigate(url) {
  const done = once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await done;
}

/* Boot the app in a known state. `fresh` leaves onboarding armed (for the tutorial suite);
   otherwise onboarding is marked done and a full legal squad is installed, because an empty
   pitch has no cards to hit-test. The squad is built with the app's OWN blockReason(), so it
   is a squad the app itself would accept — not a fixture we invented. */
let chromeProc, serverHandle, profileDir;
async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.log("  FAIL  no Chrome/Edge found. Set GOALAK_CHROME to a browser executable.");
    process.exit(1);
  }
  const { srv, port } = await startServer(HERE);
  serverHandle = srv;
  BASE = "http://127.0.0.1:" + port;

  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "goalak-qa-"));
  const dbg = 9222 + (process.pid % 900);
  chromeProc = spawn(chromePath, [
    "--headless=new", "--remote-debugging-port=" + dbg, "--user-data-dir=" + profileDir,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars",
    /* The window surface must be at least as big as the largest emulated viewport we ever
       screenshot. Left at the headless default of 800x600, Page.captureScreenshot returns a
       blurry UPSCALE of a 800x600 raster — every colour in it is wrong, and the kit
       assertion happily "found" 33 bugs that did not exist. */
    "--window-size=1400,1700",
    "--force-device-scale-factor=1", "--disable-extensions", "--disable-background-networking",
    "--disable-features=Translate,BackForwardCache", "about:blank"
  ], { stdio: "ignore" });

  cdp = await connect(dbg);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");
  wireConsole(cdp);

  console.log("goalak live QA — Chrome " + path.basename(chromePath) + ", serving " + HERE + " on " + BASE + "\n");

  /* ---- boot sanity. A page that stopped parsing shipped once; this is what that looks
         like from outside. --------------------------------------------------------- */
  setCtx("boot");
  await setViewport(360, 800);
  /* the fantasy warm-up from qa.mjs does not apply here: this suite drives the app shell */
}
function report() {
  const fails = results.filter(r => !r.pass);
  const byName = new Map();
  for (const r of results) {
    if (!byName.has(r.name)) byName.set(r.name, { pass: 0, fail: 0 });
    byName.get(r.name)[r.pass ? "pass" : "fail"]++;
  }
  console.log("\n" + "-".repeat(72));
  for (const [n, c] of byName) {
    const bad = c.fail > 0;
    console.log((bad ? "  FAIL  " : "  ok    ") + n + "  (" + c.pass + " pass"
      + (c.fail ? ", " + c.fail + " FAIL" : "") + ")");
  }
  console.log("-".repeat(72));
  console.log(results.length - fails.length + " assertions passed, " + fails.length + " failed, across "
    + "one viewport, the app shell");
  if (notes.length) { console.log("\nnotes:"); notes.forEach(n => console.log("  · " + n)); }
  if (fails.length) {
    console.log("\nFAILURES:");
    for (const f of fails) console.log("  [" + f.ctx + "] " + f.name + (f.detail ? "\n      " + f.detail : ""));
  }
  try { if (chromeProc && !KEEP) chromeProc.kill(); } catch (_) {}
  try { if (serverHandle) serverHandle.close(); } catch (_) {}
  process.exit(fails.length ? 1 : 0);
}

/* ============================================================================
   THE MAIN APP'S CHAT HAS NEVER HAD A LIVE TEST.
   Every automated check in this repo drives /fantasy/. The chat lives in the app shell, and
   every chat regression this month reached the owner before anything caught it: no emoji
   picker, no reactions, a photo that opened outside the app, a composer that never grew, and
   a smiley button that renders correctly and then sits off the edge of the screen.

   This drives the real page in a real browser and asks the only three questions that matter
   for a control: is it THERE, is it ON SCREEN, and does a tap land on IT.
   ============================================================================ */
(async () => {
  await main();
  try {
    await setViewport(360, 800);
    await navigate(BASE + "/index.html");
    await waitFor('typeof renderChat === "function"', 20000, "app boot");

    const seed = [
      '(() => {',
      '  try {',
      '    localStorage.setItem("gk_user", JSON.stringify({uid:"u1",username:"tester"}));',
      '    localStorage.setItem("gk_chat_session", JSON.stringify({token:"t",uid:"u1",exp:Date.now()+864e5}));',
      '  } catch (e) {}',
      '  gkUser = {uid:"u1",username:"tester"};',
      '  chatSession = {token:"t",uid:"u1",exp:Date.now()+864e5};',
      '  chatMsgs = [',
      '   {id:"m1",uid:"u2",name:"Ali",kind:"text",text:"a message from somebody else that is fairly long",ts:Date.now()-60000,',
      '    rx:{"\\u2764\\uFE0F":["u2","u3"],"\\uD83D\\uDD25":["u1"]}},',
      '   {id:"m2",uid:"u1",name:"tester",kind:"text",text:"my own message, also reasonably long here",ts:Date.now()-30000},',
      '   {id:"m3",uid:"u2",name:"Ali",kind:"image",text:"",mediaUrl:"data:image/gif;base64,R0lGODlhAQABAAAAACw=",ts:Date.now()}',
      '  ];',
      '  mainView = "chat";',
      '  showMain("chat");',
      '  renderChat();',
      '  return 1;',
      '})()'
    ].join("\n");
    await evaluate(seed);
    await new Promise(r => setTimeout(r, 400));

    const probe = [
      'JSON.stringify((() => {',
      '  const out = {};',
      '  out.messages = document.querySelectorAll("#chatLog .cmsg").length;',
      '  const btns = [...document.querySelectorAll("#chatLog .rxbtn")];',
      '  out.smileys = btns.length;',
      '  out.onScreen = btns.map(b => { const r = b.getBoundingClientRect();',
      '    return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth; });',
      '  out.hit = btns.map(b => { const r = b.getBoundingClientRect();',
      '    const e = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);',
      '    return !!(e && e.closest(".rxbtn")); });',
      '  const chips = [...document.querySelectorAll("#chatLog .rxchip")];',
      '  out.chips = chips.length;',
      '  out.chipText = chips.map(c => c.textContent.trim());',
      '  out.mine = chips.filter(c => c.classList.contains("mine")).length;',
      '  out.chipsOnScreen = chips.every(c => { const r = c.getBoundingClientRect();',
      '    return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth; });',
      '  const img = document.querySelector("#chatLog .cmedia img");',
      '  out.imageWired = !!(img && (img.getAttribute("onclick")||"").includes("openLightbox"));',
      '  const ta = document.getElementById("chatIn");',
      '  out.composerGrows = !!(ta && (ta.getAttribute("oninput")||"").includes("chatGrow"));',
      '  out.emojiBtn = !!document.getElementById("chatEmoji");',
      '  return out;',
      '})())'
    ].join("\n");
    const seen = JSON.parse(await evaluate(probe));

    ok("chat: the room renders", seen.messages === 3, seen.messages + " messages drawn");
    ok("chat: every message offers a smiley", seen.smileys === 3, seen.smileys + " of 3");
    ok("chat: EVERY smiley is inside the screen", seen.onScreen.every(Boolean),
       "on-screen flags " + JSON.stringify(seen.onScreen));
    ok("chat: a tap lands on the smiley itself", seen.hit.every(Boolean),
       "hit flags " + JSON.stringify(seen.hit));
    ok("chat: reaction chips render with counts", seen.chips === 2,
       seen.chips + " chips: " + JSON.stringify(seen.chipText));
    ok("chat: my own reaction is marked", seen.mine === 1, seen.mine + " marked mine");
    ok("chat: the chips are on screen too", seen.chipsOnScreen, "a chip is off the edge");
    ok("chat: a photo opens in the app, not the OS viewer", seen.imageWired, "no lightbox handler");
    ok("chat: the composer grows", seen.composerGrows, "no oninput on #chatIn");
    ok("chat: the emoji button is in the composer", seen.emojiBtn, "#chatEmoji missing");

    const barProbe = [
      '(() => {',
      '  const b = document.querySelector("#chatLog .rxbtn");',
      '  if (!b) return JSON.stringify({opened:false, why:"no smiley"});',
      '  b.click();',
      '  const rb = document.getElementById("reactbar");',
      '  if (!rb) return JSON.stringify({opened:false, why:"click did nothing"});',
      '  const r = rb.getBoundingClientRect();',
      '  return JSON.stringify({opened:true, buttons: rb.querySelectorAll("button").length,',
      '    onScreen: r.left>=0 && r.right<=window.innerWidth && r.top>=0 && r.bottom<=window.innerHeight});',
      '})()'
    ].join("\n");
    const bar = JSON.parse(await evaluate(barProbe));
    ok("chat: the smiley opens the reaction bar", bar.opened === true, JSON.stringify(bar));
    ok("chat: the bar offers six reactions", bar.buttons === 6, bar.buttons + " buttons");
    ok("chat: the bar is fully on screen", bar.onScreen === true, JSON.stringify(bar));

    const lb = [
      '(() => {',
      '  const img = document.querySelector("#chatLog .cmedia img");',
      '  if (!img) return JSON.stringify({no:1});',
      '  img.click();',
      '  const o = document.getElementById("lightbox");',
      '  return JSON.stringify({opened: !!o, hasClose: !!(o && o.querySelector(".lbx"))});',
      '})()'
    ].join("\n");
    const light = JSON.parse(await evaluate(lb));
    ok("chat: tapping a photo opens the lightbox", light.opened === true, JSON.stringify(light));
    ok("chat: the lightbox has a close control", light.hasClose === true, JSON.stringify(light));

    /* CROSS-PLATFORM MEDIA. An Android voice note in webm/opus is silent on every iPhone;
       WAV is the one container all of them decode, which is what the WC app always did. */
    const mediaProbe = [
      'JSON.stringify({',
      '  wavEncoder: typeof vnEncodeWav === "function",',
      '  downsample: typeof vnDownsample === "function",',
      '  noWebmRecorder: typeof voiceMimeType === "undefined"',
      '})'
    ].join(" ");
    const media = JSON.parse(await evaluate(mediaProbe));
    ok("media: voice notes encode to WAV, which every phone plays",
       media.wavEncoder && media.downsample, JSON.stringify(media));
    ok("media: the webm recorder is gone",
       media.noWebmRecorder, "voiceMimeType still exists — webm is silent on every iPhone");

    /* THE MATCH SHEET. The share button shipped absolutely positioned inside an unpositioned
       container and landed somewhere the owner could not find — the same class of bug as the
       smiley, and it got through because only the chat had a live suite. A control is only
       real if it is ON SCREEN and a tap lands on IT. */
    const sheetProbe = [
      '(() => {',
      '  closeLightbox();   /* the chat case above opened one; it would cover the sheet */',
      '  const now = Date.now() + 3600000;',
      '  const ev = {id:"qa1", date:new Date(now).toISOString(), _gkLeagueId:"epl",',
      '    status:{type:{state:"pre"}},',
      '    competitions:[{competitors:[',
      '      {homeAway:"home", score:null, team:{id:"1", displayName:"Alpha FC", shortDisplayName:"Alpha"}},',
      '      {homeAway:"away", score:null, team:{id:"2", displayName:"Beta United", shortDisplayName:"Beta"}}',
      '    ]}]};',
      '  EV_INDEX["qa1"] = ev;',
      '  document.getElementById("modal").classList.remove("hide");',
      '  renderMatchModal("qa1");',
      '  const b = document.querySelector("#mbox .mshare");',
      '  if (!b) return JSON.stringify({found:false});',
      '  const r = b.getBoundingClientRect();',
      '  const e = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);',
      '  return JSON.stringify({found:true, text:(b.textContent||"").trim(),',
      '    onScreen: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= window.innerWidth,',
      '    hit: !!(e && e.closest(".mshare")),',
      '    blockedBy: e ? (e.className || e.tagName) + "|" + (e.id||"") : "nothing",',
      '    countdown: !!document.querySelector("#mbox .mcd")});',
      '})()'
    ].join(" ");
    const sheet = JSON.parse(await evaluate(sheetProbe));
    ok("match sheet: the share control exists", sheet.found, JSON.stringify(sheet));
    ok("match sheet: it is ON SCREEN", sheet.onScreen === true, JSON.stringify(sheet));
    ok("match sheet: a tap lands on it", sheet.hit === true, JSON.stringify(sheet));
    ok("match sheet: it SAYS what it does, not just an arrow",
       /share|شارك/i.test(sheet.text || "") && (sheet.text || "").length > 3,
       "label was " + JSON.stringify(sheet.text));
    ok("match sheet: an unstarted match shows a countdown", sheet.countdown === true, JSON.stringify(sheet));

    report();
  } finally {
    try { if (chromeProc && !KEEP) chromeProc.kill(); } catch (_) {}
    try { if (serverHandle) serverHandle.close(); } catch (_) {}
  }
})();
