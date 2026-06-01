// ═══════════════════════════════════════════════════════════════════════════════
//  TakeawayCupCounter.gs
//  Polls Square Orders daily, tallies any sold line item whose name starts with
//  "TA " or "LG " (i.e. any drink served in a Planetware takeaway cup — coffee,
//  hot choc, chai, etc). When the running counter hits TA_CUP_THRESHOLD,
//  appends a Shopping-List to-do in Notion and rolls the counter (preserving
//  overflow), then logs the trigger to a sheet for audit.
//
//  Counter start date: 2026-06-01 (set by installTakeawayCupCounter()).
//  Counter is cumulative across daily polls; resets by subtraction, not zero.
//
//  ── SETUP (one-off) ────────────────────────────────────────────────────────
//   1. Script Properties already need:
//        SQUARE_ACCESS_TOKEN  (already present — used by SyncSquarePrices.gs)
//        NOTION_API_KEY       (already present — used by SyncCostingsToNotion.gs)
//   2. Open the editor, select installTakeawayCupCounter, click Run, grant scopes.
//   3. (Optional) Run testTakeawayCupCounter() to verify Square + Notion paths.
//
//  ── ADJUSTING ──────────────────────────────────────────────────────────────
//   Change threshold:  edit TA_CUP_THRESHOLD constant below, redeploy.
//   Reset counter:     run resetTakeawayCupCounter() from the editor.
//   Pause:             delete the daily trigger from Triggers panel.
// ═══════════════════════════════════════════════════════════════════════════════

var TA_CUP_THRESHOLD       = 10000;
var TA_CUP_SHOPPING_PAGE   = '3683c99c0e8581c7b19cc2eec6b27b47'; // same Shopping List Notion page
var TA_CUP_AUDIT_SS_ID     = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI'; // Coffee Costings SS (audit lives in CUP_AUDIT tab)
var TA_CUP_AUDIT_SHEET     = 'CUP_AUDIT';

// Property keys
var PK_COUNTER       = 'TA_CUP_COUNTER';
var PK_WATERMARK     = 'TA_CUP_WATERMARK';      // ISO timestamp of last processed order
var PK_START_DATE    = 'TA_CUP_START_DATE';     // ISO date counter began
var PK_LOCATION_ID   = 'TA_CUP_LOCATION_ID';    // cached primary Square location

// ─────────────────────────────────────────────────────────────────────────────
//  INSTALL — run once
// ─────────────────────────────────────────────────────────────────────────────
function installTakeawayCupCounter() {
  var props = PropertiesService.getScriptProperties();

  // Seed counter + start date if missing
  if (!props.getProperty(PK_COUNTER))    props.setProperty(PK_COUNTER, '0');
  if (!props.getProperty(PK_START_DATE)) props.setProperty(PK_START_DATE, '2026-06-01T00:00:00+10:00');
  if (!props.getProperty(PK_WATERMARK))  props.setProperty(PK_WATERMARK, '2026-06-01T00:00:00+10:00');

  // Cache location ID
  cacheSquareLocation_();

  // Ensure audit sheet exists
  ensureAuditSheet_();

  // Remove any existing trigger for this function, then re-create
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runTakeawayCupCounter') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runTakeawayCupCounter')
    .timeBased()
    .everyDays(1)
    .atHour(3) // 3am AEST — well after close
    .create();

  Logger.log('✓ Installed. Counter at %s, threshold %s, daily trigger set for 3am.',
             props.getProperty(PK_COUNTER), TA_CUP_THRESHOLD);
}

// ─────────────────────────────────────────────────────────────────────────────
//  RESET — manual
// ─────────────────────────────────────────────────────────────────────────────
function resetTakeawayCupCounter() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date().toISOString();
  props.setProperty(PK_COUNTER, '0');
  props.setProperty(PK_WATERMARK, now);
  props.setProperty(PK_START_DATE, now);
  Logger.log('Counter reset. New start: %s', now);
}

// ─────────────────────────────────────────────────────────────────────────────
//  DAILY POLL
// ─────────────────────────────────────────────────────────────────────────────
function runTakeawayCupCounter() {
  var props      = PropertiesService.getScriptProperties();
  var locationId = props.getProperty(PK_LOCATION_ID) || cacheSquareLocation_();
  var watermark  = props.getProperty(PK_WATERMARK);
  var counter    = parseInt(props.getProperty(PK_COUNTER) || '0', 10);

  var nowIso = new Date().toISOString();
  var newCups = countTakeawayCupsBetween_(locationId, watermark, nowIso);

  counter += newCups;
  props.setProperty(PK_COUNTER, String(counter));
  props.setProperty(PK_WATERMARK, nowIso);

  Logger.log('Polled %s → %s. New cups: %s. Counter now: %s / %s',
             watermark, nowIso, newCups, counter, TA_CUP_THRESHOLD);

  if (counter >= TA_CUP_THRESHOLD) {
    triggerShoppingNotice_(counter);
    var overflow = counter - TA_CUP_THRESHOLD;
    props.setProperty(PK_COUNTER, String(overflow));
    Logger.log('▲ Threshold hit. Notion item added. Counter rolled to overflow: %s', overflow);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SQUARE — paginate orders and tally TA/LG line items
// ─────────────────────────────────────────────────────────────────────────────
function countTakeawayCupsBetween_(locationId, startIso, endIso) {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN not set.');

  var cursor = null;
  var total  = 0;
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
      headers: {
        Authorization: 'Bearer ' + token,
        'Square-Version': '2024-06-04'
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code !== 200) {
      Logger.log('Square Orders.search failed: %s %s', code, resp.getContentText().slice(0, 400));
      break;
    }

    var json = JSON.parse(resp.getContentText());
    var orders = json.orders || [];
    orders.forEach(function (o) {
      (o.line_items || []).forEach(function (li) {
        if (!li.name) return;
        var n = li.name.trim();
        if (n.indexOf('TA ') === 0 || n.indexOf('LG ') === 0) {
          total += parseInt(li.quantity || '1', 10) || 1;
        }
      });
    });

    cursor = json.cursor || null;
    safety++;
  } while (cursor && safety < 50);

  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
//  NOTION — append to Shopping List
// ─────────────────────────────────────────────────────────────────────────────
function triggerShoppingNotice_(counter) {
  var key = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  if (!key) throw new Error('NOTION_API_KEY not set.');

  var startDate = (PropertiesService.getScriptProperties().getProperty(PK_START_DATE) || '').slice(0, 10);
  var text = 'Order Planetware takeaway cups — ' + counter.toLocaleString() +
             ' takeaway drinks sold since ' + startDate;

  var resp = UrlFetchApp.fetch(
    'https://api.notion.com/v1/blocks/' + TA_CUP_SHOPPING_PAGE + '/children',
    {
      method: 'patch',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + key,
        'Notion-Version': '2022-06-28'
      },
      payload: JSON.stringify({
        children: [{
          object: 'block',
          type: 'to_do',
          to_do: {
            checked: false,
            rich_text: [{ type: 'text', text: { content: text } }]
          }
        }]
      }),
      muteHttpExceptions: true
    }
  );

  if (resp.getResponseCode() >= 300) {
    Logger.log('Notion append failed: %s %s', resp.getResponseCode(), resp.getContentText().slice(0, 400));
  } else {
    appendAudit_(new Date(), counter, text);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function cacheSquareLocation_() {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN not set.');

  var resp = UrlFetchApp.fetch('https://connect.squareup.com/v2/locations', {
    headers: { Authorization: 'Bearer ' + token, 'Square-Version': '2024-06-04' },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Could not list Square locations: ' + resp.getContentText().slice(0, 300));
  }
  var locs = JSON.parse(resp.getContentText()).locations || [];
  var primary = locs.find(function (l) { return l.status === 'ACTIVE'; }) || locs[0];
  if (!primary) throw new Error('No Square locations found on this account.');
  PropertiesService.getScriptProperties().setProperty(PK_LOCATION_ID, primary.id);
  Logger.log('Cached Square location: %s (%s)', primary.name, primary.id);
  return primary.id;
}

function ensureAuditSheet_() {
  var ss = SpreadsheetApp.openById(TA_CUP_AUDIT_SS_ID);
  var sh = ss.getSheetByName(TA_CUP_AUDIT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TA_CUP_AUDIT_SHEET);
    sh.appendRow(['Timestamp', 'Counter at trigger', 'Shopping list text']);
    sh.getRange('A1:C1').setFontWeight('bold');
  }
}

function appendAudit_(when, counter, text) {
  try {
    var sh = SpreadsheetApp.openById(TA_CUP_AUDIT_SS_ID).getSheetByName(TA_CUP_AUDIT_SHEET);
    if (sh) sh.appendRow([when, counter, text]);
  } catch (e) {
    Logger.log('Audit log failed (non-fatal): %s', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  TEST — manual probe; does NOT advance the watermark
// ─────────────────────────────────────────────────────────────────────────────
function testTakeawayCupCounter() {
  var props = PropertiesService.getScriptProperties();
  var locationId = props.getProperty(PK_LOCATION_ID) || cacheSquareLocation_();

  // Look at last 7 days as a sanity check
  var end = new Date();
  var start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  var n = countTakeawayCupsBetween_(locationId, start.toISOString(), end.toISOString());
  Logger.log('Last 7 days TA+LG cup count: %s', n);
  Logger.log('Current counter: %s / %s', props.getProperty(PK_COUNTER), TA_CUP_THRESHOLD);
  Logger.log('Watermark: %s', props.getProperty(PK_WATERMARK));
}
