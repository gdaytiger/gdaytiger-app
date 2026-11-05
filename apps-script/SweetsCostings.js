/**
 * G'Day Tiger — Sweets Costings (bought-in cakes, cookies, muffins, slices)
 * Added: 2026-11-06
 *
 * Bought-in items have no recipe — cost is the invoice price ÷ portions per
 * unit (+ freight). One row per product lives on the SWEETS tab of the Food
 * Costings sheet; formulas work out cost/portion and GP%.
 *
 *   setupSweetsSheet()        — run ONCE: builds the SWEETS tab with today's
 *                                prices. Safe to re-run (won't overwrite).
 *   scanSweetsInvoices_()     — called hourly from scanAllSuppliers(). OCRs
 *                                only NEW Candied / Little Bertha / Dench PDFs
 *                                and updates PACK PRICE + LAST INVOICE.
 *   syncSweetsSquarePrices_() — pulls sell prices from Square into SELL PRICE.
 *   syncSweetsToNotion()      — called every 30 min from syncAllCostingsToNotion().
 *                                Pushes Cost / Sell / Profit % to Notion
 *                                (Category = Sweets), creating pages as needed.
 *   listSquareSweetCandidates() — diagnostic: logs Square items that look like
 *                                sweets, with variations + prices, to fix mapping.
 *
 * GP% here is EX-GST on both sides (cost ex GST ÷ sell ex GST) — the correct
 * margin for GST-taxable bought-in sweets. Bands: red <45%, amber 45–55%, green 55%+.
 */

var SWEETS_SS_ID   = '1nZvWNFaQTrJAt-ilYihZjYZKBzHd6x3qIrjFhdNQqAU';
var SWEETS_TAB     = 'SWEETS';
var SWEETS_HDR_ROW = 3;          // header row; data starts on row 4
var SWEETS_FIRST   = 4;
var SWEETS_DB_ID   = '8f16358a47e54062b5fe1ce7a7480754';
var SWEETS_CATEGORY = 'Sweets';
var SWEETS_MAX_JUMP = 0.40;      // skip (and log) invoice prices that move >40% in one go

// Column positions (1-based)
var SW = {
  ITEM: 1, SUPPLIER: 2, MATCH: 3, PACK: 4, INCL_GST: 5, PORTIONS: 6, FREIGHT: 7,
  COST: 8, SELL: 9, GP: 10, SQ_ITEM: 11, SQ_VAR: 12, LAST_INV: 13, STATUS: 14,
};
var SWEETS_HEADERS = [
  'ITEM (NOTION NAME)', 'SUPPLIER', 'INVOICE MATCH (regex)', 'PACK PRICE (AS INVOICED)',
  'PRICE INCL GST? (Y/N)', 'PORTIONS PER PACK', 'FREIGHT %', 'COST / PORTION (EX GST)',
  'SELL PRICE (INC GST)', 'GP % (EX GST)', 'SQUARE ITEM', 'SQUARE VARIATION', 'LAST INVOICE', 'STATUS',
];

// Seed rows — prices from invoices as at 6 Nov 2026; sell prices as set 6 Nov 2026.
// [item, supplier, match, pack, inclGst, portions, freight%, sell, squareItem, squareVariation, lastInvoice]
var SWEETS_SEED = [
  ['COOKIE (MARSHY)',          'Candied Bakery', 'Choc Marshmallow',        2.75,  'Y', 1,  0, 5.50,  'Cookie',  'Marsh',  '2026-11-05'],
  ['BROWNIE',                  'Candied Bakery', 'Brownie SLAB',            55.00, 'Y', 20, 0, 6.50,  'Brownie', '',       '2026-11-05'],
  ['CAKE (CARROT)',            'Candied Bakery', 'Carrot Cakes?(?!\\s*logs)(?:\\s*slices)?', 4.20, 'Y', 1, 0, 8.50, 'Cake', 'Carrot Cake', '2026-11-05'],
  ['CAKE (MAPLE PECAN SLICE)', 'Candied Bakery', 'Maple Pecan',             3.40,  'Y', 1,  0, 7.00,  'Cake',    'Maple Pecan', '2026-11-05'],
  ['CANDIED PIE',              'Candied Bakery', 'Candied Pie',             45.45, 'Y', 8,  0, 10.00, 'Pie',     '',       '2026-11-05'],
  ['MUFFIN',                   'Little Bertha',  'Muffins',                 21.63, 'N', 6,  6, 6.50,  'Muffin',  'Raspberry', '2026-11-04'],
  ['GRANOLA BAR',              'Little Bertha',  'Granola Bar',             24.04, 'N', 6,  6, 6.50,  'Granola Bar', '',   '2026-11-04'],
  ['FRIAND (BLACKBERRY)',      'Dench',          'Blackberry Friand',       20.43, 'N', 6,  0, 6.50,  'Friand',  '',       '2026-11-04'],
];

// Supplier → Drive folder (by name, inside "Supplier Invoices", same as the
// SIMPLE_DRIVE_SUPPLIERS pattern) or fixed folder ID.
var SWEETS_SUPPLIERS = [
  { name: 'Candied Bakery', folderName: 'Candied Bakery', filter: /INV-|Invoice/i },
  { name: 'Little Bertha',  folderName: 'Little Bertha',  filter: /Invoice/i },
  { name: 'Dench',          folderId: '1Kes-5QAHFTHZi_dL__BcasZbVWKvSOcX', filter: /Invoice/i },
];

// ─── SETUP ────────────────────────────────────────────────────────────────────

function setupSweetsSheet() {
  var ss = SpreadsheetApp.openById(SWEETS_SS_ID);
  var sh = ss.getSheetByName(SWEETS_TAB);
  if (sh && sh.getLastRow() >= SWEETS_FIRST) {
    Logger.log('SWEETS tab already has data — not overwriting. Delete the tab to rebuild.');
    return;
  }
  if (!sh) sh = ss.insertSheet(SWEETS_TAB);

  sh.getRange(1, 1).setValue('SWEETS — BOUGHT-IN COSTINGS').setFontWeight('bold').setFontSize(14);
  sh.getRange(2, 1).setValue('Pack price auto-updates from Candied / Little Bertha / Dench invoices. ' +
    'Sell price auto-updates from Square. Edit PORTIONS / FREIGHT % by hand. GP is ex-GST. ' +
    'Bands: red <45%, amber 45–55%, green 55%+.').setFontStyle('italic');
  sh.getRange(SWEETS_HDR_ROW, 1, 1, SWEETS_HEADERS.length).setValues([SWEETS_HEADERS])
    .setFontWeight('bold').setBackground('#f3f3f3');

  for (var i = 0; i < SWEETS_SEED.length; i++) {
    var r = SWEETS_FIRST + i, s = SWEETS_SEED[i];
    sh.getRange(r, SW.ITEM, 1, 7).setValues([[s[0], s[1], s[2], s[3], s[4], s[5], s[6]]]);
    sh.getRange(r, SW.SELL).setValue(s[7]);
    sh.getRange(r, SW.SQ_ITEM, 1, 3).setValues([[s[8], s[9], s[10]]]);
    writeSweetsFormulas_(sh, r);
  }
  formatSweetsSheet_(sh);
  SpreadsheetApp.flush();
  Logger.log('SWEETS tab created with ' + SWEETS_SEED.length + ' rows.');
}

function writeSweetsFormulas_(sh, r) {
  var A = function (col) { return sh.getRange(r, col).getA1Notation(); };
  sh.getRange(r, SW.COST).setFormula(
    '=IF(OR(' + A(SW.PACK) + '="",' + A(SW.PORTIONS) + '=""),"",' +
    'ROUND(IF(UPPER(' + A(SW.INCL_GST) + ')="Y",' + A(SW.PACK) + '/1.1,' + A(SW.PACK) + ')/' +
    A(SW.PORTIONS) + '*(1+N(' + A(SW.FREIGHT) + ')/100),4))');
  sh.getRange(r, SW.GP).setFormula(
    '=IF(OR(' + A(SW.COST) + '="",' + A(SW.SELL) + '=""),"",ROUND((1-' + A(SW.COST) + '/(' + A(SW.SELL) + '/1.1))*100,1))');
  sh.getRange(r, SW.STATUS).setFormula(
    '=IF(' + A(SW.GP) + '="","UNCOSTED",IF(' + A(SW.GP) + '<45,"RED",IF(' + A(SW.GP) + '<55,"AMBER","GREEN")))');
}

function formatSweetsSheet_(sh) {
  var n = Math.max(sh.getLastRow() - SWEETS_FIRST + 1, 1);
  sh.getRange(SWEETS_FIRST, SW.PACK, n, 1).setNumberFormat('$0.00');
  sh.getRange(SWEETS_FIRST, SW.COST, n, 1).setNumberFormat('$0.00');
  sh.getRange(SWEETS_FIRST, SW.SELL, n, 1).setNumberFormat('$0.00');
  sh.getRange(SWEETS_FIRST, SW.GP, n, 1).setNumberFormat('0.0');
  sh.setFrozenRows(SWEETS_HDR_ROW);
  sh.autoResizeColumns(1, SWEETS_HEADERS.length);
}

function readSweetsRows_() {
  var sh = SpreadsheetApp.openById(SWEETS_SS_ID).getSheetByName(SWEETS_TAB);
  if (!sh) return { sheet: null, rows: [] };
  var last = sh.getLastRow();
  if (last < SWEETS_FIRST) return { sheet: sh, rows: [] };
  var vals = sh.getRange(SWEETS_FIRST, 1, last - SWEETS_FIRST + 1, SWEETS_HEADERS.length).getValues();
  var rows = [];
  vals.forEach(function (v, i) {
    var name = String(v[SW.ITEM - 1] || '').trim();
    if (!name) return;
    var num = function (x) { return (x === '' || x === null || isNaN(x)) ? null : Number(x); };
    rows.push({
      row: SWEETS_FIRST + i, name: name,
      supplier: String(v[SW.SUPPLIER - 1] || '').trim(),
      match:    String(v[SW.MATCH - 1] || '').trim(),
      pack: num(v[SW.PACK - 1]), cost: num(v[SW.COST - 1]), sell: num(v[SW.SELL - 1]), gp: num(v[SW.GP - 1]),
      squareItem: String(v[SW.SQ_ITEM - 1] || '').trim(), squareVar: String(v[SW.SQ_VAR - 1] || '').trim(),
      lastInv: v[SW.LAST_INV - 1],
    });
  });
  return { sheet: sh, rows: rows };
}

// ─── INVOICE SCANNER ──────────────────────────────────────────────────────────
// Tracks which PDFs it has already read (Script Property SWEETS_SEEN) so each
// invoice is OCR'd once. Processes oldest → newest so the latest price wins.

function scanSweetsInvoices_(log) {
  log = log || [];
  var data = readSweetsRows_();
  if (!data.sheet) { log.push('[Sweets] SWEETS tab missing — run setupSweetsSheet()'); return 0; }

  var props = PropertiesService.getScriptProperties();
  var seen = {};
  try { (JSON.parse(props.getProperty('SWEETS_SEEN') || '[]')).forEach(function (id) { seen[id] = 1; }); } catch (e) {}
  var cutoff = new Date(Date.now() - 45 * 86400000);
  var updates = 0, newlySeen = [];

  SWEETS_SUPPLIERS.forEach(function (sup) {
    var rows = data.rows.filter(function (r) { return r.supplier === sup.name && r.match; });
    if (!rows.length) return;
    var folder = null;
    try {
      if (sup.folderId) folder = DriveApp.getFolderById(sup.folderId);
      else {
        var root = getDriveFolder_(DRIVE_ROOT_FOLDER);
        folder = root ? getFolderByName_(root, sup.folderName) : null;
      }
    } catch (e) { log.push('[Sweets/' + sup.name + '] folder error: ' + e.message); return; }
    if (!folder) { log.push('[Sweets/' + sup.name + '] folder not found'); return; }

    var pdfs = getRecentPDFs_(folder, cutoff)
      .filter(function (f) { return !seen[f.getId()] && sup.filter.test(f.getName()); })
      .sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });   // names start YYYY-MM-DD
    if (!pdfs.length) { log.push('[Sweets/' + sup.name + '] no new invoices'); return; }

    pdfs.forEach(function (pdf) {
      var text = extractPdfText(pdf.getId());
      newlySeen.push(pdf.getId());
      if (!text) return;
      var flat = text.replace(/\s+/g, ' ');
      var invDate = (pdf.getName().match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
      rows.forEach(function (r) {
        var unit = sweetsExtractUnitPrice_(flat, r.match);
        if (unit === null) return;
        var old = r.pack;
        if (old && Math.abs(unit - old) / old > SWEETS_MAX_JUMP) {
          log.push('[Sweets] ⚠ ' + r.name + ' $' + old + ' → $' + unit + ' (>' + (SWEETS_MAX_JUMP * 100) +
            '% jump) in ' + pdf.getName() + ' — NOT applied, check pack size');
          return;
        }
        if (old === null || Math.abs(unit - old) >= 0.005) {
          data.sheet.getRange(r.row, SW.PACK).setValue(unit);
          log.push('[Sweets] ' + r.name + ' $' + (old === null ? '—' : old) + ' → $' + unit + ' (' + pdf.getName() + ')');
          r.pack = unit; updates++;
        }
        if (invDate) data.sheet.getRange(r.row, SW.LAST_INV).setValue(invDate);
      });
    });
  });

  if (newlySeen.length) {
    var all = Object.keys(seen).concat(newlySeen).slice(-400);
    props.setProperty('SWEETS_SEEN', JSON.stringify(all));
  }
  SpreadsheetApp.flush();
  return updates;
}

// Xero-style invoice line: "<desc> <qty> <unit> [disc%] [tax%] <amount>".
// Returns amount ÷ qty (so supplier discounts are baked in), or null.
function sweetsExtractUnitPrice_(flatText, matchSrc) {
  var re;
  try {
    re = new RegExp('(?:' + matchSrc + ')[^$]{0,60}?\\s(\\d+(?:\\.\\d+)?)\\s(\\d+\\.\\d{2})\\s(?:\\d+(?:\\.\\d+)?%\\s)*(\\d[\\d,]*\\.\\d{2})', 'ig');
  } catch (e) { return null; }
  var m, best = null;
  while ((m = re.exec(flatText)) !== null) {
    var qty = parseFloat(m[1]), unit = parseFloat(m[2]), amount = parseFloat(m[3].replace(/,/g, ''));
    if (!(qty > 0) || !(amount > 0)) continue;                 // skip NO CHARGE lines
    var perUnit = Math.round(amount / qty * 100) / 100;
    if (Math.abs(perUnit - unit) / unit > 0.25) continue;      // misparse guard (discount is ~3.5%)
    best = perUnit;                                            // first valid line wins
    break;
  }
  return best;
}

// Re-read the last 45 days of sweets invoices (after a parser change).
function rescanSweetsInvoices() {
  PropertiesService.getScriptProperties().deleteProperty('SWEETS_SEEN');
  var log = [];
  var n = scanSweetsInvoices_(log);
  Logger.log(log.join('\n') + '\n' + n + ' sweets price(s) updated');
}

// ─── SQUARE SELL PRICES ───────────────────────────────────────────────────────

function syncSweetsSquarePrices_(log) {
  log = log || [];
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  if (!token) { log.push('[Sweets/Square] SQUARE_ACCESS_TOKEN not set'); return 0; }
  var data = readSweetsRows_();
  if (!data.sheet) return 0;
  var items = squareFetchAllItems_(token, log);
  if (!items) return 0;
  var updates = 0;
  data.rows.forEach(function (r) {
    if (!r.squareItem) return;
    var item = sweetsFindSquareItem_(items, r.squareItem, r.squareVar);
    if (!item) { log.push('[Sweets/Square] not found: ' + r.name + ' (Square "' + r.squareItem + '")'); return; }
    var cents = sweetsVariationPrice_(item, r.squareVar);
    if (cents === null) { log.push('[Sweets/Square] no price: ' + r.name); return; }
    var price = Math.round(cents) / 100;
    if (r.sell === null || Math.abs(price - r.sell) >= 0.005) {
      data.sheet.getRange(r.row, SW.SELL).setValue(price);
      log.push('[Sweets/Square] ' + r.name + ' sell $' + (r.sell === null ? '—' : r.sell) + ' → $' + price);
      updates++;
    }
  });
  SpreadsheetApp.flush();
  return updates;
}

// Exact name first, then an item whose name contains the target and (if a
// variation is given) has that variation, then any contains-match.
function sweetsFindSquareItem_(items, target, variation) {
  var T = target.toUpperCase(), V = (variation || '').toUpperCase();
  var nameOf = function (o) { return (o.item_data && o.item_data.name || '').toUpperCase().trim(); };
  var hasVar = function (o) {
    if (!V) return true;
    return ((o.item_data && o.item_data.variations) || []).some(function (v) {
      return (v.item_variation_data && v.item_variation_data.name || '').toUpperCase().indexOf(V) !== -1;
    });
  };
  var exact = items.filter(function (o) { return nameOf(o) === T && hasVar(o); });
  if (exact.length) return exact[0];
  var contains = items.filter(function (o) { return nameOf(o).indexOf(T) !== -1 && hasVar(o); });
  if (contains.length) return contains[0];
  // Variation baked into the item name, e.g. "Carrot Cake"
  if (V) {
    var both = items.filter(function (o) { var n = nameOf(o); return n.indexOf(T) !== -1 && n.indexOf(V) !== -1; });
    if (both.length) return both[0];
  }
  return null;
}

function sweetsVariationPrice_(item, variation) {
  var vars = (item.item_data && item.item_data.variations) || [];
  if (!vars.length) return null;
  var V = (variation || '').toUpperCase(), chosen = null;
  if (V) chosen = vars.filter(function (v) {
    return (v.item_variation_data && v.item_variation_data.name || '').toUpperCase().indexOf(V) !== -1;
  })[0] || null;
  chosen = chosen || vars[0];
  var pm = chosen.item_variation_data && chosen.item_variation_data.price_money;
  return pm ? pm.amount : null;
}

function listSquareSweetCandidates() {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  var log = [];
  var items = squareFetchAllItems_(token, log) || [];
  var kw = /cookie|brownie|cake|slice|pie|muffin|granola|friand|tart|scroll|biscuit|danish|croissant/i;
  items.forEach(function (o) {
    var name = o.item_data && o.item_data.name || '';
    if (!kw.test(name)) return;
    var vars = ((o.item_data && o.item_data.variations) || []).map(function (v) {
      var d = v.item_variation_data || {};
      return (d.name || '?') + ' $' + (d.price_money ? (d.price_money.amount / 100).toFixed(2) : '—');
    });
    log.push(name + '  →  ' + vars.join(' | '));
  });
  Logger.log(log.join('\n') || '(no matches)');
}

// ─── NOTION SYNC ──────────────────────────────────────────────────────────────

function syncSweetsToNotion() {
  var key = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  if (!key) throw new Error('NOTION_API_KEY not set.');
  var log = [];
  try { syncSweetsSquarePrices_(log); } catch (e) { log.push('[Sweets/Square] error: ' + e.message); }

  var data = readSweetsRows_();
  if (!data.sheet) return 'Sweets sync: SWEETS tab missing — run setupSweetsSheet()';

  // Notion pages in Sweets OR Food (bought-in pages moved across on first run).
  var pages = sweetsNotionPages_(key);
  var updated = [], created = [], skipped = [];

  data.rows.forEach(function (r) {
    var page = pages[r.name.toUpperCase()];
    var props = { 'Category': { select: { name: SWEETS_CATEGORY } } };
    if (r.sell !== null) props['Sell Price'] = { number: Math.round(r.sell * 100) / 100 };
    if (r.cost !== null) props['Cost'] = { number: Math.round(r.cost * 100) / 100 };
    if (r.gp !== null)   props['Profit %'] = { number: Math.round(r.gp * 10) / 10 };

    if (!page) {
      props['Name'] = { title: [{ text: { content: r.name } }] };
      var res = sweetsNotion_('post', 'pages', key, { parent: { database_id: SWEETS_DB_ID }, properties: props });
      (res.object === 'error') ? skipped.push(r.name + ': ' + res.message) : created.push(r.name);
      Utilities.sleep(300);
      return;
    }

    var sameCat  = page.category === SWEETS_CATEGORY;
    var sameSell = r.sell === null || (page.sell !== null && Math.abs(page.sell - r.sell) < 0.005);
    var sameCost = r.cost === null || (page.cost !== null && Math.abs(page.cost - r.cost) < 0.005);
    var samePct  = r.gp === null   || (page.pct  !== null && Math.abs(page.pct - r.gp) < 0.05);
    if (sameCat && sameSell && sameCost && samePct) return;
    if (!samePct && page.pct !== null) {
      props['Prev Profit %']  = { number: Math.round(page.pct * 10) / 10 };
      props['Profit Changed'] = { date: { start: new Date().toISOString() } };
    }
    var up = sweetsNotion_('patch', 'pages/' + page.id, key, { properties: props });
    if (up.object === 'error') skipped.push(r.name + ': ' + up.message);
    else updated.push(r.name + (r.gp !== null ? ' ' + r.gp.toFixed(1) + '%' : ' (uncosted)'));
    Utilities.sleep(300);
  });

  var summary = ['Sweets sync: ' + new Date().toLocaleString('en-AU'),
    'UPDATED (' + updated.length + '): ' + (updated.join(', ') || 'none'),
    'CREATED (' + created.length + '): ' + (created.join(', ') || 'none'),
    'ERRORS (' + skipped.length + '): ' + (skipped.join('; ') || 'none')].concat(log).join('\n');
  Logger.log(summary);
  return summary;
}

function sweetsNotionPages_(key) {
  var out = {}, cursor = null;
  do {
    var body = { page_size: 100, filter: { or: [
      { property: 'Category', select: { equals: SWEETS_CATEGORY } },
      { property: 'Category', select: { equals: 'Food' } },
    ] } };
    if (cursor) body.start_cursor = cursor;
    var d = sweetsNotion_('post', 'databases/' + SWEETS_DB_ID + '/query', key, body);
    if (d.object === 'error') throw new Error('Notion query error: ' + d.message);
    (d.results || []).forEach(function (p) {
      var t = p.properties.Name && p.properties.Name.title && p.properties.Name.title[0];
      if (!t) return;
      var num = function (k) { return p.properties[k] && p.properties[k].number != null ? p.properties[k].number : null; };
      out[t.plain_text.toUpperCase().trim()] = {
        id: p.id, category: p.properties.Category && p.properties.Category.select ? p.properties.Category.select.name : '',
        sell: num('Sell Price'), cost: num('Cost'), pct: num('Profit %'),
      };
    });
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);
  return out;
}

function sweetsNotion_(method, path, key, body) {
  var res = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, {
    method: method, muteHttpExceptions: true,
    headers: { 'Authorization': 'Bearer ' + key, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    payload: body ? JSON.stringify(body) : undefined,
  });
  return JSON.parse(res.getContentText());
}

// One-shot convenience: build the tab (if needed), scan, push to Notion.
function runSweetsSetupAndSync() {
  setupSweetsSheet();
  var log = [];
  scanSweetsInvoices_(log);
  Logger.log(log.join('\n'));
  Logger.log(syncSweetsToNotion());
}
