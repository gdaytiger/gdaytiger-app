// ─────────────────────────────────────────────────────────────────────────────
// AddIngredient.js — Supplier Prices "+" feature
//
// Two capabilities, both reached via the shared doPost web app (AddProduct.js),
// routed on payload.action:
//   • 'searchInvoices'      → searchInvoicesForItem_(query)  — find a price for a
//                             keyword (e.g. "bacon") across recent invoice PDFs.
//   • 'addCustomIngredient' → addCustomIngredient_(payload)  — write the chosen
//                             item to a dynamic CustomIngredients tab so it flows
//                             to Notion → the app's Supplier Prices card.
//
// Relies on globals defined in ScanSuppliers.js (same Apps Script project):
//   FOLDER_* ids, SS_FOOD, getSortedPdfs(), extractPdfText().
// Referenced inside function bodies only (never at top level) to avoid
// const-initialisation-order issues across files.
// ─────────────────────────────────────────────────────────────────────────────

var CUSTOM_INGREDIENTS_TAB = 'CustomIngredients';
var INVOICE_CACHE_TAB      = 'InvoiceTextCache';   // in the FOOD spreadsheet

// ── READ-ONLY DIAGNOSTIC ─────────────────────────────────────────────────────
// Dumps the top of the FOOD and COFFEE sheets so we can see exactly which column
// each category lives in before writing custom ingredients into them. Run from
// the editor, then paste the execution log. Changes nothing.
function dumpCostingsLayout() {
  function colLetter(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  var out = [];
  [['FOOD', SS_FOOD, SHEET_FOOD], ['COFFEE', SS_COFFEE, SHEET_COFFEE]].forEach(function (s) {
    out.push('=== ' + s[0] + ' SHEET ===');
    var sheet;
    try { sheet = SpreadsheetApp.openById(s[1]).getSheetByName(s[2]); } catch (e) { out.push('  open error: ' + e.message); return; }
    if (!sheet) { out.push('  (sheet "' + s[2] + '" not found)'); return; }
    var rows = Math.min(7, sheet.getLastRow());
    var cols = Math.min(22, sheet.getLastColumn());
    var vals = sheet.getRange(1, 1, rows, cols).getValues();
    for (var r = 0; r < vals.length; r++) {
      var cells = [];
      for (var c = 0; c < vals[r].length; c++) {
        var v = vals[r][c];
        if (v !== '' && v !== null) cells.push(colLetter(c + 1) + (r + 1) + '="' + String(v).slice(0, 28) + '"');
      }
      if (cells.length) out.push('  ' + cells.join('  '));
    }
  });
  var text = out.join('\n');
  Logger.log(text);
  return text;
}

// Supplier folders to index/search. Built at call time (not top level) so the
// FOLDER_* globals from ScanSuppliers.js are guaranteed initialised.
function igSupplierFolders_() {
  return [
    { id: FOLDER_5WAYS,       supplier: '5Ways' },
    { id: FOLDER_SCICLUNAS,   supplier: 'Sciclunas' },
    { id: FOLDER_UNCLES,      supplier: "Uncle's" },
    { id: FOLDER_WOOLWORTHS,  supplier: 'Woolworths' },
    { id: FOLDER_DENCH,       supplier: 'Dench' },
    { id: FOLDER_SEVEN_SEEDS, supplier: 'Seven Seeds' },
    { id: FOLDER_MORK,        supplier: 'Mörk' },
    { id: FOLDER_MATSU,       supplier: 'Matsu Tea' },
    { id: FOLDER_REDI_MILK,   supplier: 'Redi Milk' },
    { id: FOLDER_PLANETWARE,  supplier: 'Planetware' }
  ];
}

function igGetCacheSheet_() {
  var ss = SpreadsheetApp.openById(SS_FOOD);
  var sheet = ss.getSheetByName(INVOICE_CACHE_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(INVOICE_CACHE_TAB);
    sheet.appendRow(['fileId', 'supplier', 'fileName', 'date', 'text']);
  }
  return sheet;
}

// ── INVOICE CACHE BUILDER ────────────────────────────────────────────────────
// OCR is slow (~3-6s/file), far too slow to run live on a web request. So we
// pre-extract invoice text into the InvoiceTextCache tab and let search grep it.
// Incremental: only OCRs PDFs not already cached, so the daily run is cheap and
// the one-off backfill can be re-run if it hits the 6-minute editor limit.
// Set up the daily refresh with createInvoiceCacheTrigger().
function rebuildInvoiceTextCache() {
  var sheet = igGetCacheSheet_();
  var data = sheet.getDataRange().getValues();
  var existing = {};
  for (var r = 1; r < data.length; r++) existing[String(data[r][0])] = true;

  var cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  var added = 0, skipped = 0;

  igSupplierFolders_().forEach(function (f) {
    if (!f.id) return;
    var pdfs;
    try { pdfs = getSortedPdfs(f.id, '', cutoff); } catch (e) { return; }
    pdfs.forEach(function (file) {
      var id = file.getId();
      if (existing[id]) { skipped++; return; }
      var text;
      try { text = extractPdfText(id); } catch (e) { text = ''; }
      if (!text) return;
      sheet.appendRow([
        id, f.supplier, file.getName(),
        file.getLastUpdated().toISOString().slice(0, 10),
        text.slice(0, 48000)  // stay under the 50k cell limit
      ]);
      existing[id] = true;
      added++;
    });
  });
  Logger.log('Invoice cache: +' + added + ' new, ' + skipped + ' already cached');
  return { ok: true, added: added, skipped: skipped };
}

// Run once to schedule the daily cache refresh (4am).
function createInvoiceCacheTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'rebuildInvoiceTextCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rebuildInvoiceTextCache').timeBased().everyDays(1).atHour(4).create();
  return { ok: true };
}

// ── INVOICE SEARCH ───────────────────────────────────────────────────────────
// Greps the cached invoice text for the keyword. Fast (no OCR), so it fits well
// inside the web request timeout. Returns up to 15 candidate matches, newest
// first: { supplier, file, date, line, prices:[..], suggestedPrice }
function searchInvoicesForItem_(query) {
  var q = (query || '').toString().trim().toLowerCase();
  if (q.length < 2) return { ok: false, error: 'enter at least 2 characters' };

  var sheet;
  try { sheet = igGetCacheSheet_(); } catch (e) { return { ok: false, error: 'invoice cache unavailable: ' + e.message }; }
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { ok: true, query: q, count: 0, matches: [], note: 'invoice cache is empty — run rebuildInvoiceTextCache() once' };
  }

  var matches = [];
  for (var r = 1; r < data.length; r++) {
    var supplier = String(data[r][1] || 'Other');
    var fileName = String(data[r][2] || '');
    var rawDate  = data[r][3];
    var date     = (rawDate instanceof Date)
      ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(rawDate || '');
    var text     = String(data[r][4] || '');
    if (text.toLowerCase().indexOf(q) === -1) continue;
    text.split(/[\r\n]+/).forEach(function (line) {
      var lower = line.toLowerCase();
      var kwPos = lower.indexOf(q);
      if (kwPos === -1) return;

      // Collect money values with their positions in the line.
      var re = /\d+(?:,\d{3})*\.\d{2}(?!\d)/g, m, all = [];
      while ((m = re.exec(line)) !== null) {
        var val = parseFloat(m[0].replace(/,/g, ''));
        if (val > 0.1 && val < 100000) all.push({ val: val, pos: m.index });
      }
      if (all.length === 0) return;

      // Suggest the price nearest the keyword: the first money value AFTER it
      // (receipt lines read "<item> <price>"). This is what makes merged-line
      // receipts (e.g. Woolworths, many items per line) pick the right price
      // instead of the first item's price on the line. Fall back to the closest
      // value before the keyword, then to the first value.
      var after = all.filter(function (a) { return a.pos > kwPos; });
      var chosen;
      if (after.length) {
        chosen = after[0];
      } else {
        var before = all.filter(function (a) { return a.pos < kwPos; });
        chosen = before.length ? before[before.length - 1] : all[0];
      }

      // Pack size / weight sits between the item name and its price, e.g.
      // "Streaky Bacon 500g 16.25". Pull the first size token in that gap.
      var unitSeg = line.substring(kwPos, chosen.pos > kwPos ? chosen.pos : line.length);
      var um = unitSeg.match(/(\d+(?:\.\d+)?)\s?(kg|g|ml|l|oz|lb|pk|pack|doz|dozen|tin|jar|drum|box|loaf|bunch|slices|sl|each|ea)\b/i);
      var suggestedUnit = um ? (um[1] + um[2]).toLowerCase() : '';

      matches.push({
        supplier: supplier,
        file: fileName,
        date: date,
        line: line.trim().slice(0, 160),
        prices: all.map(function (a) { return a.val; }),
        suggestedPrice: chosen.val,
        suggestedUnit: suggestedUnit
      });
    });
  }

  matches.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  return { ok: true, query: q, count: matches.length, matches: matches.slice(0, 15) };
}

// ── CUSTOM INGREDIENT STORE ──────────────────────────────────────────────────
// Custom ingredients are written straight into the FOOD/COFFEE costing sheet's
// category columns (label col + its PRICE col), so they sit alongside the
// existing ingredients and look identical. A small registry tab records WHERE
// each one was written so the price sync can read its live value from the cell.
//
// Sheet layout (confirmed via dumpCostingsLayout):
//   Header row 3 holds the category names; each category = a label column
//   immediately followed by its "PRICE" column. Data starts at row 5.
//   FOOD:   Bread, Meats, Cheese, Vegetables, Sauces, Made in House, Extras,
//           Packaging, Pantry
//   COFFEE: Coffee, Milks, Extras, Packaging, Made in House
var COSTINGS_HEADER_ROW     = 3;
var COSTINGS_DATA_START_ROW = 5;

function igCategorySheet_(type) {
  if (type === 'coffee') return SpreadsheetApp.openById(SS_COFFEE).getSheetByName(SHEET_COFFEE);
  return SpreadsheetApp.openById(SS_FOOD).getSheetByName(SHEET_FOOD);
}

// Resolve a category to its {labelCol, priceCol} by scanning the header row, so
// it self-adjusts if columns ever move. Handles MILK ↔ MILKS.
function igFindCategoryCols_(sheet, category) {
  var want = String(category || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (want === 'MILK') want = 'MILKS';
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(COSTINGS_HEADER_ROW, 1, 1, lastCol).getValues()[0];
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (h === want) return { labelCol: c + 1, priceCol: c + 2 };
  }
  return null;
}

function igNextEmptyRow_(sheet, labelCol) {
  var last = Math.max(sheet.getLastRow(), COSTINGS_DATA_START_ROW);
  var vals = sheet.getRange(COSTINGS_DATA_START_ROW, labelCol, last - COSTINGS_DATA_START_ROW + 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === '') return COSTINGS_DATA_START_ROW + i;
  }
  return last + 1;
}

// Registry tab in the FOOD spreadsheet. Records each app-added ingredient and
// where it lives, so the sync reads its live price from the sheet cell.
//   key | name | unit | supplier | type | category | priceCol | row | dateAdded
function igGetRegistry_() {
  var ss = SpreadsheetApp.openById(SS_FOOD);
  var sheet = ss.getSheetByName(CUSTOM_INGREDIENTS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(CUSTOM_INGREDIENTS_TAB);
    sheet.appendRow(['key', 'name', 'unit', 'supplier', 'type', 'category', 'priceCol', 'row', 'dateAdded']);
  }
  return sheet;
}

function addCustomIngredient_(payload) {
  payload = payload || {};
  var name = (payload.name || '').toString().trim();
  if (!name) return { ok: false, error: 'name required' };
  var price = Number(payload.price);
  if (!isFinite(price) || price <= 0) return { ok: false, error: 'a valid positive price is required' };

  var unit     = (payload.unit || '').toString().trim();
  var supplier = (payload.supplier || 'Other').toString().trim() || 'Other';
  var type     = (payload.type || 'food').toString().toLowerCase();
  if (type !== 'food' && type !== 'coffee') type = 'food';
  var category = (payload.category || '').toString().trim();
  if (!category) return { ok: false, error: 'category required' };

  var sheet = igCategorySheet_(type);
  if (!sheet) return { ok: false, error: type + ' sheet not found' };
  var cols = igFindCategoryCols_(sheet, category);
  if (!cols) return { ok: false, error: 'category "' + category + '" not found in the ' + type + ' sheet' };

  var key = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (key === 'custom_') return { ok: false, error: 'name must contain letters or numbers' };

  var reg = igGetRegistry_();
  var regData = reg.getDataRange().getValues();
  for (var r = 1; r < regData.length; r++) {
    if (String(regData[r][0]).trim() === key) return { ok: false, error: 'an ingredient like "' + name + '" already exists' };
  }

  var row = igNextEmptyRow_(sheet, cols.labelCol);

  // Match the sheet convention: UPPERCASE "NAME (UNIT)".
  var label = (unit ? name + ' (' + unit + ')' : name).toUpperCase();

  // Copy formatting from the row above so it looks like the existing rows.
  if (row > COSTINGS_DATA_START_ROW) {
    sheet.getRange(row - 1, cols.labelCol).copyTo(sheet.getRange(row, cols.labelCol), { formatOnly: true });
    sheet.getRange(row - 1, cols.priceCol).copyTo(sheet.getRange(row, cols.priceCol), { formatOnly: true });
  }
  sheet.getRange(row, cols.labelCol).setValue(label);
  sheet.getRange(row, cols.priceCol).setValue(price);

  reg.appendRow([key, name, unit || 'unit', supplier, type, category, cols.priceCol, row, new Date()]);

  // If this was added from a "NEW SKU" prompt, clear it from the unmapped cache
  // now so its badge drops on the next sync rather than waiting out the TTL.
  try { removeUnmappedSku_(payload.sig, supplier, name); } catch (e) { /* non-fatal */ }

  // Push to Notion immediately so the app shows it without waiting for the
  // 30-minute scheduled sync. Best-effort: a sync failure shouldn't fail the add.
  var synced = false;
  try { syncIngredientPrices(); synced = true; } catch (e) { synced = false; }

  return { ok: true, key: key, name: name, price: price, unit: unit || 'unit', supplier: supplier, type: type, category: category, synced: synced };
}

// Reader used by SyncIngredientPrices.sipCollectPrices_ to merge custom items.
// Reads the LIVE price from the sheet cell each ingredient was written to, so
// later edits (by you or the scanner) flow through. Old/incomplete rows skipped.
function sipCustomIngredients_() {
  var out = [];
  try {
    var sheet = SpreadsheetApp.openById(SS_FOOD).getSheetByName(CUSTOM_INGREDIENTS_TAB);
    if (!sheet) return out;
    var data = sheet.getDataRange().getValues();
    var foodSheet = null, coffeeSheet = null;
    for (var r = 1; r < data.length; r++) {
      var key = String(data[r][0] || '').trim();
      if (!key) continue;
      var name     = String(data[r][1] || key);
      var unit     = String(data[r][2] || 'unit');
      var supplier = String(data[r][3] || 'Other');
      var type     = String(data[r][4] || 'food').toLowerCase();
      var priceCol = Number(data[r][6]);
      var row      = Number(data[r][7]);
      if (!isFinite(priceCol) || !isFinite(row) || priceCol < 1 || row < 1) continue; // old/incomplete
      var src;
      if (type === 'coffee') { coffeeSheet = coffeeSheet || SpreadsheetApp.openById(SS_COFFEE).getSheetByName(SHEET_COFFEE); src = coffeeSheet; }
      else { foodSheet = foodSheet || SpreadsheetApp.openById(SS_FOOD).getSheetByName(SHEET_FOOD); src = foodSheet; }
      if (!src) continue;
      var price = Number(src.getRange(row, priceCol).getValue());
      out.push({ key: key, name: name, price: (isFinite(price) ? price : 0), unit: unit, supplier: supplier });
    }
  } catch (e) { /* ignore */ }
  return out;
}

// Editor smoke test
function addIngredientSmokeTest() {
  Logger.log(JSON.stringify(searchInvoicesForItem_('bacon'), null, 2));
}
