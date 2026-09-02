/* Goallak - API-Football relay (Google Apps Script web app)
 *
 * WHY THIS EXISTS. API-Sports rate-limits per IP and refuses calls from platforms with shared
 * egress - Cloudflare Workers included: the worker's first two calls ever came back "too many
 * requests per minute" with zero requests counted. RapidAPI no longer lists API-Sports. This
 * script runs inside the owner's own Google account, holds the key, and forwards exactly one
 * request per call. The worker (goalak-push) remains the brain: budget, schedule, adapters.
 *
 * SETUP (owner, once):
 *   1. script.google.com -> New project -> paste this file over Code.gs -> save.
 *   2. Project Settings (gear) -> Script Properties -> add:
 *        APIFOOTBALL_KEY = <your key from dashboard.api-football.com>
 *        RELAY_TOKEN     = <any long random string; the worker must send the same one>
 *   3. Deploy -> New deployment -> type "Web app" -> Execute as: Me -> Who has access: Anyone
 *      -> Deploy -> copy the URL ending in /exec.
 *   4. On the PC, from goalak/worker:  npx wrangler secret put AF_RELAY_URL   (paste the /exec URL)
 *                                     npx wrangler secret put AF_RELAY_TOKEN (paste the same token)
 *
 * The worker calls  <exec URL>?t=<token>&path=/fixtures?league=233&...  and gets back
 *   { status, headers: { x-ratelimit-... }, body }   - the upstream answer, verbatim.
 */
var HOST = "https://v3.football.api-sports.io";

function doGet(e) {
  var p = (e && e.parameter) || {};
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("RELAY_TOKEN"), key = props.getProperty("APIFOOTBALL_KEY");
  var out = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  if (!token || !key) return out.setContent(JSON.stringify({ error: "relay not configured" }));
  if (String(p.t || "") !== token) return out.setContent(JSON.stringify({ error: "forbidden" }));
  var path = String(p.path || "");
  /* only API-Football v3 paths: /word/word?key=value&... - nothing else can be forwarded */
  if (!/^\/[a-z]+(?:\/[a-z]+)?(?:\?[A-Za-z0-9=&%\-_.:]*)?$/.test(path)) return out.setContent(JSON.stringify({ error: "bad path" }));
  var r = UrlFetchApp.fetch(HOST + path, { headers: { "x-apisports-key": key }, muteHttpExceptions: true });
  var all = r.getAllHeaders(), pick = {};
  for (var k in all) if (/ratelimit/i.test(k)) pick[String(k).toLowerCase()] = String(all[k]);
  var body = null;
  try { body = JSON.parse(r.getContentText()); } catch (_) {}
  return out.setContent(JSON.stringify({ status: r.getResponseCode(), headers: pick, body: body }));
}
