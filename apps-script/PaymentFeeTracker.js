// ═══════════════════════════════════════════════════════════════════════════════
//  PaymentFeeTracker.js
//  Tracks the blended "True Payment Cost" — Square processing fees as a % of
//  total revenue collected — on a rolling 365-day basis, and writes a summary
//  to the TIGEROS Notion OS page as a `payment_fees` JSON code block.
//  The dashboard reads it via /api/payment-fees and uses it to net the
//  Coffee/Food margin badges (see MERCHANT_FEE_PCT fallback in app/page.tsx).
//
//  ── WHY ─────────────────────────────────────────────────────────────────────
//  Cash sales carry no processing fee, so this is a business-wide blended rate
//  (not an item-level cost). As of 15 Jun 2026 it sat at ~1.02% (12mo: $12,916.54
//  fees / $1,262,991.94 collected). This script keeps that figure current
//  automatically instead of a manual 6-monthly re-pull.
//
//  ── HOW IT WORKS ───────────────────────────────────────────────────────────
//  1. ONE-OFF BACKFILL (runPaymentFeeBackfillStep, every ~10min trigger):
//     Walks backward from yesterday in 30-day windows, fetching Square
//     Payments.list for each window, bucketing by local (Australia/Melbourne)
//     date into daily {collected, fees, count} rows written to a "Payment Fees"
//     tab in the Coffee Costings sheet. Stops once it reaches 365 days back,
//     deletes its own trigger, and runs the daily update once to seed Notion.
//  2. DAILY UPDATE (runDailyPaymentFeeUpdate, daily ~1am trigger):
//     Fetches yesterday's payments, upserts that day's row, trims rows older
//     than PFT_KEEP_DAYS, recomputes the rolling PFT_ROLLING_DAYS sum, and
//     writes the summary to Notion.
//
//  ── SETUP (one-off) ────────────────────────────────────────────────────────
//    1. Confirm SQUARE_ACCESS_TOKEN (Script Properties) has PAYMENTS_READ scope
//       — if not, payments.list calls will 401/403 and this will no-op with a
//       logged error. Add the scope in the Square Developer Dashboard for the
//       application that issued this token, then re-run step 2.
//    2. Run installPaymentFeeTracker() once → starts the backfill.
//    3. Run printPaymentFeeSummary() any time to check current status/coverage.
//
//  ── REUSES (Apps Script flat namespace) ────────────────────────────────────
//    cacheSquareLocation_(), PK_LOCATION_ID   (TakeawayCupCounter.gs)
//    SIP_NOTION_API_KEY                       (SyncIngredientPrices.gs)
// ═══════════════════════════════════════════════════════════════════════════════

var PFT_SHEET_ID    = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI'; // Coffee Costings
var PFT_TAB_NAME    = 'Payment Fees';
var PFT_NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9'; // TIGEROS OS page (shared with margin_review)
var PFT_ROLLING_DAYS = 365;  // window used for the headline fee %
var PFT_KEEP_DAYS    = 400;  // trim rows older than this (buffer over rolling window)
var PFT_WINDOW_DAYS  = 30;   // backfill chunk size
var PFT_TZ           = 'Australia/Melbourne';

// ─────────────────────────────────────────────────────────────────────────────
//  ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────

function installPaymentFeeTracker() {
  // Clear any previous backfill/daily triggers for this tracker.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'runPaymentFeeBackfillStep' || fn === 'runDailyPaymentFeeUpdate') {
      ScriptApp.deleteTrigger(t);
    }
  });

  PropertiesService.getScriptProperties().deleteProperty('PFT_BACKFILL_DONE');

  // Backfill runs every 10 minutes until it's covered 365 days, then deletes itself.
  ScriptApp.newTrigger('runPaymentFeeBackfillStep')
    .timeBased()
    .everyMinutes(10)
    .create();

  // Daily incremental update, ~1am (before the 6am margin review).
  ScriptApp.newTrigger('runDailyPaymentFeeUpdate')
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .create();

  Logger.log('✓ Payment Fee Tracker installed. Backfill running every 10min (self-deletes when done), daily update at ~1am.');
}

// One 30-day chunk of the 12-month backfill. Self-deletes its trigger when done.
function runPaymentFeeBackfillStep() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('PFT_BACKFILL_DONE') === 'true') {
    pftDeleteTrigger_('runPaymentFeeBackfillStep');
    return;
  }

  var sheet = pftGetSheet_();

  // Walk backward from "yesterday" (or wherever we left off).
  var endStr = props.getProperty('PFT_BACKFILL_END'); // exclusive end date (YYYY-MM-DD)
  var end;
  if (endStr) {
    end = pftParseDateKey_(endStr);
  } else {
    end = new Date();
    end.setHours(0, 0, 0, 0); // today 00:00 local — backfill covers up to yesterday
  }

  var start = pftAddDays_(end, -PFT_WINDOW_DAYS);
  var cutoff = pftAddDays_(new Date(), -PFT_ROLLING_DAYS);

  Logger.log('Backfill window: %s → %s', pftDateKey_(start), pftDateKey_(end));

  var daily = pftFetchDailyTotals_(start, end);
  pftUpsertDailyRows_(sheet, daily);

  if (start <= cutoff) {
    props.setProperty('PFT_BACKFILL_DONE', 'true');
    props.deleteProperty('PFT_BACKFILL_END');
    pftDeleteTrigger_('runPaymentFeeBackfillStep');
    Logger.log('✓ Backfill complete (reached %s, cutoff %s). Running summary now.', pftDateKey_(start), pftDateKey_(cutoff));
    pftComputeAndWriteSummary_(sheet);
  } else {
    props.setProperty('PFT_BACKFILL_END', pftDateKey_(start));
    Logger.log('Backfill progress: covered down to %s, continuing...', pftDateKey_(start));
  }
}

// Daily incremental update — yesterday's totals + rolling summary refresh.
function runDailyPaymentFeeUpdate() {
  var sheet = pftGetSheet_();
  var end = new Date(); end.setHours(0, 0, 0, 0);     // today 00:00
  var start = pftAddDays_(end, -1);                     // yesterday 00:00

  var daily = pftFetchDailyTotals_(start, end);
  pftUpsertDailyRows_(sheet, daily);
  pftTrimOldRows_(sheet);
  pftComputeAndWriteSummary_(sheet);
}

// Diagnostic: log current rolling summary without writing to Notion.
function printPaymentFeeSummary() {
  var sheet = pftGetSheet_();
  var summary = pftBuildSummary_(sheet);
  Logger.log(JSON.stringify(summary, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
//  SQUARE — fetch Payments.list for a date range, bucketed by local date
// ─────────────────────────────────────────────────────────────────────────────

// Returns { 'YYYY-MM-DD': { collected: cents, fees: cents, count: n }, ... }
// startInclusive/endExclusive are Date objects at local midnight.
function pftFetchDailyTotals_(startInclusive, endExclusive) {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  if (!token) { Logger.log('PFT: SQUARE_ACCESS_TOKEN not set.'); return {}; }
  var locationId = PropertiesService.getScriptProperties().getProperty(PK_LOCATION_ID) || cacheSquareLocation_();

  var byDate = {};
  var cursor = null;
  var safety = 0;

  do {
    var url = 'https://connect.squareup.com/v2/payments'
      + '?location_id=' + encodeURIComponent(locationId)
      + '&begin_time=' + encodeURIComponent(startInclusive.toISOString())
      + '&end_time=' + encodeURIComponent(endExclusive.toISOString())
      + '&sort_order=ASC&limit=200'
      + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');

    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token, 'Square-Version': '2024-06-04' },
      muteHttpExceptions: true,
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log('PFT: Square Payments.list failed (%s): %s', resp.getResponseCode(), resp.getContentText().slice(0, 300));
      break;
    }

    var json = JSON.parse(resp.getContentText());
    (json.payments || []).forEach(function (p) {
      if (p.status !== 'COMPLETED') return;
      var created = new Date(p.created_at);
      var key = pftDateKey_(created);
      if (!byDate[key]) byDate[key] = { collected: 0, fees: 0, count: 0 };

      var total = (p.total_money && p.total_money.amount) || 0;
      byDate[key].collected += total;
      byDate[key].count += 1;

      (p.processing_fee || []).forEach(function (f) {
        var amt = (f.amount_money && f.amount_money.amount) || 0;
        byDate[key].fees += Math.abs(amt);
      });
    });

    cursor = json.cursor || null;
    safety++;
  } while (cursor && safety < 60); // 60 * 200 = 12,000 payments per window — plenty for 30 days

  return byDate;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SHEET — "Payment Fees" tab: Date | Collected | Fees | Count
// ─────────────────────────────────────────────────────────────────────────────

function pftGetSheet_() {
  var ss = SpreadsheetApp.openById(PFT_SHEET_ID);
  var sheet = ss.getSheetByName(PFT_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PFT_TAB_NAME);
    sheet.appendRow(['Date', 'Collected', 'Fees', 'Count']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Upsert daily totals (cents → dollars) into the sheet, keyed by Date column.
function pftUpsertDailyRows_(sheet, dailyMap) {
  var keys = Object.keys(dailyMap);
  if (keys.length === 0) return;

  var lastRow = sheet.getLastRow();
  var existing = {}; // dateKey → row number
  if (lastRow > 1) {
    var dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < dates.length; i++) {
      var v = dates[i][0];
      var k = (v instanceof Date) ? pftDateKey_(v) : String(v);
      existing[k] = i + 2; // 1-indexed + header row
    }
  }

  keys.sort().forEach(function (key) {
    var d = dailyMap[key];
    var row = [key, d.collected / 100, d.fees / 100, d.count];
    if (existing[key]) {
      sheet.getRange(existing[key], 1, 1, 4).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
  });
}

// Remove rows older than PFT_KEEP_DAYS to keep the sheet small.
function pftTrimOldRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  var cutoff = pftDateKey_(pftAddDays_(new Date(), -PFT_KEEP_DAYS));
  var dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  // Delete from the bottom up so row indices stay valid.
  for (var i = dates.length - 1; i >= 0; i--) {
    var v = dates[i][0];
    var k = (v instanceof Date) ? pftDateKey_(v) : String(v);
    if (k < cutoff) sheet.deleteRow(i + 2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SUMMARY — rolling PFT_ROLLING_DAYS totals + fee %
// ─────────────────────────────────────────────────────────────────────────────

function pftBuildSummary_(sheet) {
  var lastRow = sheet.getLastRow();
  var empty = {
    type: 'payment_fees', updated: new Date().toISOString(),
    daysCovered: 0, totalCollected: 0, totalFees: 0, feePct: null,
  };
  if (lastRow <= 1) return empty;

  var rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var cutoff = pftDateKey_(pftAddDays_(new Date(), -PFT_ROLLING_DAYS));

  var totalCollected = 0, totalFees = 0, daysCovered = 0;
  rows.forEach(function (r) {
    var v = r[0];
    var k = (v instanceof Date) ? pftDateKey_(v) : String(v);
    if (k < cutoff) return;
    totalCollected += Number(r[1]) || 0;
    totalFees += Number(r[2]) || 0;
    daysCovered++;
  });

  var feePct = totalCollected > 0 ? (totalFees / totalCollected) * 100 : null;

  return {
    type: 'payment_fees',
    updated: new Date().toISOString(),
    daysCovered: daysCovered,
    totalCollected: Math.round(totalCollected * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    feePct: feePct !== null ? Math.round(feePct * 10000) / 10000 : null,
  };
}

function pftComputeAndWriteSummary_(sheet) {
  var summary = pftBuildSummary_(sheet);
  pftWriteToNotion_(summary);
  Logger.log('Payment fee summary: %s days, fee %s%%, collected $%s, fees $%s',
    summary.daysCovered, summary.feePct, summary.totalCollected, summary.totalFees);
}

// ─────────────────────────────────────────────────────────────────────────────
//  NOTION WRITER — same chunked code-block pattern as margin_review
// ─────────────────────────────────────────────────────────────────────────────

function pftWriteToNotion_(payload) {
  var json = JSON.stringify(payload);
  var headers = {
    'Authorization': 'Bearer ' + SIP_NOTION_API_KEY,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  var allBlocks = [];
  var cursor = null;
  do {
    var url = 'https://api.notion.com/v1/blocks/' + PFT_NOTION_PAGE_ID + '/children?page_size=100';
    if (cursor) url += '&start_cursor=' + cursor;
    var res = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  var existingBlock = allBlocks.find(function (b) {
    if (b.type !== 'code') return false;
    var text = (b.code && b.code.rich_text || []).map(function (r) { return r.plain_text; }).join('');
    return text.indexOf('"payment_fees"') !== -1;
  });

  var chunks = [];
  for (var i = 0; i < json.length; i += 1900) {
    chunks.push({ type: 'text', text: { content: json.slice(i, i + 1900) } });
  }
  var blockBody = JSON.stringify({ type: 'code', code: { language: 'json', rich_text: chunks } });

  if (existingBlock) {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + existingBlock.id, {
      method: 'PATCH', headers: headers, payload: blockBody, muteHttpExceptions: true,
    });
  } else {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + PFT_NOTION_PAGE_ID + '/children', {
      method: 'PATCH', headers: headers,
      payload: JSON.stringify({ children: [JSON.parse(blockBody)] }),
      muteHttpExceptions: true,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DATE HELPERS (Australia/Melbourne local dates)
// ─────────────────────────────────────────────────────────────────────────────

function pftDateKey_(date) {
  return Utilities.formatDate(date, PFT_TZ, 'yyyy-MM-dd');
}

function pftParseDateKey_(key) {
  var parts = key.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function pftAddDays_(date, days) {
  var d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function pftDeleteTrigger_(handlerFn) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handlerFn) ScriptApp.deleteTrigger(t);
  });
}
