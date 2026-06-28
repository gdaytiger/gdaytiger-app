// ═══════════════════════════════════════════════════════════════════════════════
//  SyncSquarePrices.gs
//  Pulls live retail prices from Square and writes them to the Coffee Costings
//  spreadsheet. Food sync (syncSquarePricesToSheet) lives in ScanSuppliers.gs.
//
//  SETUP:  Script Properties → SQUARE_ACCESS_TOKEN = <production token>
//  TRIGGER: run createSquareAllSyncTrigger() once → syncs every 1 hour
// ═══════════════════════════════════════════════════════════════════════════════

var COFFEE_SS_ID      = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI';
var COFFEE_SHEET_NAME = 'COFFEE';

// ─── COFFEE SQUARE MAP ────────────────────────────────────────────────────────
// squareItem:  exact Square item name
// modifiers:   modifier names to add on top of base price ([] = base only)
//              sum all modifiers — supports multiple (e.g. Soy + Chocolate)
// recipes:     COFFEE sheet section headers this price applies to
// ─────────────────────────────────────────────────────────────────────────────
var COFFEE_SQUARE_MAP = [

  // ── FC Milk Coffee ────────────────────────────────────────────────────────
  { squareItem: 'TA White', modifiers: [],
    recipes: ['TAKEAWAY FC MILK COFFEE', 'DINE IN FC MILK COFFEE'] },
  { squareItem: 'LG White', modifiers: [],
    recipes: ['TAKEAWAY FC MILK COFFEE (LARGE)', 'DINE IN FC MILK COFFEE (LARGE)'] },

  // ── Black Coffee ──────────────────────────────────────────────────────────
  { squareItem: 'TA Black', modifiers: [],
    recipes: ['TAKEAWAY BLACK COFFEE', 'DINE IN BLACK COFFEE'] },
  { squareItem: 'LG Black', modifiers: [],
    recipes: ['TAKEAWAY BLACK COFFEE (LARGE)', 'DINE IN BLACK COFFEE (LARGE)'] },

  // ── Soy Coffee ────────────────────────────────────────────────────────────
  { squareItem: 'TA White', modifiers: ['Soy'],
    recipes: ['TAKEAWAY SOY COFFEE', 'DINE IN SOY COFFEE'] },
  { squareItem: 'LG White', modifiers: ['Soy'],
    recipes: ['TAKEAWAY SOY COFFEE (LARGE)', 'DINE IN SOY COFFEE (LARGE)'] },

  // ── Oat Coffee ────────────────────────────────────────────────────────────
  { squareItem: 'TA White', modifiers: ['Oat'],
    recipes: ['TAKEAWAY OAT COFFEE', 'DINE IN OAT COFFEE'] },
  { squareItem: 'LG White', modifiers: ['Oat'],
    recipes: ['TAKEAWAY OAT COFFEE (LARGE)', 'DINE IN OAT COFFEE (LARGE)'] },

  // ── Almond Coffee ─────────────────────────────────────────────────────────
  { squareItem: 'TA White', modifiers: ['Almond'],
    recipes: ['TAKEAWAY ALMOND COFFEE', 'DINE IN ALMOND COFFEE'] },
  { squareItem: 'LG White', modifiers: ['Almond'],
    recipes: ['TAKEAWAY ALMOND COFFEE (LARGE)', 'DINE IN ALMOND COFFEE (LARGE)'] },

  // ── Hot Chocolate - FC Milk ───────────────────────────────────────────────
  { squareItem: 'TA White', modifiers: ['Chocolate'],
    recipes: ['TAKEAWAY HOT CHOCOLATE (SMALL)', 'DINE IN HOT CHOCOLATE (SMALL)'] },
  { squareItem: 'LG White', modifiers: ['Chocolate'],
    recipes: ['TAKEAWAY HOT CHOCOLATE (LARGE)', 'DINE IN HOT CHOCOLATE (LARGE)'] },

  // ── Soy Hot Chocolate ─────────────────────────────────────────────────────
  { squareItem: 'TA White', modifiers: ['Soy', 'Chocolate'],
    recipes: ['TAKEAWAY SOY HOT CHOCOLATE (SMALL)', 'DINE IN SOY HOT CHOCOLATE (SMALL)'] },
  { squareItem: 'LG White', modifiers: ['Soy', 'Chocolate'],
    recipes: ['TAKEAWAY SOY HOT CHOCOLATE (LARGE)', 'DINE IN SOY HOT CHOCOLATE (LARGE)'] },

  // ── Oat Hot Chocolate ─────────────────────────────────────────────────────
  { squareItem: 'TA White', modifiers: ['Oat', 'Chocolate'],
    recipes: ['TAKEAWAY OAT HOT CHOCOLATE (SMALL)', 'DINE IN OAT HOT CHOCOLATE (SMALL)'] },
  { squareItem: 'LG White', modifiers: ['Oat', 'Chocolate'],
    recipes: ['TAKEAWAY OAT HOT CHOCOLATE (LARGE)', 'DINE IN OAT HOT CHOCOLATE (LARGE)'] },

  // ── Almond Hot Chocolate ──────────────────────────────────────────────────
  { squareItem: 'TA White', modifiers: ['Almond', 'Chocolate'],
    recipes: ['TAKEAWAY ALMOND HOT CHOCOLATE (SMALL)', 'DINE IN ALMOND HOT CHOCOLATE (SMALL)'] },
  { squareItem: 'LG White', modifiers: ['Almond', 'Chocolate'],
    recipes: ['TAKEAWAY ALMOND HOT CHOCOLATE (LARGE)', 'DINE IN ALMOND HOT CHOCOLATE (LARGE)'] },

  // ── Iced Latte - FC Milk ──────────────────────────────────────────────────
  // Source: "Iced Latte (DINE IN)" — has Small ($5.00) + Large ($6.50) variations
  // exactMatch: true — prevents "Latte" from matching due to .includes() in squareFindItem_
  { squareItem: 'Iced Latte (DINE IN)', modifiers: [], exactMatch: true,
    recipes: ['TAKEAWAY ICED LATTE', 'DINE IN ICED LATTE'] },
  { squareItem: 'Iced Latte (DINE IN)', modifiers: [], variation: 'Large', exactMatch: true,
    recipes: ['TAKEAWAY ICED LATTE (LARGE)', 'DINE IN ICED LATTE (LARGE)'] },

  // ── Iced Latte - Soy ──────────────────────────────────────────────────────
  { squareItem: 'Iced Latte (DINE IN)', modifiers: ['Soy'], exactMatch: true,
    recipes: ['TAKEAWAY SOY ICED LATTE', 'DINE IN SOY ICED LATTE'] },
  { squareItem: 'Iced Latte (DINE IN)', modifiers: ['Soy'], variation: 'Large', exactMatch: true,
    recipes: ['TAKEAWAY SOY ICED LATTE (LARGE)', 'DINE IN SOY ICED LATTE (LARGE)'] },

  // ── Iced Latte - Oat ──────────────────────────────────────────────────────
  { squareItem: 'Iced Latte (DINE IN)', modifiers: ['Oat'], exactMatch: true,
    recipes: ['TAKEAWAY OAT ICED LATTE', 'DINE IN OAT ICED LATTE'] },
  { squareItem: 'Iced Latte (DINE IN)', modifiers: ['Oat'], variation: 'Large', exactMatch: true,
    recipes: ['TAKEAWAY OAT ICED LATTE (LARGE)', 'DINE IN OAT ICED LATTE (LARGE)'] },

  // ── Iced Latte - Almond ───────────────────────────────────────────────────
  { squareItem: 'Iced Latte (DINE IN)', modifiers: ['Almond'], exactMatch: true,
    recipes: ['TAKEAWAY ALMOND ICED LATTE', 'DINE IN ALMOND ICED LATTE'] },
  { squareItem: 'Iced Latte (DINE IN)', modifiers: ['Almond'], variation: 'Large', exactMatch: true,
    recipes: ['TAKEAWAY ALMOND ICED LATTE (LARGE)', 'DINE IN ALMOND ICED LATTE (LARGE)'] },

  // ── Iced Matcha ───────────────────────────────────────────────────────────
  // Rings as "Iced Latte (DINE IN)" Large + a Matcha modifier (+ milk modifier).
  // Retail = base Large iced latte + Matcha upcharge + milk upcharge, summed by
  // the modifier-price logic below. Only the DINE IN (LARGE) recipes exist today;
  // the TAKEAWAY names are harmlessly skipped until/if those costings are added.
  { squareItem: 'Iced Latte (DINE IN)', modifiers: ['Matcha'], variation: 'Large', exactMatch: true,
    recipes: ['DINE IN ICED MATCHA (LARGE)', 'TAKEAWAY ICED MATCHA (LARGE)'] },
  { squareItem: 'Iced Latte (DINE IN)', modifiers: ['Soy', 'Matcha'], variation: 'Large', exactMatch: true,
    recipes: ['DINE IN SOY ICED MATCHA (LARGE)', 'TAKEAWAY SOY ICED MATCHA (LARGE)'] },
  { squareItem: 'Iced Latte (DINE IN)', modifiers: ['Oat', 'Matcha'], variation: 'Large', exactMatch: true,
    recipes: ['DINE IN OAT ICED MATCHA (LARGE)', 'TAKEAWAY OAT ICED MATCHA (LARGE)'] },
  { squareItem: 'Iced Latte (DINE IN)', modifiers: ['Almond', 'Matcha'], variation: 'Large', exactMatch: true,
    recipes: ['DINE IN ALMOND ICED MATCHA (LARGE)', 'TAKEAWAY ALMOND ICED MATCHA (LARGE)'] },

  // ── Hot Matcha ────────────────────────────────────────────────────────────
  // Rings as a white coffee (TA White small / LG White large) + Matcha modifier
  // (+ milk). Retail = white base + Matcha + milk upcharges. Each entry writes
  // the same menu price to both the takeaway and dine-in recipe (like all white
  // coffees). Small = no suffix, Large = (LARGE).
  { squareItem: 'TA White', modifiers: ['Matcha'],
    recipes: ['TAKEAWAY MATCHA', 'DINE IN MATCHA'] },
  { squareItem: 'LG White', modifiers: ['Matcha'],
    recipes: ['TAKEAWAY MATCHA (LARGE)', 'DINE IN MATCHA (LARGE)'] },
  { squareItem: 'TA White', modifiers: ['Soy', 'Matcha'],
    recipes: ['TAKEAWAY SOY MATCHA', 'DINE IN SOY MATCHA'] },
  { squareItem: 'LG White', modifiers: ['Soy', 'Matcha'],
    recipes: ['TAKEAWAY SOY MATCHA (LARGE)', 'DINE IN SOY MATCHA (LARGE)'] },
  { squareItem: 'TA White', modifiers: ['Oat', 'Matcha'],
    recipes: ['TAKEAWAY OAT MATCHA', 'DINE IN OAT MATCHA'] },
  { squareItem: 'LG White', modifiers: ['Oat', 'Matcha'],
    recipes: ['TAKEAWAY OAT MATCHA (LARGE)', 'DINE IN OAT MATCHA (LARGE)'] },
  { squareItem: 'TA White', modifiers: ['Almond', 'Matcha'],
    recipes: ['TAKEAWAY ALMOND MATCHA', 'DINE IN ALMOND MATCHA'] },
  { squareItem: 'LG White', modifiers: ['Almond', 'Matcha'],
    recipes: ['TAKEAWAY ALMOND MATCHA (LARGE)', 'DINE IN ALMOND MATCHA (LARGE)'] },

  // ── Chai — TODO: add once modifier pricing confirmed ──────────────────────
  // { squareItem: 'TA White', modifiers: ['Chai'],
  //   recipes: ['TAKEAWAY CHAI (SMALL)', 'DINE IN CHAI (SMALL)', ...] },

];

// ─── FETCH ALL MODIFIER PRICES ────────────────────────────────────────────────
// Fetches every modifier list from Square and returns a flat map:
//   { 'SOY': 70, 'CHOCOLATE': 50, ... }  (prices in cents, keyed UPPERCASE)
// First occurrence wins if a name appears in multiple lists.
function squareFetchAllModifierPrices_(token, log) {
  var prices = {};
  try {
    var resp = UrlFetchApp.fetch('https://connect.squareup.com/v2/catalog/list?types=MODIFIER_LIST', {
      headers: { 'Authorization': 'Bearer ' + token, 'Square-Version': '2024-01-18' }
    });
    var lists = JSON.parse(resp.getContentText()).objects || [];
    lists.forEach(function(list) {
      (list.modifier_list_data.modifiers || []).forEach(function(m) {
        var key = m.modifier_data.name.toUpperCase().trim();
        if (!(key in prices)) {
          prices[key] = m.modifier_data.price_money ? m.modifier_data.price_money.amount : 0;
        }
      });
    });
    if (log) log.push('Fetched modifier prices: ' + Object.keys(prices).length + ' modifiers');
  } catch(e) {
    if (log) log.push('ERROR fetching modifiers: ' + e.message);
  }
  return prices;
}

// ─── EXACT-MATCH ITEM LOOKUP ──────────────────────────────────────────────────
// squareFindItem_() uses bidirectional .includes() which can match the wrong item
// when one item name is a substring of another (e.g. "Latte" inside "Iced Latte").
// Use this when map.exactMatch = true to force a precise name match.
function squareFindItemExact_(items, squareItem) {
  var target = squareItem.toLowerCase().trim();
  for (var i = 0; i < items.length; i++) {
    var obj = items[i];
    if (obj.type !== 'ITEM') continue;
    var name = ((obj.item_data && obj.item_data.name) || '').toLowerCase().trim();
    if (name === target) return obj;
  }
  return null;
}

// ─── SYNC FUNCTION ────────────────────────────────────────────────────────────
function syncSquarePricesToCoffeeSheet() {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  if (!token) { Logger.log('ERROR: SQUARE_ACCESS_TOKEN not set.'); return; }

  var coffeeSheet = SpreadsheetApp.openById(COFFEE_SS_ID).getSheetByName(COFFEE_SHEET_NAME);
  if (!coffeeSheet) { Logger.log('ERROR: COFFEE sheet not found'); return; }

  var data = coffeeSheet.getDataRange().getValues();
  var log  = ['=== syncSquarePricesToCoffeeSheet() ' + new Date().toISOString() + ' ==='];

  var items = squareFetchAllItems_(token, log);
  if (!items) { Logger.log(log.join('\n')); return; }
  log.push('Fetched ' + items.length + ' Square catalog objects');

  var modifierPrices = squareFetchAllModifierPrices_(token, log);

  COFFEE_SQUARE_MAP.forEach(function(map) {
    try {
      var item = map.exactMatch
        ? squareFindItemExact_(items, map.squareItem)
        : squareFindItem_(items, map.squareItem);
      if (!item) { log.push('WARN: Square item not found: "' + map.squareItem + '"'); return; }

      var baseCents = squareGetVariationPrice_(item, map.variation || null);
      if (baseCents === null) { log.push('WARN: No price for "' + map.squareItem + '"'); return; }

      // Sum all modifier prices
      var totalCents = baseCents;
      (map.modifiers || []).forEach(function(modName) {
        var key = modName.toUpperCase().trim();
        if (key in modifierPrices) {
          totalCents += modifierPrices[key];
        } else {
          log.push('WARN: Modifier "' + modName + '" not found in Square');
        }
      });

      var totalDollars = r2(totalCents / 100);

      map.recipes.forEach(function(recipeName) {
        var sectionRow = findCoffeeSectionRowInData_(data, recipeName);
        if (sectionRow === -1) return;

        var cellRef = findCoffeeRetailPriceCellRef_(data, sectionRow);
        if (!cellRef) { log.push('WARN: No Retail Price row for "' + recipeName + '"'); return; }

        var current = coffeeSheet.getRange(cellRef).getValue();
        if (typeof current === 'number' && Math.abs(current - totalDollars) < 0.005) return;

        coffeeSheet.getRange(cellRef).setValue(totalDollars);
        log.push('✓ ' + recipeName + ' → ' + cellRef + ' = $' + totalDollars.toFixed(2) +
                 '  (' + map.squareItem + (map.modifiers.length ? ' + ' + map.modifiers.join(' + ') : '') + ')');
      });

    } catch(e) { log.push('ERROR for "' + map.squareItem + '": ' + e.message); }
  });

  Logger.log(log.join('\n'));
  return log.join('\n');
}

// ─── COMBINED SYNC (FOOD + COFFEE) ───────────────────────────────────────────
function syncSquareAllSheets() {
  var foodLog   = syncSquarePricesToSheet();
  var coffeeLog = syncSquarePricesToCoffeeSheet();
  return foodLog + '\n\n' + coffeeLog;
}

// ─── TRIGGER SETUP ───────────────────────────────────────────────────────────
// Run ONCE to replace any old Square trigger with the combined FOOD + COFFEE sync.
function createSquareAllSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'syncSquarePricesToSheet' || fn === 'syncSquareAllSheets') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('syncSquareAllSheets').timeBased().everyHours(1).create();
  Logger.log('Trigger created: syncSquareAllSheets (FOOD + COFFEE) runs every 1 hour.');
}

// ─── COFFEE SHEET HELPERS ─────────────────────────────────────────────────────
function findCoffeeSectionRowInData_(data, recipeName) {
  var target = recipeName.toLowerCase().replace(/\s+/g, ' ').trim();
  for (var r = 0; r < data.length; r++) {
    var cellA = String(data[r][0] || '').trim();
    var cellB = String(data[r][1] || '').trim();
    var cellE = String(data[r][4] || '').trim();
    if (cellA && !cellB && !cellE &&
        cellA.toLowerCase().replace(/\s+/g, ' ').trim() === target) {
      return r;
    }
  }
  return -1;
}

function findCoffeeRetailPriceCellRef_(data, sectionRow) {
  for (var r = sectionRow + 1; r < Math.min(sectionRow + 60, data.length); r++) {
    var labelEF = String(data[r][4] || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (labelEF === 'retail price') return 'F' + (r + 1);

    var colEEmpty = (data[r][4] === '' || data[r][4] === null || String(data[r][4]).trim() === '');
    if (colEEmpty) {
      var labelAB = String(data[r][0] || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (labelAB === 'retail price') return 'B' + (r + 1);
    }

    var nextA = String(data[r][0] || '').trim();
    var nextB = String(data[r][1] || '').trim();
    var nextE = String(data[r][4] || '').trim();
    if (nextA && !nextB && !nextE && r > sectionRow + 4 &&
        nextA === nextA.toUpperCase() && nextA.length > 3) break;
  }
  return null;
}

// ─── DIAGNOSTICS (safe to keep, won't affect triggers) ───────────────────────
function listSquareItems() {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  var items = squareFetchAllItems_(token, []);
  var names = items.map(function(i) { return i.item_data.name; }).sort();
  Logger.log(names.join('\n'));
}

function listSquareModifiers() {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  var resp = UrlFetchApp.fetch('https://connect.squareup.com/v2/catalog/list?types=MODIFIER_LIST', {
    headers: { 'Authorization': 'Bearer ' + token, 'Square-Version': '2024-01-18' }
  });
  var lists = JSON.parse(resp.getContentText()).objects || [];
  lists.forEach(function(list) {
    Logger.log('LIST: ' + list.modifier_list_data.name);
    (list.modifier_list_data.modifiers || []).forEach(function(m) {
      Logger.log('  → ' + m.modifier_data.name + ' ($' + (m.modifier_data.price_money ? m.modifier_data.price_money.amount/100 : 0) + ')');
    });
  });
}