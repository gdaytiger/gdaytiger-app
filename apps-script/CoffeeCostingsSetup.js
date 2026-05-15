/**
 * CoffeeCostingsSetup.gs
 * G'Day Tiger — Coffee Costings → Notion Setup
 * Updated: 2026-05-03
 *
 * Runs once (or after major changes) to rebuild the Coffee section of
 * the Notion Product Costings DB from the COFFEE Costings spreadsheet.
 *
 * STEP 1: Run diagnoseCoffeeSheet()  → verify all recipe names + prices look right.
 * STEP 2: Run setupCoffeeNotionItems() → archives old Coffee items, creates new ones.
 *
 * REQUIREMENTS:
 *   Project Settings → Script Properties → NOTION_API_KEY = <your token>
 */

var COFFEE_SETUP_SS_ID  = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI';
var COFFEE_SETUP_SHEET  = 'COFFEE';
var COFFEE_NOTION_DB_ID = '8f16358a47e54062b5fe1ce7a7480754';

// ─── STEP 1: DIAGNOSTIC ──────────────────────────────────────────────────────
// Run this FIRST. Inspect the Execution Log to confirm all recipe names are
// correct and Sell Price / Profit % are being read accurately.
function diagnoseCoffeeSheet() {
  var sheet = SpreadsheetApp.openById(COFFEE_SETUP_SS_ID).getSheetByName(COFFEE_SETUP_SHEET);
  if (!sheet) { Logger.log('ERROR: COFFEE sheet not found'); return; }

  var data    = sheet.getDataRange().getValues();
  var recipes = _extractCoffeeRecipes(data);

  var lines = ['=== COFFEE SHEET DIAGNOSTIC — ' + new Date().toLocaleString('en-AU') + ' ===',
               'Found ' + recipes.length + ' recipes:', ''];
  recipes.forEach(function(r) {
    var sell = r.sellPrice !== null ? '$' + r.sellPrice.toFixed(2) : 'NOT FOUND';
    var pct  = r.profitPct !== null ? r.profitPct.toFixed(1) + '%' : 'NOT FOUND';
    lines.push('Row ' + (r.row + 1) + ':  ' + r.sheetName + '  |  Sell: ' + sell + '  |  Profit: ' + pct);
  });

  var report = lines.join('\n');
  Logger.log(report);
  try { SpreadsheetApp.getUi().alert(report.substring(0, 1500)); } catch (e) {}
  return recipes;
}

// ─── STEP 2: SETUP (archive old items + create new ones) ─────────────────────
function setupCoffeeNotionItems() {
  var NOTION_KEY = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  if (!NOTION_KEY) throw new Error('NOTION_API_KEY not set in Script Properties.');

  var sheet = SpreadsheetApp.openById(COFFEE_SETUP_SS_ID).getSheetByName(COFFEE_SETUP_SHEET);
  if (!sheet) throw new Error('COFFEE sheet not found.');
  var data = sheet.getDataRange().getValues();

  // 1. Archive all existing Coffee-category Notion pages
  Logger.log('Archiving existing Coffee items...');
  var archived = _archiveCoffeeNotionItems(NOTION_KEY);
  Logger.log('Archived: ' + archived);

  // 2. Extract recipe sections from the COFFEE sheet
  var recipes = _extractCoffeeRecipes(data);
  Logger.log('Recipes found in sheet: ' + recipes.length);

  // 3. Create new Notion pages
  var created = [];
  var errors  = [];

  recipes.forEach(function(recipe) {
    try {
      _createCoffeeNotionPage(recipe, NOTION_KEY);
      created.push(recipe.name);
      Utilities.sleep(350);
    } catch (e) {
      errors.push(recipe.name + ': ' + e.message);
    }
  });

  var summary = [
    '=== setupCoffeeNotionItems COMPLETE ===',
    'Archived: ' + archived + ' old pages',
    'Created:  ' + created.length + ' new pages',
    '',
    'Created:',
    created.join('\n'),
    errors.length ? '\nErrors:\n' + errors.join('\n') : '',
  ].join('\n');

  Logger.log(summary);
  try { SpreadsheetApp.getUi().alert(summary.substring(0, 1500)); } catch (e) {}
  return summary;
}

// ─── CORE: Extract all recipe sections from the COFFEE sheet ─────────────────
/**
 * A recipe section header is a row where:
 *   - Column A has non-empty text
 *   - Column B is empty  (rules out ingredient table rows like "Coffee (g) | 1000 | ...")
 *   - Column E is empty  (rules out price-table rows that have E/F label/value)
 *   - The text isn't a known non-recipe label
 *
 * Then scans forward (max 60 rows) to find Retail Price and Profit % in:
 *   - Columns E/F  (6-column ingredient table summary format)
 *   - Columns A/B  (2-column mini-summary format — some COFFEE sheet variants use this)
 */
function _extractCoffeeRecipes(data) {
  var NON_RECIPE = ['item', 'coffee costings', 'coffee costing', 'ingredient',
                    'price table', 'supplier', 'size', ''];

  var recipes = [];

  for (var r = 0; r < data.length; r++) {
    var cellA = String(data[r][0] || '').trim();
    var cellB = String(data[r][1] || '').trim();
    var cellE = String(data[r][4] || '').trim();

    // Recipe header check: col A filled, cols B + E empty
    if (!cellA || cellB || cellE) continue;
    if (NON_RECIPE.indexOf(cellA.toLowerCase()) !== -1) continue;
    // Recipe headers are ALL CAPS — skip mixed-case ingredient labels (e.g. "Marshmallow")
    if (cellA !== cellA.toUpperCase()) continue;

    // Find Sell Price + Profit % below this header
    var values = _extractCoffeeValues(data, r);
    if (values.sellPrice !== null && values.profitPct !== null) {
      recipes.push({
        name:      cellA,               // Notion display name (as written in sheet — ALL CAPS)
        sheetName: cellA,               // exact sheet text (for matching later)
        sellPrice: values.sellPrice,
        profitPct: values.profitPct,
        row:       r,
      });
    }
  }

  return recipes;
}

/**
 * Scan forward from sectionRow looking for "Retail Price" and "Profit %".
 * Handles both summary formats used in the COFFEE sheet:
 *   E/F format:  col A empty, label in col E (index 4), value in col F (index 5)
 *   A/B format:  label in col A (index 0), value in col B (index 1)
 */
function _extractCoffeeValues(data, sectionRow) {
  var sellPrice = null;
  var profitPct = null;

  for (var r = sectionRow + 1; r < Math.min(sectionRow + 60, data.length); r++) {

    // E/F format
    var labelEF = _norm(String(data[r][4] || ''));
    var rawEF   = data[r][5];
    var numEF   = (rawEF !== '' && rawEF !== null && !isNaN(rawEF)) ? parseFloat(rawEF) : null;

    // A/B format (only if col B has a number and col E is empty)
    var labelAB = (data[r][4] === '' || data[r][4] === null)
                  ? _norm(String(data[r][0] || '')) : '';
    var rawAB   = data[r][1];
    var numAB   = (rawAB !== '' && rawAB !== null && !isNaN(rawAB)) ? parseFloat(rawAB) : null;

    // Retail Price (take the last one found before Profit %)
    if (labelEF === 'retail price' && numEF !== null) sellPrice = numEF;
    else if (labelAB === 'retail price' && numAB !== null) sellPrice = numAB;

    // Profit % → stop scanning
    if (labelEF === 'profit %' && numEF !== null) { profitPct = numEF; break; }
    else if (labelAB === 'profit %' && numAB !== null) { profitPct = numAB; break; }

    // Stop if we hit the next section header (ALL CAPS only — skips ingredient labels like "Marshmallow")
    var nextA = String(data[r][0] || '').trim();
    var nextB = String(data[r][1] || '').trim();
    var nextE = String(data[r][4] || '').trim();
    if (nextA && !nextB && !nextE && r > sectionRow + 4 &&
        nextA === nextA.toUpperCase() && nextA.length > 3) {
      break;
    }
  }

  return { sellPrice: sellPrice, profitPct: profitPct };
}

// ─── NOTION: Archive all Coffee-category pages ────────────────────────────────
function _archiveCoffeeNotionItems(notionKey) {
  var count   = 0;
  var cursor  = null;
  var hasMore = true;

  while (hasMore) {
    var body = {
      page_size: 100,
      filter: { property: 'Category', select: { equals: 'Coffee' } },
    };
    if (cursor) body.start_cursor = cursor;

    var res    = UrlFetchApp.fetch('https://api.notion.com/v1/databases/' + COFFEE_NOTION_DB_ID + '/query', {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + notionKey,
                 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var parsed = JSON.parse(res.getContentText());
    if (parsed.object === 'error') throw new Error('Notion query error: ' + parsed.message);

    (parsed.results || []).forEach(function(page) {
      UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + page.id, {
        method: 'patch',
        headers: { 'Authorization': 'Bearer ' + notionKey,
                   'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        payload: JSON.stringify({ archived: true }),
        muteHttpExceptions: true,
      });
      Utilities.sleep(200);
      count++;
    });

    hasMore = parsed.has_more;
    cursor  = parsed.next_cursor;
  }

  return count;
}

// ─── NOTION: Create a new Coffee product page ─────────────────────────────────
function _createCoffeeNotionPage(recipe, notionKey) {
  var payload = {
    parent:     { database_id: COFFEE_NOTION_DB_ID },
    properties: {
      'Name':       { title: [{ text: { content: recipe.name } }] },
      'Category':   { select: { name: 'Coffee' } },
      'Sell Price': { number: Math.round(recipe.sellPrice * 100) / 100 },
      'Profit %':   { number: Math.round(recipe.profitPct * 10)  / 10  },
    },
  };

  var res    = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + notionKey,
               'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var parsed = JSON.parse(res.getContentText());
  if (parsed.object === 'error') throw new Error(parsed.message);
  Logger.log('✓ Created: ' + recipe.name + ' — $' + recipe.sellPrice.toFixed(2) + ', ' + recipe.profitPct.toFixed(1) + '%');
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function _titleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}
function _norm(str) {
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}