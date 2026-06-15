// ═══════════════════════════════════════════════════════════════════════════════
//  SalesDaily.gs
//  Polls Square Orders daily, buckets sales by Melbourne trading day, and writes
//  a `sales_daily` JSON block to the TIGEROS Notion OS page. The dashboard /
//  labour analysis reads it via /api/sales-daily and divides labour hours+cost
//  (from /api/labour, Deputy) by daily sales to expose the winter staff-cost
//  blowout (staff cost % = labour ÷ sales, per day).
//
//  Mirrors PaymentFeeTracker.gs exactly:
//    - sheet accumulator (avoids the 6-min execution cap on a long backfill)
//    - backfill stepper every 10 min, self-deletes when the window is covered
//    - daily incremental update + Notion block upsert
//
//  ── SETUP (one-off) ────────────────────────────────────────────────────────
//   1. Script Properties already need (both present from existing trackers):
//        SQUARE_ACCESS_TOKEN  (ORDERS_READ scope — used by TakeawayCupCounter)
//        NOTION_API_KEY       (used by SyncCostingsToNotion / PaymentFeeTracker)
//   2. Open the editor, select installSalesDaily, click Run, grant scopes.
//   3. (Optional) printSalesDailySummary() previews the payload without writing.
//
//  Sales convention (matches the "Gross Staff Cost/Gross Sales=Staff Cost %" sheet):
//    gross = (total_money − total_tip_money)  [incl GST, excl tips]
//    net   = gross / 1.1                       [ex-GST, same flat divide as the sheet]
// ═══════════════════════════════════════════════════════════════════════════════

var SD_SHEET_ID        = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI'; // Coffee Costings
var SD_TAB_NAME        = 'Sales Daily';
var SD_NOTION_PAGE_ID  = '3403c99c0e858113a941c2118b3cdef9';             // TIGEROS OS page
var SD_ROLLING_DAYS    = 180;   // window surfaced in the block
var SD_KEEP_DAYS       = 200;   // trim rows older than this
var SD_WINDOW_DAYS     = 30;    // backfill chunk size
var SD_TZ              = 'Australia/Melbourne';
var SD_GST_DIVISOR     = 1.1;

var SD_PK_LOCATION  = 'SD_LOCATION_ID';
var SD_PK_BF_END    = 'SD_BACKFILL_END';
var SD_PK_BF_DONE   = 'SD_BACKFILL_DONE';

// ─────────────────────────────────────────────────────────────────────────────
//  ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────

function installSalesDaily() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'runSalesDailyBackfillStep' || fn === 'runDailySalesUpdate') {
      ScriptApp.deleteTrigger(t);
    }
  });
  PropertiesService.getScriptProperties().deleteProperty(SD_PK_BF_DONE);

  sdCacheLocation_();

  // Backfill every 10 min until SD_ROLLING_DAYS covered, then self-deletes.
  ScriptApp.newTrigger('runSalesDailyBackfillStep').timeBased().everyMinutes(10).create();
  // Daily incremental, ~12:30am (before payment fees 1am, margin review 6am).
  ScriptApp.newTrigger('runDailySalesUpdate').timeBased().everyDays(1).atHour(0).nearMinute(30).create();

  Logger.log('✓ SalesDaily installed. Backfill every 10min (self-deletes), daily update ~12:30am.');
}

// One 30-day chunk of the backfill. Self-deletes its trigger when done.
function runSalesDailyBackfillStep() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(SD_PK_BF_DONE) === 'true') { sdDeleteTrigger_('runSalesDailyBackfillStep'); return; }

  var sheet = sdGetSheet_();
  var endStr = props.getProperty(SD_PK_BF_END);
  var end;
  if (endStr) {
    end = sdParseDateKey_(endStr);
  } else {
    end = new Date(); end.setHours(0, 0, 0, 0); // today 00:00 local
  }
  var start  = sdAddDays_(end, -SD_WINDOW_DAYS);
  var cutoff = sdAddDays_(new Date(), -SD_ROLLING_DAYS);

  Logger.log('SalesDaily backfill window: %s → %s', sdDateKey_(start), sdDateKey_(end));
  var daily = sdFetchDailyTotals_(start, end);
  sdUpsertDailyRows_(sheet, daily);

  if (start <= cutoff) {
    props.setProperty(SD_PK_BF_DONE, 'true');
    props.deleteProperty(SD_PK_BF_END);
    sdDeleteTrigger_('runSalesDailyBackfillStep');
    Logger.log('✓ SalesDaily backfill complete (reached %s). Writing summary.', sdDateKey_(start));
    sdComputeAndWriteSummary_(sheet);
  } else {
    props.setProperty(SD_PK_BF_END, sdDateKey_(start));
    Logger.log('SalesDaily backfill progress: down to %s, continuing...', sdDateKey_(start));
  }
}

// Daily incremental — yesterday's totals + summary refresh.
function runDailySalesUpdate() {
  var sheet = sdGetSheet_();
  var end = new Date(); end.setHours(0, 0, 0, 0);  // today 00:00
  var start = sdAddDays_(end, -1);                  // yesterday 00:00
  var daily = sdFetchDailyTotals_(start, end);
  sdUpsertDailyRows_(sheet, daily);
  sdTrimOldRows_(sheet);
  sdComputeAndWriteSummary_(sheet);
}

// Diagnostic: log the current rolling payload without writing to Notion.
function printSalesDailySummary() {
  Logger.log(JSON.stringify(sdBuildSummary_(sdGetSheet_()), null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
//  SQUARE — Orders.search for a date range, bucketed by Melbourne local date
//  Returns { 'YYYY-MM-DD': { gross, tax, tip, orders } } in DOLLARS.
// ─────────────────────────────────────────────────────────────────────────────

function sdFetchDailyTotals_(startInclusive, endExclusive) {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  if (!token) { Logger.log('SD: SQUARE_ACCESS_TOKEN not set.'); return {}; }
  var locationId = PropertiesService.getScriptProperties().getProperty(SD_PK_LOCATION) || sdCacheLocation_();

  var startIso = startInclusive.toISOString();
  var endIso   = endExclusive.toISOString();
  var out = {};
  var cursor = null;
  var safety = 0;

  do {
    var body = {
      location_ids: [locationId],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: startIso, end_at: endIso } },
          state_filter: { states: ['COMPLETED'] }
        },
        sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' }
      },
      limit: 500
    };
    if (cursor) body.cursor = cursor;

    var resp = UrlFetchApp.fetch('https://connect.squareup.com/v2/orders/search', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, 'Square-Version': '2024-06-04' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log('SD Orders.search failed: %s %s', resp.getResponseCode(), resp.getContentText().slice(0, 400));
      break;
    }

    var json = JSON.parse(resp.getContentText());
    (json.orders || []).forEach(function (o) {
      var key = Utilities.formatDate(new Date(o.created_at), SD_TZ, 'yyyy-MM-dd');
      var total = (o.total_money && o.total_money.amount) || 0;
      var tip   = (o.total_tip_money && o.total_tip_money.amount) || 0;
      var tax   = (o.total_tax_money && o.total_tax_money.amount) || 0;
      var grossCents = total - tip; // incl GST, excl tips
      if (!out[key]) out[key] = { gross: 0, tax: 0, tip: 0, orders: 0 };
      out[key].gross  += grossCents / 100;
      out[key].tax    += tax / 100;
      out[key].tip    += tip / 100;
      out[key].orders += 1;
    });

    cursor = json.cursor || null;
    safety++;
  } while (cursor && safety < 100);

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SHEET ACCUMULATOR
//  Columns: A=Date(YYYY-MM-DD) B=Gross C=Tax D=Tip E=Orders
// ─────────────────────────────────────────────────────────────────────────────

function sdGetSheet_() {
  var ss = SpreadsheetApp.openById(SD_SHEET_ID);
  var sh = ss.getSheetByName(SD_TAB_NAME);
  if (!sh) {
    sh = ss.insertSheet(SD_TAB_NAME);
    sh.getRange(1, 1, 1, 5).setValues([['Date', 'Gross', 'Tax', 'Tip', 'Orders']]);
  }
  return sh;
}

function sdUpsertDailyRows_(sheet, dailyMap) {
  var keys = Object.keys(dailyMap);
  if (!keys.length) return;
  var last = sheet.getLastRow();
  var existing = {};
  if (last >= 2) {
    var vals = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) existing[String(vals[i][0])] = i + 2; // row index
  }
  keys.sort().forEach(function (key) {
    var d = dailyMap[key];
    var row = [key, d.gross, d.tax, d.tip, d.orders];
    if (existing[key]) {
      sheet.getRange(existing[key], 1, 1, 5).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
  });
}

function sdTrimOldRows_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var cutoff = sdDateKey_(sdAddDays_(new Date(), -SD_KEEP_DAYS));
  var vals = sheet.getRange(2, 1, last - 1, 1).getValues();
  // Rows are appended over time but not guaranteed sorted; collect deletions.
  var toDelete = [];
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) < cutoff) toDelete.push(i + 2);
  }
  // Delete bottom-up so indices stay valid.
  toDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { sheet.deleteRow(r); });
}

// ─────────────────────────────────────────────────────────────────────────────
//  SUMMARY → NOTION BLOCK
// ─────────────────────────────────────────────────────────────────────────────

function sdBuildSummary_(sheet) {
  var last = sheet.getLastRow();
  var days = [];
  if (last >= 2) {
    var vals = sheet.getRange(2, 1, last - 1, 5).getValues();
    var cutoff = sdDateKey_(sdAddDays_(new Date(), -SD_ROLLING_DAYS));
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    vals.forEach(function (v) {
      var key = String(v[0]);
      if (!key || key < cutoff) return;
      var gross = Number(v[1]) || 0;
      var parts = key.split('-');
      var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      days.push({
        date: key,
        weekday: dayNames[dt.getDay()],
        gross: Math.round(gross * 100) / 100,
        net: Math.round((gross / SD_GST_DIVISOR) * 100) / 100,
        tax: Math.round((Number(v[2]) || 0) * 100) / 100,
        tip: Math.round((Number(v[3]) || 0) * 100) / 100,
        orders: Number(v[4]) || 0
      });
    });
    days.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  return { type: 'sales_daily', updated: new Date().toISOString(), tz: SD_TZ, days: days };
}

function sdComputeAndWriteSummary_(sheet) {
  sdWriteToNotion_(sdBuildSummary_(sheet));
}

function sdWriteToNotion_(payload) {
  var key = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  if (!key) { Logger.log('SD: NOTION_API_KEY not set.'); return; }
  var json = JSON.stringify(payload);
  var headers = {
    'Authorization': 'Bearer ' + key,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  var allBlocks = [];
  var cursor = null;
  do {
    var url = 'https://api.notion.com/v1/blocks/' + SD_NOTION_PAGE_ID + '/children?page_size=100';
    if (cursor) url += '&start_cursor=' + cursor;
    var res = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  var existing = allBlocks.find(function (b) {
    if (b.type !== 'code') return false;
    var text = (b.code && b.code.rich_text || []).map(function (r) { return r.plain_text; }).join('');
    return text.indexOf('"sales_daily"') !== -1;
  });

  // Notion caps a rich_text item at 2000 chars — chunk the JSON.
  var chunks = [];
  for (var i = 0; i < json.length; i += 1900) {
    chunks.push({ type: 'text', text: { content: json.slice(i, i + 1900) } });
  }
  var blockBody = JSON.stringify({ type: 'code', code: { language: 'json', rich_text: chunks } });

  if (existing) {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + existing.id,
      { method: 'PATCH', headers: headers, payload: blockBody, muteHttpExceptions: true });
  } else {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + SD_NOTION_PAGE_ID + '/children',
      { method: 'PATCH', headers: headers,
        payload: JSON.stringify({ children: [JSON.parse(blockBody)] }), muteHttpExceptions: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function sdCacheLocation_() {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN not set.');
  var resp = UrlFetchApp.fetch('https://connect.squareup.com/v2/locations', {
    headers: { Authorization: 'Bearer ' + token, 'Square-Version': '2024-06-04' },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('Could not list Square locations: ' + resp.getContentText().slice(0, 300));
  var locs = JSON.parse(resp.getContentText()).locations || [];
  var primary = locs.find(function (l) { return l.status === 'ACTIVE'; }) || locs[0];
  if (!primary) throw new Error('No Square locations found.');
  PropertiesService.getScriptProperties().setProperty(SD_PK_LOCATION, primary.id);
  Logger.log('SD cached Square location: %s (%s)', primary.name, primary.id);
  return primary.id;
}

function sdDateKey_(date)  { return Utilities.formatDate(date, SD_TZ, 'yyyy-MM-dd'); }
function sdParseDateKey_(key) { var p = key.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function sdAddDays_(date, days) { var d = new Date(date.getTime()); d.setDate(d.getDate() + days); return d; }
function sdDeleteTrigger_(fn) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t); });
}
