/* EVERY FUNCTION THE PAGE CALLS HAS TO EXIST.
   `gwCount()` was written into six call sites in one sitting and never defined anywhere. The
   page threw on boot and check.mjs parsed it happily, because calling a function that does not
   exist is perfectly valid syntax. Only the live browser suite caught it — and that suite needs
   Chrome and cannot reach the paths that require the real fixture feed, so on a machine without
   a browser this would have shipped. This is the cheap static version: collect what each file
   declares, collect what it calls, and refuse a commit where a call has no declaration. It
   covers the fantasy page, the app shell and the service worker, none of which has a build step
   or a linter in front of it. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = [
  { file: path.join(HERE, "index.html"), name: "fantasy/index.html" },
  { file: path.join(HERE, "..", "index.html"), name: "index.html" },
  { file: path.join(HERE, "..", "sw.js"), name: "sw.js" }
];

/* what the platform provides */
const AMBIENT = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "function", "new", "throw",
  "String", "Number", "Boolean", "Array", "Object", "Math", "JSON", "Date", "Map", "Set",
  "Promise", "RegExp", "Error", "Intl", "parseInt", "parseFloat", "isFinite", "isNaN",
  "encodeURIComponent", "decodeURIComponent", "setTimeout", "clearTimeout", "setInterval",
  "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "fetch", "alert",
  "confirm", "prompt", "atob", "btoa", "structuredClone", "queueMicrotask",
  "Uint8Array", "Int16Array", "Float32Array", "DataView", "ArrayBuffer", "Blob", "File",
  "FileReader", "FormData", "Headers", "Request", "Response", "URL", "URLSearchParams",
  "AbortController", "Image", "Audio", "AudioContext", "webkitAudioContext", "WebSocket",
  "Notification", "TextEncoder", "TextDecoder", "crypto", "caches", "clients",
  "MutationObserver", "IntersectionObserver", "ResizeObserver", "CustomEvent", "Event",
  "Worker", "MediaRecorder", "Symbol", "BigInt", "WeakMap", "WeakSet", "Proxy", "Reflect",
  "console", "document", "window", "navigator", "location", "history", "screen",
  "localStorage", "sessionStorage", "performance", "self", "globalThis",
  "matchMedia", "getComputedStyle"
]);
/* words that can be followed by a bracket without being a call */
const KEYWORD = new Set([
  "async", "await", "yield", "delete", "void", "in", "of", "do", "else", "case", "import",
  "eval", "with", "instanceof"
]);

const SCRIPT_BLOCK = /<script[^>]*>([\s\S]*?)<\/script>/gi;
const SCRIPT_SRC = /<script[^>]+src="([^"]+\.js)"/gi;
const NL = String.fromCharCode(10);
const JOIN = NL + ";" + NL;
/* ONE PASS, ALL THREE QUOTE KINDS. Stripping double quotes first and single quotes second is
   order-dependent and wrong: a double quote INSIDE a single-quoted string closes a string that
   never opened, and everything after it is mis-parsed. That is exactly how `scale(-1,1)` —
   which lives inside a JS string, in an SVG transform attribute — escaped as a function call.
   One alternation, scanned left to right, so whichever quote opens first wins. */
const Q = String.fromCharCode(34), A = String.fromCharCode(39), B = String.fromCharCode(96);
const QUOTED = new RegExp(
  Q + "(?:[^" + Q + "\\\\\\n]|\\\\.)*" + Q + "|" +
  A + "(?:[^" + A + "\\\\\\n]|\\\\.)*" + A + "|" +
  B + "(?:[^" + B + "\\\\]|\\\\.)*" + B, "g");

/* ONE SOURCE AT A TIME. Comment and quote stripping is only balanced WITHIN a file, so
   concatenating the page and its module bundle before stripping let a lone backtick in one of
   them swallow a declaration in the other: `poly = function` vanished while `poly()` survived,
   and the gate reported a function that is perfectly well defined. Strip, then join. */
function strip(x) {
  return x
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    /* ONE PASS, ALL THREE QUOTE KINDS. Stripping double quotes first and single quotes
       second is order-dependent and wrong: a double quote INSIDE a single-quoted string ends
       a string that never started, and everything after it is mis-parsed. That is how
       scale(-1,1) - which lives inside a JS string, in an SVG transform - escaped as a call.
       One alternation, left to right, so whichever quote opens first wins. */
    .replace(QUOTED, '""');
}

let bad = 0;
for (const t of TARGETS) {
  if (!fs.existsSync(t.file)) continue;
  const raw = fs.readFileSync(t.file, "utf8");

  /* ONLY THE SCRIPT. A stylesheet is full of things that look exactly like calls — rgba(),
     calc(), translateY(), var(), env() — and not one of them is one. */
  const parts = [];
  if (/\.html$/.test(t.file)) {
    for (const m of raw.matchAll(SCRIPT_BLOCK)) parts.push(strip(m[1]));
  } else {
    parts.push(strip(raw));
  }
  /* the module files the page loads supply functions it legitimately calls */
  for (const m of raw.matchAll(SCRIPT_SRC)) {
    const p = path.join(path.dirname(t.file), m[1].split("?")[0]);
    if (fs.existsSync(p)) parts.push(strip(fs.readFileSync(p, "utf8")));
  }
  const code = parts.join(JOIN);

  const declared = new Set(AMBIENT);
  for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  /* `let a = 1, b = 2` and other comma-separated declarations */
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([^;=\n]+?)[=;\n]/g)) {
    for (const part of m[1].split(",")) {
      const id = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (id) declared.add(id[1]);
    }
  }
  /* anything assigned a function, including later members of a comma chain */
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\()/g)) declared.add(m[1]);
  /* parameters, so a callback's own arguments are not reported as undeclared */
  for (const m of code.matchAll(/\(([^()]{0,300})\)\s*(?:=>|\{)/g)) {
    for (const part of m[1].split(",")) {
      const id = part.trim().match(/^\.{0,3}([A-Za-z_$][\w$]*)/);
      if (id) declared.add(id[1]);
    }
  }
  for (const m of code.matchAll(/\bimport\s+(?:\*\s+as\s+)?\{?([^}'"\n]+?)\}?\s+from/g)) {
    for (const part of m[1].split(",")) {
      const id = part.trim().split(/\s+as\s+/).pop().match(/^([A-Za-z_$][\w$]*)/);
      if (id) declared.add(id[1]);
    }
  }

  /* every call that is NOT a method call: `foo(` with no dot, no ?. and no word char before */
  const called = new Map();
  const re = /(^|[^\w$.?])([a-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const name = m[2];
    if (declared.has(name) || KEYWORD.has(name)) continue;
    if (!called.has(name)) called.set(name, code.slice(0, m.index).split(NL).length);
  }

  if (called.size) {
    bad++;
    console.log(t.name + ": calls " + called.size + " function(s) it never declares —");
    for (const [name, line] of called) console.log("  FAIL  " + name + "()  around script line " + line);
  }
}

if (bad) process.exit(1);
console.log("check-defined.mjs: every function called is declared, across " + TARGETS.length + " files");
