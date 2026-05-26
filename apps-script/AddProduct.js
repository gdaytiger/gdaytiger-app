// AddProduct.js
// Web App endpoint that creates a new product end-to-end:
//   1. Writes a new recipe section to the FOOD or COFFEE costings sheet
//   2. Creates a matching row in the Notion Product Costings database
//   3. Triggers buildRecipeMap() so recipe_map updates immediately
//
// Deployed as a Google Apps Script Web App. TIGEROS calls it via HTTPS POST.
// Shared-secret header (ADD_PRODUCT_SECRET in Script Properties) gates access.
//
// Payload schema (v1, food single-section + coffee variants):
// {
//   "type": "food" | "coffee",
//   "name": "PRODUCT NAME",            // ALL CAPS, becomes section header
//   "retailPrice": 12.50,
//   "ingredients": [
//     { "key": "sourdough", "qty": 2, "unit": "unit" },
//     { "key": "ham", "qty": 0.05, "unit": "kg" },
//     ...
//   ],
//   "variants": {                       // coffee only, optional
//     "milks": ["sungold_jersey_fc", "alt_dairy_oat"],
//     "sizes": ["small", "large"],
//     "channels": ["dine_in", "takeaway"]
//   }
// }

const AP_NOTION_API_KEY  = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
const AP_NOTION_DB_ID    = '8f16358a47e54062b5fe1ce7a7480754';
const AP_FOOD_SHEET_ID   = '1nZvWNFaQTrJAt-ilYihZjYZKBzHd6x3qIrjFhdNQqAU';
const AP_COFFEE_SHEET_ID = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI';

// Inverse maps: ingredient key → A1 cell reference in the matching sheet.
// Mirrors BRM_FOOD_CELL_TO_KEY / BRM_COFFEE_CELL_TO_KEY from BuildRecipeMap.js
// (kept duplicated here so AddProduct.js is self-contained for review/test).
const AP_FOOD_KEY_TO_CELL = (function () {
  const cellToKey = {
    'B5':'sourdough','B6':'ciabatta','B7':'potato_bun','B8':'croissant',
    'D5':'ham','D6':'beef_pastrami','D7':'salami','D8':'tuna','D9':'chicken',
    'F5':'mozzarella','F6':'swiss_cheese','F7':'taleggio','F8':'american_cheese','F9':'parmesan_grated','F10':'parmesan_block',
    'H5':'tomato','H6':'sauerkraut','H7':'pickles','H8':'mushrooms_raw','H9':'red_onion','H10':'fennel',
    'H11':'red_chilli','H12':'jalapeno','H13':'parsley','H14':'dill','H15':'bananas','H16':'eggplant',
    'H17':'lemon','H18':'carrot','H19':'cucumber','H20':'leni_peppers',
    'J5':'dijon_mustard','J6':'mayo','J7':'ketchup',
    'L5':'tuna_mix','L6':'caponata','L7':'mushroom_mix','L8':'schnittas','L9':'basil_pesto','L10':'tiger_sauce','L11':'honey_mustard_mayo',
    'N5':'butter','N6':'olive_oil','N7':'salt','N8':'pepper','N9':'eggs',
    'P8':'napkins','P9':'tray',
    'R5':'plain_flour','R6':'sr_flour','R7':'caster_sugar','R8':'brown_sugar','R9':'bicarb_soda','R10':'cinnamon','R11':'vegetable_oil','R13':'breadcrumbs','R14':'honey','R15':'pinenuts',
  };
  const out = {};
  for (const cell in cellToKey) out[cellToKey[cell]] = cell;
  return out;
})();

const AP_COFFEE_KEY_TO_CELL = {
  coffee_beans:'B5', chocolate:'B6', chai:'B7', fbomb:'B8', decaf_beans:'B9', matcha:'B10',
  sungold_jersey_fc:'D5', sungold_lowfat:'D6', happy_soy:'D7', alt_dairy_oat:'D8', alt_dairy_almond:'D9',
  bundaberg_raw_sugar:'F5',
  cup_small_6oz:'H5', cup_large_12oz:'H6', lid_hot:'H7', cup_detpak_16oz:'H8', lid_sipper:'H9', straw:'H10',
};

// Display-friendly labels for each ingredient (used in recipe row labels)
const AP_INGREDIENT_LABELS = {
  // food
  sourdough:'Sourdough (sl)', ciabatta:'Ciabatta (unit)', potato_bun:'Potato Bun (unit)', croissant:'Croissant (unit)',
  ham:'Ham (kg)', beef_pastrami:'Beef Pastrami (kg)', salami:'Salami (kg)', tuna:'Tuna (tin)', chicken:'Chicken (kg)',
  mozzarella:'Mozzarella (kg)', swiss_cheese:'Swiss Cheese (slice)', taleggio:'Taleggio (kg)', american_cheese:'American Cheese (kg)',
  parmesan_grated:'Parmesan Grated (kg)', parmesan_block:'Parmesan Block (kg)',
  tomato:'Tomato (kg)', sauerkraut:'Sauerkraut (tin)', pickles:'Pickles (each)', mushrooms_raw:'Mushrooms (box)',
  red_onion:'Red Onion (kg)', fennel:'Fennel (each)', red_chilli:'Red Chilli (kg)', jalapeno:'Jalapeno (kg)',
  parsley:'Parsley (bunch)', dill:'Dill (bunch)', bananas:'Bananas (box)', eggplant:'Eggplant (box)',
  lemon:'Lemon (kg)', carrot:'Carrot (kg)', cucumber:'Cucumber (each)', leni_peppers:'Leni Peppers (tin)',
  dijon_mustard:'Dijon Mustard (jar)', mayo:'Mayo (kg)', ketchup:'Ketchup (4L)',
  tuna_mix:'Tuna Mix (5.75kg)', caponata:'Caponata (9.35kg)', mushroom_mix:'Mushroom Mix (2.5kg)',
  schnittas:'Schnittas (unit)', basil_pesto:'Basil Pesto (g)', tiger_sauce:'Tiger Sauce (950g)', honey_mustard_mayo:'Honey Mustard Mayo (900g)',
  butter:'Butter (1.5kg)', olive_oil:'Olive Oil (4L)', salt:'Salt (25kg)', pepper:'Pepper (1kg)', eggs:'Eggs (box)',
  napkins:'Napkins (2000pk)', tray:'Paper Tray (150pk)',
  plain_flour:'Plain Flour (kg)', sr_flour:'SR Flour (kg)', caster_sugar:'Caster Sugar (kg)', brown_sugar:'Brown Sugar (kg)',
  bicarb_soda:'Bicarb Soda (g)', cinnamon:'Cinnamon (g)', vegetable_oil:'Veg Oil (L)', breadcrumbs:'Breadcrumbs (kg)',
  honey:'Honey (kg)', pinenuts:'Pinenuts (kg)',
  // coffee
  coffee_beans:'Coffee (g)', chocolate:'Chocolate (g)', chai:'Chai (g)', fbomb:'F.Bomb (g)',
  decaf_beans:'Decaf (g)', matcha:'Matcha (g)',
  sungold_jersey_fc:'FC Milk (ml)', sungold_lowfat:'Skim Milk (ml)', happy_soy:'Soy (ml)', alt_dairy_oat:'Oat Milk (ml)', alt_dairy_almond:'Almond Milk (ml)',
  bundaberg_raw_sugar:'Sugar (g)',
  cup_small_6oz:'Cup Small (unit)', cup_large_12oz:'Cup Large (unit)', lid_hot:'Lid (unit)',
  cup_detpak_16oz:'Cup 16oz (unit)', lid_sipper:'Sipper Lid (unit)', straw:'Straw (unit)',
};

// Unit/volume conversion factor for size lookup.
// Most master cells hold a per-pack price (e.g. coffee 1kg = $36, milk 2L = $4.22),
// so when a recipe uses 23g of coffee, "size" = 1000 and qty = 23, and the cost
// per-cup is master_price / (size/qty). We need to know the "size" per ingredient.
const AP_INGREDIENT_PACK_SIZE = {
  // food (units are whatever the master cell's price is for)
  sourdough:15, ciabatta:1, potato_bun:60, croissant:1,
  ham:1, beef_pastrami:1, salami:1, tuna:1, chicken:1,            // kg or unit
  mozzarella:1, swiss_cheese:34, taleggio:1, american_cheese:1, parmesan_grated:1, parmesan_block:1,
  tomato:1, sauerkraut:1, pickles:1, mushrooms_raw:1, red_onion:1, fennel:1,
  red_chilli:1, jalapeno:1, parsley:1, dill:1, bananas:1, eggplant:1, lemon:1, carrot:1, cucumber:1, leni_peppers:1,
  dijon_mustard:1, mayo:20, ketchup:1,
  tuna_mix:5.75, caponata:9.35, mushroom_mix:2.5, schnittas:1, basil_pesto:1, tiger_sauce:0.95, honey_mustard_mayo:0.9,
  butter:1.5, olive_oil:4, salt:25, pepper:1, eggs:180,           // eggs in dozens? 15 doz = 180
  napkins:2000, tray:150,
  plain_flour:12.5, sr_flour:12.5, caster_sugar:15, brown_sugar:15, bicarb_soda:0.5, cinnamon:0.5, vegetable_oil:20,
  breadcrumbs:10, honey:3, pinenuts:1,
  // coffee
  coffee_beans:1000, chocolate:1000, chai:1000, fbomb:1000, decaf_beans:1000, matcha:500,
  sungold_jersey_fc:2000, sungold_lowfat:2000, happy_soy:6000, alt_dairy_oat:12000, alt_dairy_almond:12000,
  bundaberg_raw_sugar:15000,
  cup_small_6oz:1000, cup_large_12oz:1000, lid_hot:1000, cup_detpak_16oz:1000, lid_sipper:1000, straw:2500,
};

// ─────────────────────────────────────────────────────────────────────────────
// HTTP entry — Web App doPost
// ─────────────────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const expected = PropertiesService.getScriptProperties().getProperty('ADD_PRODUCT_SECRET');
    const provided = (e && e.parameter && e.parameter.secret) || '';
    if (!expected || provided !== expected) {
      return _json({ ok: false, error: 'unauthorized' }, 401);
    }
    const payload = JSON.parse(e.postData.contents);
    // Route on action so this single web app serves multiple features.
    // No action = legacy add-product calls (back-compatible).
    const action = payload && payload.action;
    let result;
    if (action === 'searchInvoices') {
      result = searchInvoicesForItem_(payload.query);
    } else if (action === 'addCustomIngredient') {
      result = addCustomIngredient_(payload);
    } else {
      result = addProduct_(payload);
    }
    return _json(result);
  } catch (err) {
    return _json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

function _json(obj, code) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN entry — also callable directly from the Apps Script editor for testing
// ─────────────────────────────────────────────────────────────────────────────
function addProduct_(payload) {
  if (!payload || !payload.name || !payload.type) {
    return { ok: false, error: 'missing name or type' };
  }
  const type = String(payload.type).toLowerCase();
  if (type !== 'food' && type !== 'coffee') {
    return { ok: false, error: 'type must be food or coffee' };
  }
  const ingredients = Array.isArray(payload.ingredients) ? payload.ingredients : [];
  if (ingredients.length === 0) {
    return { ok: false, error: 'at least one ingredient required' };
  }
  const retailPrice = Number(payload.retailPrice);
  if (!isFinite(retailPrice) || retailPrice <= 0) {
    return { ok: false, error: 'retailPrice must be a positive number' };
  }

  // Validate every ingredient has a known cell
  const keyToCell = type === 'food' ? AP_FOOD_KEY_TO_CELL : AP_COFFEE_KEY_TO_CELL;
  for (const ing of ingredients) {
    if (!keyToCell[ing.key]) {
      return { ok: false, error: 'unknown ingredient key: ' + ing.key };
    }
    if (!isFinite(Number(ing.qty)) || Number(ing.qty) <= 0) {
      return { ok: false, error: 'ingredient ' + ing.key + ' has invalid qty' };
    }
  }

  // ── Build the list of sections to write ────────────────────────────────────
  // For food: one section. For coffee: either one (no variants) or many.
  const sections = type === 'coffee' && payload.variants
    ? apBuildCoffeeVariants_(payload.name, ingredients, retailPrice, payload.variants)
    : [{ name: String(payload.name).toUpperCase(), ingredients: ingredients, retailPrice: retailPrice }];

  // ── Write to the sheet ─────────────────────────────────────────────────────
  const sheetId = type === 'food' ? AP_FOOD_SHEET_ID : AP_COFFEE_SHEET_ID;
  const sheetName = type === 'food' ? 'FOOD' : 'COFFEE';
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName(sheetName);
  if (!sheet) return { ok: false, error: 'sheet ' + sheetName + ' not found' };

  const sectionsWritten = [];
  for (const s of sections) {
    const startRow = apFindNextEmptyRow_(sheet);
    apWriteSection_(sheet, startRow, s, type);
    sectionsWritten.push({ name: s.name, row: startRow });
  }

  // ── Create matching Notion DB rows ─────────────────────────────────────────
  const notionResults = [];
  for (const s of sections) {
    const r = apCreateNotionProduct_(s.name, type === 'coffee' ? 'Coffee' : 'Food');
    notionResults.push({ name: s.name, notionId: r.id || null, ok: r.ok });
  }

  // ── Trigger downstream syncs ───────────────────────────────────────────────
  // Sleep a couple of seconds so the sheet writes settle before SyncCostings reads.
  Utilities.sleep(2000);
  try {
    // These will be defined in their respective files. Wrapped in try/catch so
    // a failure doesn't block the response.
    if (type === 'food') {
      if (typeof syncCostingsToNotion === 'function') syncCostingsToNotion();
    } else {
      if (typeof syncCoffeeToNotion === 'function') syncCoffeeToNotion();
    }
  } catch (e) { Logger.log('sync trigger failed: ' + e.message); }
  try {
    if (typeof buildRecipeMap === 'function') buildRecipeMap();
  } catch (e) { Logger.log('buildRecipeMap trigger failed: ' + e.message); }

  return { ok: true, sectionsWritten: sectionsWritten, notion: notionResults };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION WRITER — places a new recipe section at the given row
// ─────────────────────────────────────────────────────────────────────────────
// Layout (matches existing sections in the sheets):
//   row N:    col A = "PRODUCT NAME"            ← section header
//   row N+1:  (blank)
//   row N+2:  Item | Size | Cost | Amount Used | Units Per Volume | Price Per Cup
//   row N+3:  <ingredient 1>
//   ...
//   row N+3+M:(blank)
//   row N+5+M:                             E="Total"            F=SUM
//   row N+6+M:                             E="Wastage"          F=Total*0.1
//   row N+7+M:                             E="Total + Wastage"  F=Total+Wastage
//   row N+8+M:                             E="Retail Price"     F=<retail>
//   row N+9+M:                             E="Profit"           F=Retail-T+W
//   row N+10+M:                            E="Profit %"         F=Profit/Retail*100
// ─────────────────────────────────────────────────────────────────────────────
function apWriteSection_(sheet, startRow, section, type) {
  const keyToCell = type === 'food' ? AP_FOOD_KEY_TO_CELL : AP_COFFEE_KEY_TO_CELL;
  const headerLabel = type === 'food' ? 'Price Per Mix' : 'Price Per Cup';
  const amountLabel = type === 'food' ? 'Amount Used Per Mix' : 'Amount Used Per Cup';

  // 1. Section header
  sheet.getRange(startRow, 1).setValue(section.name);

  // 2. Column header row (one row below)
  const headerRow = startRow + 2;
  const headers = ['Item', 'Size', 'Cost', amountLabel, 'Units Per Volume', headerLabel];
  sheet.getRange(headerRow, 1, 1, 6).setValues([headers]);

  // 3. Recipe rows
  const ings = section.ingredients;
  const recipeStartRow = headerRow + 1;
  for (let i = 0; i < ings.length; i++) {
    const row = recipeStartRow + i;
    const cellRef = keyToCell[ings[i].key];
    const packSize = AP_INGREDIENT_PACK_SIZE[ings[i].key] || 1;
    // Friendly label; fall back to title-cased key if not in the map.
    const label = AP_INGREDIENT_LABELS[ings[i].key]
      || ings[i].key.replace(/_/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); });
    const qty = Number(ings[i].qty);
    sheet.getRange(row, 1).setValue(label);                            // A: label
    sheet.getRange(row, 2).setValue(packSize);                         // B: size
    sheet.getRange(row, 3).setFormula('=' + cellRef);                  // C: cost from master grid
    sheet.getRange(row, 4).setValue(qty);                              // D: amount used
    sheet.getRange(row, 5).setFormula('=B' + row + '/D' + row);        // E: units per volume
    sheet.getRange(row, 6).setFormula('=C' + row + '/E' + row);        // F: price per mix/cup
  }

  // 4. Summary block
  const summaryStart = recipeStartRow + ings.length + 1;
  const firstIngF = 'F' + recipeStartRow;
  const lastIngF = 'F' + (recipeStartRow + ings.length - 1);
  const totalRow = summaryStart;
  sheet.getRange(totalRow, 5).setValue('Total');
  sheet.getRange(totalRow, 6).setFormula('=SUM(' + firstIngF + ':' + lastIngF + ')');
  sheet.getRange(totalRow + 1, 5).setValue('Wastage');
  sheet.getRange(totalRow + 1, 6).setFormula('=F' + totalRow + '*0.1');
  sheet.getRange(totalRow + 2, 5).setValue('Total + Wastage');
  sheet.getRange(totalRow + 2, 6).setFormula('=F' + totalRow + '+F' + (totalRow + 1));
  sheet.getRange(totalRow + 3, 5).setValue('Retail Price');
  sheet.getRange(totalRow + 3, 6).setValue(section.retailPrice);
  sheet.getRange(totalRow + 4, 5).setValue('Profit');
  sheet.getRange(totalRow + 4, 6).setFormula('=F' + (totalRow + 3) + '-F' + (totalRow + 2));
  sheet.getRange(totalRow + 5, 5).setValue('Profit %');
  sheet.getRange(totalRow + 5, 6).setFormula('=F' + (totalRow + 4) + '/F' + (totalRow + 3) + '*100');
}

// Append at the bottom of the sheet. Adds 3 empty rows of spacing so a future
// run doesn't accidentally treat the previous section's last row as ours.
function apFindNextEmptyRow_(sheet) {
  const lastRow = sheet.getLastRow();
  return lastRow + 4;
}

// ─────────────────────────────────────────────────────────────────────────────
// COFFEE VARIANTS — generate sections from one base recipe
// ─────────────────────────────────────────────────────────────────────────────
// Smart variant rules:
//   - If user selects milks in variants and the base recipe has no milk,
//     auto-inject the picked milk per variant. Hot small=150ml, hot large=300ml,
//     iced=300ml (regardless of size).
//   - Iced products (name contains "ICED") get a straw on every variant, and
//     takeaway variants use the 16oz Detpak cup + sipper lid instead of the
//     standard hot cup/lid combo.
//   - Hot takeaway uses cup_small_6oz (small) or cup_large_12oz (large) + lid_hot.
//   - Coffee beans / chai / chocolate / matcha / fbomb scale 2× for large size.
// ─────────────────────────────────────────────────────────────────────────────
function apBuildCoffeeVariants_(baseName, baseIngredients, retailPrice, variants) {
  const milks = (variants.milks && variants.milks.length) ? variants.milks : [null]; // null = no milk
  const sizes = (variants.sizes && variants.sizes.length) ? variants.sizes : ['small'];
  const channels = (variants.channels && variants.channels.length) ? variants.channels : ['dine_in'];

  const isIced = /\bICED\b/i.test(baseName);
  const baseHasMilkKey = baseIngredients.find(i => /^(sungold_jersey_fc|sungold_lowfat|happy_soy|alt_dairy_oat|alt_dairy_almond)$/.test(i.key));

  const sections = [];
  for (const milk of milks) {
    for (const size of sizes) {
      for (const channel of channels) {
        const variantIngs = [];
        // Copy each base ingredient, swapping milk and scaling by size
        for (const ing of baseIngredients) {
          let key = ing.key;
          let qty = ing.qty;
          if (baseHasMilkKey && key === baseHasMilkKey.key && milk) key = milk;
          if (size === 'large' && /^(coffee_beans|decaf_beans|chai|chocolate|matcha|fbomb)$/.test(key)) qty *= 2;
          if (size === 'large' && /^(sungold_jersey_fc|sungold_lowfat|happy_soy|alt_dairy_oat|alt_dairy_almond)$/.test(key)) qty *= 2;
          variantIngs.push({ key: key, qty: qty });
        }
        // Auto-inject milk if user picked one but base lacked it
        if (!baseHasMilkKey && milk) {
          const milkQty = isIced ? 300 : (size === 'large' ? 300 : 150);
          variantIngs.push({ key: milk, qty: milkQty });
        }
        // Iced products get a straw on every variant
        if (isIced) {
          variantIngs.push({ key: 'straw', qty: 1 });
        }
        // Add cup + lid for takeaway
        if (channel === 'takeaway') {
          if (isIced) {
            variantIngs.push({ key: 'cup_detpak_16oz', qty: 1 });
            variantIngs.push({ key: 'lid_sipper', qty: 1 });
          } else {
            variantIngs.push({ key: size === 'large' ? 'cup_large_12oz' : 'cup_small_6oz', qty: 1 });
            variantIngs.push({ key: 'lid_hot', qty: 1 });
          }
        }
        // Construct the variant name
        const milkLabel = milk ? apMilkLabel_(milk) : '';
        const channelLabel = channel === 'takeaway' ? 'TAKEAWAY' : 'DINE IN';
        const sizeLabel = size === 'large' ? ' (LARGE)' : '';
        const name = (channelLabel + ' ' + (milkLabel ? milkLabel + ' ' : '') + baseName + sizeLabel).toUpperCase().replace(/\s+/g, ' ').trim();
        sections.push({ name: name, ingredients: variantIngs, retailPrice: retailPrice });
      }
    }
  }
  return sections;
}

function apMilkLabel_(key) {
  return ({
    sungold_jersey_fc: '',          // "FC MILK" omitted — default
    sungold_lowfat: 'SKIM',
    happy_soy: 'SOY',
    alt_dairy_oat: 'OAT',
    alt_dairy_almond: 'ALMOND',
  })[key] || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTION — create a product row in the Costings DB
// ─────────────────────────────────────────────────────────────────────────────
function apCreateNotionProduct_(name, category) {
  if (!AP_NOTION_API_KEY) return { ok: false, error: 'no API key' };
  const body = {
    parent: { database_id: AP_NOTION_DB_ID },
    properties: {
      Name: { title: [{ text: { content: name } }] },
      Category: { select: { name: category } },
    },
  };
  const res = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + AP_NOTION_API_KEY,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data.object === 'error') return { ok: false, error: data.message };
  return { ok: true, id: data.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// SMOKE TEST — run this from the editor to confirm a known payload works
// before wiring up the Web App. Creates a "TEST PRODUCT" food section.
// ─────────────────────────────────────────────────────────────────────────────
function addProductSmokeTest() {
  const result = addProduct_({
    type: 'food',
    name: 'TEST H+C SANDWICH (DELETE ME)',
    retailPrice: 14.50,
    ingredients: [
      { key: 'sourdough', qty: 2 },
      { key: 'ham', qty: 0.05 },
      { key: 'mozzarella', qty: 0.04 },
      { key: 'butter', qty: 0.01 },
      { key: 'pepper', qty: 0.001 },
      { key: 'napkins', qty: 1 },
    ],
  });
  Logger.log(JSON.stringify(result, null, 2));
}
