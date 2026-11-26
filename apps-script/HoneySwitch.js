// HoneySwitch.js — ONE-OFF migration, 27 Nov 2026.
// G'Day Tiger switched ALL honey (matcha + kitchen) to 5Ways FHON3
// Honey Pure Blend 90/10 3kg tub, dropping B-Honey Squeeze BHS750 (750g).
//
// What migrateHoneyToFHON3() does:
//   1. COFFEE E6 label → "HONEY PURE BLEND 90/10 (3KG)", F6 → FOOD R14 price ($19.50)
//   2. Every COFFEE recipe line that references =F6 (24 matcha tiles):
//      pack Size 750 → 3000 g, so cost/10 g drops $0.153 → $0.065
//   3. Re-syncs Notion costings, ingredient prices and the recipe map
//
// Safe to re-run (only changes 750 → 3000). Delete this file once done.

function migrateHoneyToFHON3() {
  const coffee = SpreadsheetApp.openById(SS_COFFEE).getSheetByName(SHEET_COFFEE);
  const food   = SpreadsheetApp.openById(SS_FOOD).getSheetByName(SHEET_FOOD);

  const tubPrice = Number(food.getRange('R14').getValue());
  if (!(tubPrice >= 15 && tubPrice <= 30)) throw new Error('FOOD R14 honey price looks wrong: ' + tubPrice);

  Logger.log('COFFEE E6/F6 before: ' + coffee.getRange('E6').getValue() + ' / ' + coffee.getRange('F6').getValue());
  coffee.getRange('E6').setValue('HONEY PURE BLEND 90/10 (3KG)');
  coffee.getRange('F6').setValue(tubPrice);

  const rng      = coffee.getDataRange();
  const formulas = rng.getFormulas();
  const values   = rng.getValues();
  let changed = 0, already = 0, odd = [];
  for (let r = 0; r < formulas.length; r++) {
    for (let c = 1; c < formulas[r].length; c++) {
      const f = String(formulas[r][c]).replace(/\$/g, '').toUpperCase();
      if (f !== '=F6') continue;
      const size = values[r][c - 1];
      const a1 = coffee.getRange(r + 1, c).getA1Notation();
      if (size === 750)       { coffee.getRange(r + 1, c).setValue(3000); changed++; }
      else if (size === 3000) { already++; }
      else                    { odd.push(a1 + '=' + size); }
    }
  }
  SpreadsheetApp.flush();
  Logger.log('Recipe size cells 750→3000: ' + changed + ' | already 3000: ' + already + (odd.length ? ' | CHECK: ' + odd.join(', ') : ''));

  syncAllCostingsToNotion();
  syncIngredientPrices();
  buildRecipeMap();
  Logger.log('Done — Notion costings, ingredient prices and recipe map re-synced.');
}
