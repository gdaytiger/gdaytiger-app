// ═══════════════════════════════════════════════════════════════════════════════
//  MorningBrief.gs
//  Runs ~4am daily. Pulls YESTERDAY's Square orders and writes a small
//  `morning_brief` JSON block to the TIGEROS Notion OS page, read by the app's
//  /api/push/morning cron (5am push) and the Morning card.
//
//  Block shape:
//    { type: 'morning_brief', updated, yesterday: { date, gross, orders, cash },
//      ly: { date, gross, orders } }      // ly = same weekday 52 weeks earlier
//
//  cash = CASH tenders on yesterday's completed orders, minus cash refunds on
//  those same orders. (A cash refund on an OLDER order isn't netted — rare.)
//
//  Separate file on purpose: touches nothing in SalesDaily.gs. Reuses its
//  helpers (sdCacheLocation_, sdAddDays_, sdDateKey_) and constants.
//
//  ── SETUP (one-off) ── select installMorningBrief → Run.
//  Diagnostic: printMorningBrief() logs the payload without writing.
// ═══════════════════════════════════════════════════════════════════════════════

var MB_BLOCK_TYPE = 'morning_brief';

function installMorningBrief() {
  sdDeleteTrigger_('runMorningBrief');
  ScriptApp.newTrigger('runMorningBrief').timeBased().everyDays(1).atHour(4).create();
  runMorningBrief();
  Logger.log('✓ MorningBrief installed — runs daily 4–5am. First run done now.');
}

function runMorningBrief() {
  mbWriteBlock_(MB_BLOCK_TYPE, mbBuild_());
}

function printMorningBrief() {
  Logger.log(JSON.stringify(mbBuild_(), null, 2));
}

function mbBuild_() {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var yStart = sdAddDays_(today, -1);
  var lyStart = sdAddDays_(yStart, -364);
  var y = mbDayTotals_(yStart, today);
  var ly = mbDayTotals_(lyStart, sdAddDays_(lyStart, 1));
  return {
    type: MB_BLOCK_TYPE,
    updated: new Date().toISOString(),
    yesterday: { date: sdDateKey_(yStart), gross: y.gross, orders: y.orders, cash: y.cash },
    ly: { date: sdDateKey_(lyStart), gross: ly.gross, orders: ly.orders }
  };
}

// One Melbourne day of COMPLETED orders → { gross (incl GST, excl tips), orders, cash } in dollars.
function mbDayTotals_(startInclusive, endExclusive) {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  var locationId = PropertiesService.getScriptProperties().getProperty(SD_PK_LOCATION) || sdCacheLocation_();
  var out = { gross: 0, orders: 0, cash: 0 };
  var cursor = null, safety = 0;
  do {
    var body = {
      location_ids: [locationId],
      query: { filter: {
        date_time_filter: { created_at: { start_at: startInclusive.toISOString(), end_at: endExclusive.toISOString() } },
        state_filter: { states: ['COMPLETED'] } } },
      limit: 500
    };
    if (cursor) body.cursor = cursor;
    var resp = UrlFetchApp.fetch('https://connect.squareup.com/v2/orders/search', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, 'Square-Version': '2024-06-04' },
      payload: JSON.stringify(body), muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) { Logger.log('MB Orders.search failed: ' + resp.getContentText().slice(0, 300)); break; }
    var json = JSON.parse(resp.getContentText());
    (json.orders || []).forEach(function (o) {
      var total = (o.total_money && o.total_money.amount) || 0;
      var tip = (o.total_tip_money && o.total_tip_money.amount) || 0;
      out.gross += (total - tip) / 100;
      out.orders += 1;
      var cashTenderIds = {};
      (o.tenders || []).forEach(function (t) {
        if (t.type === 'CASH') {
          cashTenderIds[t.id] = true;
          out.cash += ((t.amount_money && t.amount_money.amount) || 0) / 100;
        }
      });
      (o.refunds || []).forEach(function (r) {
        if (cashTenderIds[r.tender_id] && r.status !== 'REJECTED' && r.status !== 'FAILED') {
          out.cash -= ((r.amount_money && r.amount_money.amount) || 0) / 100;
        }
      });
    });
    cursor = json.cursor || null; safety++;
  } while (cursor && safety < 50);
  out.gross = Math.round(out.gross * 100) / 100;
  out.cash = Math.round(out.cash * 100) / 100;
  return out;
}

// Upsert a JSON code block on the OS page, matched by its "type" string.
function mbWriteBlock_(type, payload) {
  var key = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  var headers = { 'Authorization': 'Bearer ' + key, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
  var all = [], cursor = null;
  do {
    var url = 'https://api.notion.com/v1/blocks/' + SD_NOTION_PAGE_ID + '/children?page_size=100' + (cursor ? '&start_cursor=' + cursor : '');
    var data = JSON.parse(UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true }).getContentText());
    all = all.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  var needle = '"' + type + '"';
  var existing = all.find(function (b) {
    if (b.type !== 'code') return false;
    return (b.code.rich_text || []).map(function (r) { return r.plain_text; }).join('').indexOf(needle) !== -1;
  });
  var json = JSON.stringify(payload), chunks = [];
  for (var i = 0; i < json.length; i += 1900) chunks.push({ type: 'text', text: { content: json.slice(i, i + 1900) } });
  var block = { type: 'code', code: { language: 'json', rich_text: chunks } };
  if (existing) {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + existing.id, { method: 'PATCH', headers: headers, payload: JSON.stringify(block), muteHttpExceptions: true });
  } else {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + SD_NOTION_PAGE_ID + '/children', { method: 'PATCH', headers: headers, payload: JSON.stringify({ children: [block] }), muteHttpExceptions: true });
  }
}
