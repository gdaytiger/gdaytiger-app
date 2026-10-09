// ═══════════════════════════════════════════════════════════════════════════════
//  LabourWeekly.gs
//  Reads the payroll wage sheet ("Gross Staff Cost/Gross Sales= Staff Cost %")
//  and writes a `labour_weekly` JSON block to the TIGEROS Notion OS page, read by
//  /api/weekly-flash for the Weekly Flash labour scorecard.
//
//  WHY THE WAGE SHEET (not Deputy): it's the actual pay run. Deputy timesheet
//  cost ran 16–34% under payroll (Sep 2026 check) — it skips leave and super.
//
//  STANDARD BASIS (agreed Oct 2026):
//    labour cost = wages × (1 + SG)      SG = 12% (from 1 Jul 2025)
//    labour %    = labour cost ÷ NET sales (ex-GST, sheet col G)
//  Two figures:
//    line_pct  — line staff only (owner wage layer stripped). Benchmarked 34–38%.
//    total_pct — all wages incl owner wage. Context, not benchmarked.
//
//  The sheet's own Super column is computed at 9.5% (stale rate), so super is
//  RECOMPUTED here at 12% from the Wages column rather than read from col C.
//  The sheet's "less Jono" column (E) is used only to size the owner layer:
//    owner wages = (gross staff cost − less Jono) ÷ (1 + sheet super rate)
//
//  WEEK MAPPING: a sheet row dated Monday D covers the Mon–Sun week starting
//  D − 7 (verified against Square: row 28-Sep-2026 ≈ trading week 21–27 Sep).
//
//  Sheet columns (row 1–2 headers, data from row 3):
//    A Week ending | B Wages | C Super | D Gross staff cost | E less Jono
//    F Gross Sales | G Net Sales | H Staff cost% | I less Jono % | …
//
//  Runs nightly via runDailySalesUpdate() (SalesDaily.js). Manual: runLabourWeekly().
//  Diagnostic (no write): printLabourWeekly().
// ═══════════════════════════════════════════════════════════════════════════════

var LW_SHEET_ID   = '1PA0SoBVtVs582Daz6sIXF3HIznmgQnFHMuCGeCLqnp0';
var LW_SG_RATE    = 0.12;
var LW_KEEP_WEEKS = 12;
var LW_TZ         = 'Australia/Melbourne';

function runLabourWeekly() {
  var payload = lwBuild_();
  lwWriteToNotion_(payload);
  var w = payload.weeks[payload.weeks.length - 1];
  Logger.log('✓ labour_weekly: %s weeks, latest %s → %s | line %s%% total %s%%',
    payload.weeks.length, w ? w.start : '-', w ? w.end : '-', w ? w.line_pct : '-', w ? w.total_pct : '-');
}

function printLabourWeekly() {
  Logger.log(JSON.stringify(lwBuild_(), null, 2));
}

function lwNum_(v) {
  if (typeof v === 'number') return v;
  var n = parseFloat(String(v || '').replace(/[$,%\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function lwKey_(d) { return Utilities.formatDate(d, LW_TZ, 'yyyy-MM-dd'); }

function lwAddDays_(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

function lwRound_(n, dp) { var f = Math.pow(10, dp); return Math.round(n * f) / f; }

function lwBuild_() {
  var sheet = SpreadsheetApp.openById(LW_SHEET_ID).getSheets()[0];
  var rows = sheet.getRange(3, 1, Math.max(0, sheet.getLastRow() - 2), 7).getValues();

  var weeks = [];
  rows.forEach(function (r) {
    var label = r[0];
    if (!(label instanceof Date)) return;
    var wages = lwNum_(r[1]), superSheet = lwNum_(r[2]), gross = lwNum_(r[3]);
    var lessJono = lwNum_(r[4]), grossSales = lwNum_(r[5]), netSales = lwNum_(r[6]);
    // Skip future/blank weeks (pre-filled rows have no wages or sales).
    if (wages <= 0 || netSales <= 0) return;

    var sheetSuperRate = wages > 0 ? superSheet / wages : 0;
    var ownerLayer = Math.max(0, gross - lessJono);              // owner wages + sheet super
    var ownerWages = ownerLayer / (1 + sheetSuperRate);
    var lineWages = Math.max(0, wages - ownerWages);

    var lineCost = lineWages * (1 + LW_SG_RATE);
    var totalCost = wages * (1 + LW_SG_RATE);
    var start = lwAddDays_(label, -7);

    weeks.push({
      label: lwKey_(label),
      start: lwKey_(start),
      end: lwKey_(lwAddDays_(label, -1)),
      wages: lwRound_(wages, 2),
      line_wages: lwRound_(lineWages, 2),
      owner_wages: lwRound_(ownerWages, 2),
      line_cost: lwRound_(lineCost, 2),
      total_cost: lwRound_(totalCost, 2),
      gross_sales: lwRound_(grossSales, 2),
      net_sales: lwRound_(netSales, 2),
      line_pct: lwRound_(lineCost / netSales * 100, 1),
      total_pct: lwRound_(totalCost / netSales * 100, 1),
      sheet_super_rate: lwRound_(sheetSuperRate * 100, 1)
    });
  });

  weeks.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
  weeks = weeks.slice(-LW_KEEP_WEEKS);

  return {
    type: 'labour_weekly',
    updated: new Date().toISOString(),
    sg_rate: LW_SG_RATE,
    basis: 'wages + 12% super ÷ net sales ex-GST (payroll wage sheet)',
    weeks: weeks
  };
}

// Same upsert pattern as sdWriteToNotion_ (SalesDaily.js), keyed on "labour_weekly".
function lwWriteToNotion_(payload) {
  var key = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  if (!key) { Logger.log('LW: NOTION_API_KEY not set.'); return; }
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
    return text.indexOf('"labour_weekly"') !== -1;
  });

  var json = JSON.stringify(payload);
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
