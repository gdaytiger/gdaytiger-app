// ═══════════════════════════════════════════════════════════════════════════════
//  TakeawayCupCounter.gs
//  Polls Square Orders daily, tallies any sold line item whose name starts with
//  "TA " or "LG " (i.e. any drink served in a Planetware takeaway cup — coffee,
//  hot choc, chai, etc). When the running counter hits TA_CUP_THRESHOLD,
//  appends a [STICKY] "Planetware" task to today's Daily To Do (ORDER category,
//  same page/heading insertion logic as /api/add-task) — NOT the Shopping List —
//  and rolls the counter (preserving overflow), then logs the trigger to a sheet
//  for audit. "Planetware" renders as a tappable tel: link (see SUPPLIER_LINKS in
//  page.tsx) and stays pinned in Daily To Do every day until ticked off, same as
//  any other persistent task. The order/date detail goes in the task's context
//  field (task-context JS code block on the OS page), not the title.
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

var TA_CUP_THRESHOLD       = 8000;
var TA_CUP_TZ              = 'Australia/Melbourne';
var TA_CUP_CATEGORY        = 'ORDER';
// OS page hosting the task-context JS code block — same page /api/task-context and
// /api/add-task read/write (STATE_PARENT_ID in those routes).
var TA_CUP_OS_PAGE_ID      = '3403c99c0e858113a941c2118b3cdef9';
// Day-of-week (0=Sun) → Notion day page, copied from app/lib/dayTasks.ts DAY_PAGES.
// [STICKY] tasks only need one page write — the dashboard's cross-page scan finds
// them regardless of which day page they live on.
var TA_CUP_DAY_PAGES = {
  0: '3403c99c0e8581fa80d7ef629e63aa9c',
  1: '3403c99c0e858139bd34e9f3873dc7ef',
  2: '3403c99c0e858133bb31f63559b18716',
  3: '3403c99c0e85814fab17e09b32693999',
  4: '3403c99c0e8581a39fd1e3587887a1e0',
  5: '3403c99c0e858192bfa7d94c8189fe3c',
  6: '3403c99c0e8581b3a01dc82031df8f09',
};
var TA_CUP_AUDIT_SS_ID     = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI';
var TA_CUP_AUDIT_SHEET     = 'CUP_AUDIT';

var PK_COUNTER       = 'TA_CUP_COUNTER';
var PK_WATERMARK     = 'TA_CUP_WATERMARK';
var PK_START_DATE    = 'TA_CUP_START_DATE';
var PK_LOCATION_ID   = 'TA_CUP_LOCATION_ID';

function installTakeawayCupCounter() {
  var props = PropertiesService.getScriptProperties();

  if (!props.getProperty(PK_COUNTER))    props.setProperty(PK_COUNTER, '0');
  if (!props.getProperty(PK_START_DATE)) props.setProperty(PK_START_DATE, '2026-06-01T00:00:00+10:00');
  if (!props.getProperty(PK_WATERMARK))  props.setProperty(PK_WATERMARK, '2026-06-01T00:00:00+10:00');

  cacheSquareLocation_();
  ensureAuditSheet_();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runTakeawayCupCounter') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runTakeawayCupCounter')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  Logger.log('✓ Installed. Counter at %s, threshold %s, daily trigger set for 3am.',
             props.getProperty(PK_COUNTER), TA_CUP_THRESHOLD);
}

function resetTakeawayCupCounter() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date().toISOString();
  props.setProperty(PK_COUNTER, '0');
  props.setProperty(PK_WATERMARK, now);
  props.setProperty(PK_START_DATE, now);
  Logger.log('Counter reset. New start: %s', now);
}

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
    triggerDailyToDoNotice_(counter);
    var overflow = counter - TA_CUP_THRESHOLD;
    props.setProperty(PK_COUNTER, String(overflow));
    Logger.log('▲ Threshold hit. Notion item added. Counter rolled to overflow: %s', overflow);
  }
}

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

// Appends a [STICKY] "Planetware" task to today's Daily To Do under the ORDER
// heading — same shape as any other persistent pin (see STICKY_PREFIX_RE in
// dayTasks.ts), so it shows every day until ticked off, no expiry. The counter/
// date detail is stashed in the task's context field, not the title, so the row
// just reads "PLANETWARE" like Dench/Candied/Seven Seeds and renders as a
// tappable tel: link (SUPPLIER_LINKS['planetware'] in page.tsx).
function triggerDailyToDoNotice_(counter) {
  var key = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  if (!key) throw new Error('NOTION_API_KEY not set.');

  var startDate = (PropertiesService.getScriptProperties().getProperty(PK_START_DATE) || '').slice(0, 10);
  var contextText = counter.toLocaleString() + ' takeaway drinks sold since ' + startDate;

  var now = new Date();
  var todayStr = Utilities.formatDate(now, TA_CUP_TZ, 'yyyy-MM-dd');
  var pageId = TA_CUP_DAY_PAGES[now.getDay()];
  var content = '[STICKY:' + todayStr + '] Planetware';

  var blockId = insertStickyTask_(pageId, content, TA_CUP_CATEGORY, key);
  if (!blockId) {
    Logger.log('Daily To Do insert failed — no block id returned, context/audit skipped.');
    return;
  }
  setTaskContext_(blockId, contextText, key);
  appendAudit_(new Date(), counter, content + ' — ' + contextText);
}

// Insert a bulleted_list_item after the last existing item under `category`'s
// heading on `pageId` (falls back to appending at page end if the heading isn't
// found on that particular day page). Mirrors insertTaskBlock() in
// app/api/add-task/route.ts — keep both in sync if that logic changes.
function insertStickyTask_(pageId, content, category, key) {
  var children = getPageChildren_(pageId, key);

  var headingIndex = -1;
  for (var i = 0; i < children.length; i++) {
    var b = children[i];
    var isHeading = b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3';
    if (!isHeading) continue;
    var rich = (b[b.type] && b[b.type].rich_text) || [];
    var headingText = rich.map(function (r) { return r.plain_text; }).join('').trim();
    if (headingText.toUpperCase() === category.toUpperCase()) { headingIndex = i; break; }
  }

  var newBlock = {
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: content } }] }
  };

  var payload;
  if (headingIndex !== -1) {
    var insertAfterId = children[headingIndex].id;
    for (var j = headingIndex + 1; j < children.length; j++) {
      var blk = children[j];
      var isHead = blk.type === 'heading_1' || blk.type === 'heading_2' || blk.type === 'heading_3';
      if (isHead) break;
      insertAfterId = blk.id;
    }
    payload = { after: insertAfterId, children: [newBlock] };
  } else {
    payload = { children: [newBlock] };
  }

  var resp = UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + pageId + '/children', {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key, 'Notion-Version': '2022-06-28' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() >= 300) {
    Logger.log('Notion insert failed: %s %s', resp.getResponseCode(), resp.getContentText().slice(0, 400));
    return null;
  }
  var data = JSON.parse(resp.getContentText());
  return (data.results && data.results[0] && data.results[0].id) || null;
}

// Paginated fetch of a page's direct children.
function getPageChildren_(pageId, key) {
  var blocks = [];
  var cursor = null;
  do {
    var url = 'https://api.notion.com/v1/blocks/' + pageId + '/children?page_size=100' + (cursor ? '&start_cursor=' + cursor : '');
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + key, 'Notion-Version': '2022-06-28' },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) break;
    var data = JSON.parse(resp.getContentText());
    blocks = blocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return blocks;
}

// Writes { [blockId]: text } into the same JS-code-block context store that
// /api/task-context and /api/add-task use on the OS page — keeps the format
// identical so the app reads it back with no changes needed on that side.
function setTaskContext_(blockId, text, key) {
  var children = getPageChildren_(TA_CUP_OS_PAGE_ID, key);
  var codeBlock = null;
  for (var i = 0; i < children.length; i++) {
    var b = children[i];
    if (b.type === 'code' && b.code && b.code.language === 'javascript') { codeBlock = b; break; }
  }

  var context = {};
  var codeBlockId;
  if (codeBlock) {
    codeBlockId = codeBlock.id;
    var existing = (codeBlock.code.rich_text || []).map(function (r) { return r.plain_text; }).join('');
    try { context = JSON.parse(existing || '{}'); } catch (e) { context = {}; }
  } else {
    var createResp = UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + TA_CUP_OS_PAGE_ID + '/children', {
      method: 'patch',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + key, 'Notion-Version': '2022-06-28' },
      payload: JSON.stringify({ children: [{ type: 'code', code: { rich_text: [{ type: 'text', text: { content: '{}' } }], language: 'javascript' } }] }),
      muteHttpExceptions: true
    });
    var createData = JSON.parse(createResp.getContentText());
    codeBlockId = createData.results && createData.results[0] && createData.results[0].id;
    if (!codeBlockId) { Logger.log('Could not create/find task-context block.'); return; }
  }

  context[blockId] = text.trim();

  var patchResp = UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + codeBlockId, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key, 'Notion-Version': '2022-06-28' },
    payload: JSON.stringify({ code: { rich_text: [{ type: 'text', text: { content: JSON.stringify(context) } }], language: 'javascript' } }),
    muteHttpExceptions: true
  });
  if (patchResp.getResponseCode() >= 300) {
    Logger.log('Context write failed: %s %s', patchResp.getResponseCode(), patchResp.getContentText().slice(0, 400));
  }
}

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

function testTakeawayCupCounter() {
  var props = PropertiesService.getScriptProperties();
  var locationId = props.getProperty(PK_LOCATION_ID) || cacheSquareLocation_();

  var end = new Date();
  var start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  var n = countTakeawayCupsBetween_(locationId, start.toISOString(), end.toISOString());
  Logger.log('Last 7 days TA+LG cup count: %s', n);
  Logger.log('Current counter: %s / %s', props.getProperty(PK_COUNTER), TA_CUP_THRESHOLD);
  Logger.log('Watermark: %s', props.getProperty(PK_WATERMARK));
}