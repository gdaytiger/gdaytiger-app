// ═══════════════════════════════════════════════════════════════════════════════
//  GbpRemoved.gs — spot reviews that disappear from the Google profile
//
//  Every review sync pages through all reviews (gbpExactRating_). We keep a light
//  snapshot (reviewer, stars, date, first 160 chars) in a Drive JSON file and
//  compare. A review only counts as removed once it has been missing on two
//  checks in a row (~30 min apart) — Google's API occasionally drops one briefly.
//  If a whole batch vanishes at once (API hiccup), nothing is flagged.
//
//  Confirmed removals go into the google_reviews block (`removed`, newest first,
//  last 20) for the TIGER OS Google tile, and a push goes to Jono's phone via
//  TIGER OS /api/push/google (authorised with GBP_SECRET).
// ═══════════════════════════════════════════════════════════════════════════════

var GBP_TIGEROS_URL = 'https://gdaytiger-app.vercel.app';
var GBP_SNAPSHOT_NAME = 'TigerOS – Google review snapshot.json';
var GBP_MAX_BATCH_DROP = 5;   // more than this missing at once = API hiccup, ignore

function gbpSnapshotFile_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('REVIEW_SNAPSHOT_FILE');
  if (id) { try { return DriveApp.getFileById(id); } catch (e) { /* recreate */ } }
  var f = DriveApp.createFile(GBP_SNAPSHOT_NAME, '{}', 'application/json');
  props.setProperty('REVIEW_SNAPSHOT_FILE', f.getId());
  return f;
}

// seen: { reviewName: {r,s,d,c} } from this sync. Returns the updated removed list.
function gbpDetectRemoved_(seen, n, removed) {
  removed = removed || [];
  if (!seen || !n) return removed;
  var file = gbpSnapshotFile_();
  var prev = {};
  try { prev = JSON.parse(file.getBlob().getDataAsString() || '{}'); } catch (e) { prev = {}; }
  var prevReviews = prev.reviews || {};
  var suspects = prev.suspects || {};       // name → info, missing on the previous check
  var first = !prev.reviews;

  var missing = Object.keys(prevReviews).filter(function (k) { return !seen[k]; });
  var nextSuspects = {}, confirmed = [];

  if (!first && missing.length <= GBP_MAX_BATCH_DROP) {
    missing.forEach(function (k) {
      if (suspects[k]) confirmed.push(suspects[k]);      // missing twice in a row
      else nextSuspects[k] = prevReviews[k];
    });
  } else if (!first) {
    // Big drop at once — assume an API hiccup. Keep the old snapshot untouched.
    Logger.log('removed-check: ' + missing.length + ' missing at once — skipped');
    return removed;
  }

  // Keep suspects in the snapshot so a second miss can confirm them.
  var merged = {};
  Object.keys(seen).forEach(function (k) { merged[k] = seen[k]; });
  Object.keys(nextSuspects).forEach(function (k) { merged[k] = nextSuspects[k]; });
  file.setContent(JSON.stringify({ updated: new Date().toISOString(), reviews: merged, suspects: nextSuspects }));

  if (confirmed.length) {
    var now = new Date().toISOString();
    confirmed.forEach(function (c) {
      removed.unshift({ reviewer: c.r, stars: c.s, date: c.d, comment: c.c, removedAt: now });
    });
    removed = removed.slice(0, 20);
    gbpPushRemoved_(confirmed);
  }
  return removed;
}

function gbpPushRemoved_(list) {
  var one = list[0];
  var title = list.length === 1
    ? 'Google review removed: ' + '★'.repeat(one.s) + ' ' + one.r
    : list.length + ' Google reviews removed';
  var body = list.length === 1
    ? (one.c ? '“' + one.c.slice(0, 120) + (one.c.length > 120 ? '…' : '') + '”' : 'Stars only, no text') + ' · posted ' + one.d
    : list.map(function (x) { return x.s + '★ ' + x.r; }).join(', ');
  try {
    UrlFetchApp.fetch(GBP_TIGEROS_URL + '/api/push/google', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-gbp-secret': gbpProp_('GBP_SECRET') },
      payload: JSON.stringify({ title: title, body: body })
    });
  } catch (e) { Logger.log('push failed: ' + e); }
}
