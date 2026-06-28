// SyncIngredientPrices.gs
// Reads ingredient prices from both Food and Coffee Costings sheets,
// writes them as a JSON code block in the Notion main OS page.
// Run syncIngredientPrices() on a trigger (e.g. every 30 minutes).

const SIP_NOTION_API_KEY  = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
const SIP_NOTION_PAGE_ID  = '3403c99c0e858113a941c2118b3cdef9';
const SIP_FOOD_SHEET_ID   = '1nZvWNFaQTrJAt-ilYihZjYZKBzHd6x3qIrjFhdNQqAU';
const SIP_COFFEE_SHEET_ID = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI';

function syncIngredientPrices() {
  const prices = sipCollectPrices_();
  sipWriteToNotion_(prices);
  Logger.log('Ingredient prices synced: ' + JSON.stringify(prices));
}

function sipCollectPrices_() {
  const ingredients = [];
  const seen = {};

  // ── COFFEE SHEET ───────────────────────────────────────────────────────────
  const coffeeSheet = SpreadsheetApp.openById(SIP_COFFEE_SHEET_ID).getSheetByName('COFFEE');
  const coffeeData  = coffeeSheet.getDataRange().getValues();

  for (let i = 0; i < coffeeData.length; i++) {
    const row     = coffeeData[i];
    const rawName = String(row[0] || '').trim();
    const name    = rawName.split(' (')[0].trim(); // "Coffee (g)" → "Coffee"
    const size    = Number(row[1]);
    const cost = Number(row[2]);
    if (!name || isNaN(cost) || cost <= 0) continue;

    if (name === 'Coffee' && cost > 30 && !seen['coffee_beans']) {
      ingredients.push({ key: 'coffee_beans', name: 'Golden Gate Espresso Blend (1kg)', price: cost, unit: '1kg', supplier: 'Seven Seeds' });
      seen['coffee_beans'] = true;
    } else if (name === 'Coffee' && cost > 5 && cost <= 30 && !seen['decaf_beans']) {
      ingredients.push({ key: 'decaf_beans', name: 'Decaf Beans (1kg)', price: cost, unit: '1kg', supplier: 'Seven Seeds' });
      seen['decaf_beans'] = true;
    } else if (name === 'Chai' && !seen['chai']) {
      ingredients.push({ key: 'chai', name: 'Chai (1kg)', price: cost, unit: '1kg', supplier: 'Seven Seeds' });
      seen['chai'] = true;
    } else if (name === 'Chocolate' && !seen['chocolate']) {
      ingredients.push({ key: 'chocolate', name: 'Mörk Chocolate (2.1kg)', price: cost, unit: '2.1kg', supplier: 'Mörk' });
      seen['chocolate'] = true;
    } else if (name === 'Straw' && !seen['straw']) {
      ingredients.push({ key: 'straw', name: 'Paper Straws (2500)', price: cost, unit: '2500pk', supplier: 'Abicor' });
      seen['straw'] = true;
    } else if (name === 'Cup' && size === 1000 && cost > 120 && !seen['cup_large']) {
      ingredients.push({ key: 'cup_large', name: 'Cups Large (1000)', price: cost, unit: '1000pk', supplier: 'Planetware' });
      seen['cup_large'] = true;
    } else if (name === 'Cup' && size === 1000 && cost > 60 && cost <= 120 && !seen['cup_medium']) {
      ingredients.push({ key: 'cup_medium', name: 'Cups Med/Small (1000)', price: cost, unit: '1000pk', supplier: 'Planetware' });
      seen['cup_medium'] = true;
    } else if (name === 'Lid' && size === 1000 && cost > 60 && !seen['lid_standard']) {
      ingredients.push({ key: 'lid_standard', name: 'Lids Standard (1000)', price: cost, unit: '1000pk', supplier: 'Planetware' });
      seen['lid_standard'] = true;
    }
  }

  // ── MILK (Redi Milk) — read the master price cells D5–D9 DIRECTLY ───────────
  // The scanner writes one price per milk product to these cells (by exact name).
  // Reading them by cell keeps the cards, the recipe map (BRM_COFFEE_CELL_TO_KEY)
  // and drift (CELL_TO_INGREDIENT_KEY) on the SAME keys. The old approach matched
  // rows named "Milk" by size (2L/6L/12L) and grabbed the wrong product — e.g.
  // Oat read a 2L bottle price instead of the 12L oat carton.
  const cc = function (col, row) {
    try { const v = coffeeData[row - 1][col - 1]; return (typeof v === 'number' && v > 0) ? v : null; }
    catch (e) { return null; }
  };
  const MILK_CELLS = [
    { key: 'sungold_jersey_fc', name: 'Sungold Jersey FC (2L)', col: 4, row: 5, unit: '2L' },
    { key: 'sungold_lowfat',    name: 'Sungold Lowfat (2L)',    col: 4, row: 6, unit: '2L' },
    { key: 'happy_soy',         name: 'Happy Soy (6L)',         col: 4, row: 7, unit: '6L' },
    { key: 'alt_dairy_oat',     name: 'Alt.Dairy Oat (12L)',    col: 4, row: 8, unit: '12L' },
    { key: 'alt_dairy_almond',  name: 'Alt.Dairy Almond (12L)', col: 4, row: 9, unit: '12L' },
  ];
  MILK_CELLS.forEach(function (m) {
    const price = cc(m.col, m.row);
    if (price !== null && !seen[m.key]) {
      ingredients.push({ key: m.key, name: m.name, price: price, unit: m.unit, supplier: 'Redi Milk' });
      seen[m.key] = true;
    }
  });

  // ── Other coffee-sheet master cells read by position ────────────────────────
  // The row-name loop above doesn't cover these, so they never reached the
  // dashboard even though the scanner keeps the cells current:
  //   B10 Matsu Matcha (parseMatsuText) · F6 B-Honey Squeeze (5Ways BHS750, used in matcha)
  // Keys match CELL_TO_INGREDIENT_KEY so drift badges join correctly.
  const COFFEE_MASTER_CELLS = [
    { key: 'matcha',        name: 'Matsu Matcha (500g)',    col: 2, row: 10, unit: '500g', supplier: 'Matsu Tea' },
    { key: 'honey_squeeze', name: 'B-Honey Squeeze (750g)', col: 6, row: 6,  unit: '750g', supplier: '5Ways' },
  ];
  COFFEE_MASTER_CELLS.forEach(function (c) {
    const price = cc(c.col, c.row);
    if (price !== null && !seen[c.key]) {
      ingredients.push({ key: c.key, name: c.name, price: price, unit: c.unit, supplier: c.supplier });
      seen[c.key] = true;
    }
  });

  // ── FOOD SHEET ─────────────────────────────────────────────────────────────
  // Supplier map derived from invoice scanner coverage:
  //   Dench      → B5, B6, B8
  //   5Ways      → B7, D5, D7, D8, F5–F9, H7, J5–J7, N5, N6, N8, R5–R14 (excl R12)
  //   Uncle's    → D6
  //   PFD Foods  → D9, H6
  //   Sciclunas  → H5, H8–H19
  //   Woolworths → F10
  //   Redi Milk  → R12
  //   Abicor     → P8, P9
  //   GDay Tiger → L col (Made In House — formula-driven); P7, P10 (branded printed bags)
  //   Manual     → B6 (Candied), B8 (Noisette), N7, P5, P6, H20 (Leni Peppers — 5Ways product, price entered manually)

  const foodSheet = SpreadsheetApp.openById(SIP_FOOD_SHEET_ID).getSheetByName('FOOD');
  const foodData  = foodSheet.getDataRange().getValues();

  function fc(col, row) {
    try {
      const v = foodData[row - 1][col - 1];
      return (typeof v === 'number' && v > 0) ? v : null;
    } catch (e) { return null; }
  }

  const foodIngredients = FOOD_INGREDIENTS;

  for (const ing of foodIngredients) {
    const price = fc(ing.col, ing.row);
    if (price !== null) {
      ingredients.push({ key: ing.key, name: ing.name, price: price, unit: ing.unit, supplier: ing.supplier });
    }
  }

  return {
    type: 'ingredient_prices',
    updated: new Date().toISOString(),
    ingredients: ingredients,
  };
}

function sipWriteToNotion_(prices) {
  const json = JSON.stringify(prices);
  const headers = {
    'Authorization': 'Bearer ' + SIP_NOTION_API_KEY,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  // Find existing ingredient_prices block on the page
  let allBlocks = [];
  let cursor = null;
  do {
    let url = 'https://api.notion.com/v1/blocks/' + SIP_NOTION_PAGE_ID + '/children?page_size=100';
    if (cursor) url += '&start_cursor=' + cursor;
    const res  = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());
    allBlocks  = allBlocks.concat(data.results || []);
    cursor     = data.has_more ? data.next_cursor : null;
  } while (cursor);

  const existingBlock = allBlocks.find(function(b) {
    if (b.type !== 'code') return false;
    const text = (b.code && b.code.rich_text || []).map(function(r) { return r.plain_text; }).join('');
    return text.indexOf('"ingredient_prices"') !== -1;
  });

  // Notion rich_text has a 2000-char limit per entry — chunk the JSON
  const chunks = [];
  for (let i = 0; i < json.length; i += 1900) {
    chunks.push({ type: 'text', text: { content: json.slice(i, i + 1900) } });
  }

  const blockBody = JSON.stringify({
    type: 'code',
    code: {
      language: 'json',
      rich_text: chunks,
    },
  });

  if (existingBlock) {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + existingBlock.id, {
      method: 'PATCH',
      headers: headers,
      payload: blockBody,
      muteHttpExceptions: true,
    });
  } else {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + SIP_NOTION_PAGE_ID + '/children', {
      method: 'PATCH',
      headers: headers,
      payload: JSON.stringify({ children: [JSON.parse(blockBody)] }),
      muteHttpExceptions: true,
    });
  }
}

// Run this once to set up the trigger (30-minute interval)
function createIngredientPriceTrigger() {
  ScriptApp.newTrigger('syncIngredientPrices')
    .timeBased()
    .everyMinutes(30)
    .create();
  Logger.log('Trigger created.');
}