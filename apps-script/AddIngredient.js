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
      var suggested;
      if (after.length) {
        suggested = after[0].val;
      } else {
        var before = all.filter(function (a) { return a.pos < kwPos; });
        suggested = before.length ? before[before.length - 1].val : all[0].val;
      }

      matches.push({
        supplier: supplier,
        file: fileName,
        date: date,
        line: line.trim().slice(0, 160),
        prices: all.map(function (a) { return a.val; }),
        suggestedPrice: suggested
      });
    });
  }

  matches.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  return { ok: true, query: q, count: matches.length, matches: matches.slice(0, 15) };
}

// ── CUSTOM INGREDIENT STORE ──────────────────────────────────────────────────
// CustomIngredients tab lives in the FOOD spreadsheet. Columns:
//   key | name | price | unit | supplier | category | dateAdded
function sipGetCustomIngredientsSheet_() {
  var ss = SpreadsheetApp.openById(SS_FOOD);
  var sheet = ss.getSheetByName(CUSTOM_INGREDIENTS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(CUSTOM_INGREDIENTS_TAB);
    sheet.appendRow(['key', 'name', 'price', 'unit', 'supplier', 'category', 'dateAdded']);
  }
  return sheet;
}

function addCustomIngredient_(payload) {
  payload = payload || {};
  var name = (payload.name || '').toString().trim();
  if (!name) return { ok: false, error: 'name required' };
  var price = Number(payload.price);
  if (!isFinite(price) || price <= 0) return { ok: false, error: 'a valid positive price is required' };

  var unit     = (payload.unit || 'unit').toString().trim() || 'unit';
  var supplier = (payload.supplier || 'Other').toString().trim() || 'Other';
  var category = (payload.category || 'food').toString().toLowerCase();
  if (category !== 'food' && category !== 'coffee') category = 'food';

  var key = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (key === 'custom_') return { ok: false, error: 'name must contain letters or numbers' };

  var sheet = sipGetCustomIngredientsSheet_();
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim() === key) {
      return { ok: false, error: 'an ingredient like "' + name + '" already exists' };
    }
  }
  sheet.appendRow([key, name, price, unit, supplier, category, new Date()]);

  // Push to Notion immediately so the app shows it without waiting for the
  // 30-minute scheduled sync. Best-effort: a sync failure shouldn't fail the add.
  var synced = false;
  try { syncIngredientPrices(); synced = true; } catch (e) { synced = false; }

  return { ok: true, key: key, name: name, price: price, unit: unit, supplier: supplier, category: category, synced: synced };
}

// Reader used by SyncIngredientPrices.sipCollectPrices_ to merge custom items.
function sipCustomIngredients_() {
  var out = [];
  try {
    var ss = SpreadsheetApp.openById(SS_FOOD);
    var sheet = ss.getSheetByName(CUSTOM_INGREDIENTS_TAB);
    if (!sheet) return out;
    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      var key = String(data[r][0] || '').trim();
      if (!key) continue;
      var price = Number(data[r][2]);
      out.push({
        key: key,
        name: String(data[r][1] || key),
        price: (isFinite(price) ? price : 0),
        unit: String(data[r][3] || 'unit'),
        supplier: String(data[r][4] || 'Other')
      });
    }
  } catch (e) { /* tab missing or unreadable — ignore */ }
  return out;
}

// Editor smoke test
function addIngredientSmokeTest() {
  Logger.log(JSON.stringify(searchInvoicesForItem_('bacon'), null, 2));
}
