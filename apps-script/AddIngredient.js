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

// ── INVOICE SEARCH ───────────────────────────────────────────────────────────
// Scans recent (last 30 days) invoice PDFs across every supplier folder for the
// keyword. Returns up to 15 candidate matches, newest first:
//   { supplier, file, date, line, prices:[..], suggestedPrice }
function searchInvoicesForItem_(query) {
  var q = (query || '').toString().trim().toLowerCase();
  if (q.length < 2) return { ok: false, error: 'enter at least 2 characters' };

  var folders = [
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

  var cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  var matches = [];

  folders.forEach(function (f) {
    if (!f.id) return;
    var pdfs;
    try { pdfs = getSortedPdfs(f.id, '', cutoff); } catch (e) { return; }
    // Newest first, cap at 6 PDFs per supplier to bound runtime.
    pdfs.reverse();
    pdfs.slice(0, 6).forEach(function (file) {
      var text;
      try { text = extractPdfText(file.getId()); } catch (e) { return; }
      if (!text) return;
      text.split(/[\r\n]+/).forEach(function (line) {
        if (line.toLowerCase().indexOf(q) === -1) return;
        var nums = (line.match(/\d+(?:,\d{3})*\.\d{2}(?!\d)/g) || [])
          .map(function (n) { return parseFloat(n.replace(/,/g, '')); })
          .filter(function (n) { return n > 0.1 && n < 100000; });
        if (nums.length === 0) return;
        matches.push({
          supplier: f.supplier,
          file: file.getName(),
          date: file.getLastUpdated().toISOString().slice(0, 10),
          line: line.trim().slice(0, 160),
          prices: nums,
          suggestedPrice: nums[0]   // first money value on the line; user can change
        });
      });
    });
  });

  // Newest first, then cap.
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
