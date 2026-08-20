/* BACK UP EVERY USER'S DATA, AND BE ABLE TO PUT IT BACK.
 *
 * The owner asked whether there is any backup, and the honest answer was no. Everything the
 * app owns for every user - accounts, predictions, fantasy squads, push subscriptions - lives
 * in ONE free third-party key/value store with no versioning, no snapshots and no promise of
 * being there tomorrow. A single bad write, or textdb going away, and it is all gone.
 *
 * There is nothing to restore FROM until a snapshot exists, so this is the first half:
 *
 *   node scripts-backup.mjs                 write a timestamped snapshot into backups/
 *   node scripts-backup.mjs --restore FILE  show what restoring that snapshot would change
 *   node scripts-backup.mjs --restore FILE --apply     actually write it back
 *
 * RESTORE IS DRY-RUN BY DEFAULT and refuses to overwrite live data with an EMPTY value unless
 * --force is given, because the failure this whole system has had twice is "empty" arriving
 * where "failed" was meant.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "backups");
const PROXY = "https://goalak-push.ahmed-ayoty.workers.dev/tdb";
const DIRECT = "https://textdb.online/";
const WRITE = "https://api.textdb.online/update/";
const ORIGIN = "https://goallak.com";

const args = process.argv.slice(2);
const has = f => args.includes(f);
const valOf = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

async function read(key) {
  /* the proxy first here: this runs outside a browser, where textdb's own host is often
     unreachable, and the proxy allows reads from anywhere */
  for (const url of [`${PROXY}/${key}?t=${Date.now()}`, `${DIRECT}${key}?t=${Date.now()}`]) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const t = (await r.text()).trim();
      return t ? { raw: t, json: safe(t) } : { raw: "", json: null };
    } catch (_) { /* try the next host */ }
  }
  return null;                                   /* NULL MEANS FAILED, never "empty" */
}
const safe = t => { try { return JSON.parse(t); } catch (_) { return null; } };

async function write(key, raw) {
  const body = "key=" + encodeURIComponent(key) + "&value=" + encodeURIComponent(raw);
  const opts = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN }, body };
  for (const url of [WRITE, PROXY]) {
    try { const r = await fetch(url, opts); if (r.ok) return true; } catch (_) { }
  }
  return false;
}

/* ---------------------------------------------------------------- snapshot */
async function backup() {
  const acc = await read("goalak_accounts");
  if (!acc) { console.log("FAILED: could not read goalak_accounts — nothing was written"); process.exit(1); }
  const people = acc.json && typeof acc.json === "object" ? Object.values(acc.json).filter(a => a && a.uid) : [];
  console.log(`accounts: ${people.length}`);

  const keys = ["goalak_accounts", "goalak_push_subs"]
    .concat(people.map(a => "goalak_pred_" + a.uid))
    .concat(people.map(a => "goalak_fx_" + a.uid));

  const out = { at: new Date().toISOString(), accounts: people.length, keys: {} };
  let ok = 0, empty = 0, failed = [];
  for (const k of keys) {
    const r = await read(k);
    if (r === null) { failed.push(k); continue; }
    out.keys[k] = r.raw;
    if (r.raw) ok++; else empty++;
  }
  /* A SNAPSHOT WITH HOLES IN IT IS WORSE THAN NO SNAPSHOT, because it looks like one. */
  if (failed.length) {
    console.log("FAILED to read " + failed.length + " key(s): " + failed.join(", "));
    console.log("nothing was written — a partial snapshot would restore holes over live data");
    process.exit(1);
  }
  fs.mkdirSync(DIR, { recursive: true });
  const name = "goalak-" + out.at.replace(/[:.]/g, "-") + ".json";
  const file = path.join(DIR, name);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));

  console.log(`\nsnapshot written: backups/${name}`);
  console.log(`  keys captured   ${ok + empty}  (${ok} with data, ${empty} empty)`);
  console.log(`  size            ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
  for (const a of people) {
    const fx = safe(out.keys["goalak_fx_" + a.uid] || "");
    const pr = safe(out.keys["goalak_pred_" + a.uid] || "");
    console.log("  " + String(a.username).padEnd(18)
      + (fx && fx.squad ? fx.squad.length + " clubs" : "no squad").padEnd(11)
      + (pr && pr.p ? Object.keys(pr.p).length + " predictions" : "no predictions"));
  }
}

/* ---------------------------------------------------------------- restore */
async function restore(file, apply, force) {
  const snap = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`snapshot from ${snap.at} · ${Object.keys(snap.keys).length} keys\n`);
  let changed = 0, same = 0, blocked = 0, wrote = 0;
  for (const [k, raw] of Object.entries(snap.keys)) {
    const live = await read(k);
    if (live === null) { console.log("  SKIP   " + k + "  (could not read the live value)"); continue; }
    if (live.raw === raw) { same++; continue; }
    /* the guard that matters: never put an empty snapshot value over live data */
    if (!raw && live.raw && !force) {
      console.log("  BLOCK  " + k + "  snapshot is empty, live has " + live.raw.length + " bytes  (--force to override)");
      blocked++; continue;
    }
    changed++;
    console.log("  " + (apply ? "WRITE " : "would ") + " " + k
      + "  live " + live.raw.length + "b -> snapshot " + raw.length + "b");
    if (apply) { if (await write(k, raw)) wrote++; else console.log("        WRITE FAILED for " + k); }
  }
  console.log(`\n  unchanged ${same} · differing ${changed} · blocked ${blocked}`
    + (apply ? ` · written ${wrote}` : ""));
  if (!apply && changed) console.log("\n  dry run. re-run with --apply to write these back.");
}

const rf = valOf("--restore");
if (rf) await restore(rf, has("--apply"), has("--force"));
else await backup();
