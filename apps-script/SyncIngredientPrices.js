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
  Logger.log('Ingredient prices synced: ' + prices.ingredients.length + ' ingredients');
}

function sipCollectPrices_() {
  const ingredients = [];
  const seen = {};

  // ── COFFEE SHEET ───────────────────────────────────────────────────────────
  // Read directly from the MASTER price cells (the ones ScanSuppliers writes to),
  // not from the recipe blocks. The previous approach iterated all rows looking
  // for "Milk (ml) | 12000 | $X" patterns, which wrongly grouped multiple
  // products by size and gave incorrect labels (e.g. FC MILK 12L showing the
  // Alt.Dairy 12L carton price). Cell-based lookup is precise and stable.
  //
  // Master price layout (label column → value column):
  //   A→B  coffee/chai/chocolate/decaf/matcha  (rows 5–10)
  //   C→D  milks (rows 5–9)
  //   E→F  sugar (row 5)
  //   G→H  packaging — cups/lids/straws (rows 5–10)
  const coffeeSheet = SpreadsheetApp.openById(SIP_COFFEE_SHEET_ID).getSheetByName('COFFEE');

  // Direct cell reads (rather than getDataRange()) so we don't lose trailing
  // columns. Slightly more API calls but reliable across all sheet shapes.
  function cc(col, row) {
    try {
      const v = coffeeSheet.getRange(row, col).getValue();
      return (typeof v === 'number' && v > 0) ? v : null;
    } catch (e) { return null; }
  }

  const coffeeIngredients = [
    // ── BEANS / CHOCOLATE / TEA ───────────────────────────────────────────────
    { key: 'coffee_beans',     name: 'Golden Gate Espresso Blend (1kg)', col: 2, row: 5,  unit: '1kg',    supplier: 'Seven Seeds' },
    { key: 'chocolate',        name: 'Mörk Chocolate (1kg)',             col: 2, row: 6,  unit: '1kg',    supplier: 'Mörk' },
    { key: 'chai',             name: 'Fly High Chai (1L)',               col: 2, row: 7,  unit: '1L',     supplier: 'Seven Seeds' },
    { key: 'fbomb',            name: 'F.Bomb Filter Blend (1kg)',        col: 2, row: 8,  unit: '1kg',    supplier: 'Seven Seeds' },
    { key: 'decaf_beans',      name: 'La Serrania Decaf (1kg)',          col: 2, row: 9,  unit: '1kg',    supplier: 'Seven Seeds' },
    { key: 'matcha',           name: 'Matsu Matcha (500g)',              col: 2, row: 10, unit: '500g',   supplier: 'Matsu Tea' },
    // ── MILK ─────────────────────────────────────────────────────────────────
    { key: 'sungold_jersey_fc',name: 'Sungold Full Cream Milk (2LT)',    col: 4, row: 5,  unit: '2LT',    supplier: 'Redi Milk' },
    { key: 'sungold_lowfat',   name: 'Sungold Skinny Milk (2LT)',        col: 4, row: 6,  unit: '2LT',    supplier: 'Redi Milk' },
    { key: 'happy_soy',        name: 'Happy Happy Soy Boy (6LT)',        col: 4, row: 7,  unit: '6LT',    supplier: 'Redi Milk' },
    { key: 'alt_dairy_oat',    name: 'Alternative Dairy Oat (12LT)',     col: 4, row: 8,  unit: '12LT',   supplier: 'Redi Milk' },
    { key: 'alt_dairy_almond', name: 'Alternative Dairy Almond (12LT)',  col: 4, row: 9,  unit: '12LT',   supplier: 'Redi Milk' },
    // ── SUGAR ────────────────────────────────────────────────────────────────
    { key: 'bundaberg_raw_sugar',name:'Bundaberg Raw Sugar (15KG)',      col: 6, row: 5,  unit: '15KG',   supplier: '5Ways' },
    // ── PACKAGING ────────────────────────────────────────────────────────────
    { key: 'cup_small_6oz',    name: 'Compostable Cup 6oz (1000)',       col: 8, row: 5,  unit: '1000pk', supplier: 'Planetware' },
    { key: 'cup_large_12oz',   name: 'Compostable Cup 12oz Slim (1000)', col: 8, row: 6,  unit: '1000pk', supplier: 'Planetware' },
    { key: 'lid_hot',          name: 'CPLA Natural Lid 8oz (1000)',      col: 8, row: 7,  unit: '1000pk', supplier: 'Planetware' },
    { key: 'cup_detpak_16oz',  name: "G'Day Tiger 16oz Detpak Cups (1000)", col: 8, row: 8, unit: '1000pk', supplier: '5Ways' },
    { key: 'lid_sipper',       name: 'Plastic Sipper Lids (1000)',       col: 8, row: 9,  unit: '1000pk', supplier: 'Trio Supplies' },
    { key: 'straw',            name: 'Paper Straws (2500)',              col: 8, row: 10, unit: '2500pk', supplier: 'Trio Supplies' },
  ];

  for (const ing of coffeeIngredients) {
    const price = cc(ing.col, ing.row);
    if (price !== null) {
      ingredients.push({ key: ing.key, name: ing.name, price: price, unit: ing.unit, supplier: ing.supplier });
    }
  }

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
  //   GDay Tiger → L col (Made In House — formula-driven)
  //   Manual     → B6 (Candied), B8 (Noisette), N7, P5–P7, H20

  const foodSheet = SpreadsheetApp.openById(SIP_FOOD_SHEET_ID).getSheetByName('FOOD');
  const foodData  = foodSheet.getDataRange().getValues();

  function fc(col, row) {
    try {
      const v = foodData[row - 1][col - 1];
      return (typeof v === 'number' && v > 0) ? v : null;
    } catch (e) { return null; }
  }

  const foodIngredients = [
    // ── BREAD ────────────────────────────────────────────────────────────────
    { key: 'sourdough',          name: 'Sourdough Loaf (15sl, Dench)',      col: 2,  row: 5,  unit: '15sl loaf', supplier: 'Dench' },
    { key: 'ciabatta',           name: 'Ciabatta (Candied)',                col: 2,  row: 6,  unit: 'unit',      supplier: 'Candied' },
    { key: 'potato_bun',         name: "Potato Buns x60 (Martin's)",        col: 2,  row: 7,  unit: '60pk',      supplier: '5Ways' },
    { key: 'croissant',          name: 'Croissant (Noisette)',              col: 2,  row: 8,  unit: 'unit',      supplier: 'Noisette' },
    // ── MEATS ────────────────────────────────────────────────────────────────
    { key: 'ham',                name: 'Prosciutto Cotto / Ham (kg)',       col: 4,  row: 5,  unit: 'kg',        supplier: '5Ways' },
    { key: 'beef_pastrami',      name: 'Beef Pastrami (kg)',                col: 4,  row: 6,  unit: 'kg',        supplier: "Uncle's" },
    { key: 'salami',             name: 'Salami (kg)',                       col: 4,  row: 7,  unit: 'kg',        supplier: '5Ways' },
    { key: 'tuna',               name: 'Tuna (425g tin)',                   col: 4,  row: 8,  unit: '425g tin',  supplier: '5Ways' },
    { key: 'chicken',            name: 'Chicken (kg)',                      col: 4,  row: 9,  unit: 'kg',        supplier: 'PFD Foods' },
    // ── CHEESE ───────────────────────────────────────────────────────────────
    { key: 'mozzarella',         name: 'Mozzarella (kg)',                   col: 6,  row: 5,  unit: 'kg',        supplier: '5Ways' },
    { key: 'swiss_cheese',       name: 'Swiss Cheese (34pk)',               col: 6,  row: 6,  unit: '34pk',      supplier: '5Ways' },
    { key: 'taleggio',           name: 'Taleggio (kg)',                     col: 6,  row: 7,  unit: 'kg',        supplier: '5Ways' },
    { key: 'american_cheese',    name: 'Hi Melt American Cheese (kg)',      col: 6,  row: 8,  unit: 'kg',        supplier: '5Ways' },
    { key: 'parmesan_grated',    name: 'Parmesan Grated (kg)',              col: 6,  row: 9,  unit: 'kg',        supplier: '5Ways' },
    { key: 'parmesan_block',     name: 'Parmesan Block (kg)',               col: 6,  row: 10, unit: 'kg',        supplier: 'Woolworths' },
    // ── VEGETABLES ───────────────────────────────────────────────────────────
    { key: 'tomato',             name: 'Tomato (kg)',                       col: 8,  row: 5,  unit: 'kg',        supplier: 'Sciclunas' },
    { key: 'sauerkraut',         name: 'Sauerkraut (770g tin)',             col: 8,  row: 6,  unit: '770g tin',  supplier: 'PFD Foods' },
    { key: 'pickles',            name: "McClure's Pickles (19L drum)",      col: 8,  row: 7,  unit: '19L drum',  supplier: 'Product Distribution' },
    { key: 'mushrooms_raw',      name: 'Mushrooms (box)',                   col: 8,  row: 8,  unit: 'box',       supplier: 'Sciclunas' },
    { key: 'red_onion',          name: 'Red Onion (kg)',                    col: 8,  row: 9,  unit: 'kg',        supplier: 'Sciclunas' },
    { key: 'fennel',             name: 'Fennel (each)',                     col: 8,  row: 10, unit: 'each',      supplier: 'Sciclunas' },
    { key: 'red_chilli',         name: 'Red Chilli (kg)',                   col: 8,  row: 11, unit: 'kg',        supplier: 'Sciclunas' },
    { key: 'jalapeno',           name: 'Jalapeno (kg)',                     col: 8,  row: 12, unit: 'kg',        supplier: 'Sciclunas' },
    { key: 'parsley',            name: 'Parsley (bunch)',                   col: 8,  row: 13, unit: 'bunch',     supplier: 'Sciclunas' },
    { key: 'dill',               name: 'Dill (bunch)',                      col: 8,  row: 14, unit: 'bunch',     supplier: 'Sciclunas' },
    { key: 'bananas',            name: 'Bananas Cooking (box)',             col: 8,  row: 15, unit: 'box',       supplier: 'Sciclunas' },
    { key: 'eggplant',           name: 'Eggplant (box)',                    col: 8,  row: 16, unit: 'box',       supplier: 'Sciclunas' },
    { key: 'lemon',              name: 'Lemon (kg)',                        col: 8,  row: 17, unit: 'kg',        supplier: 'Sciclunas' },
    { key: 'carrot',             name: 'Carrot (kg)',                       col: 8,  row: 18, unit: 'kg',        supplier: 'Sciclunas' },
    { key: 'cucumber',           name: 'Cucumber (each)',                   col: 8,  row: 19, unit: 'each',      supplier: 'Sciclunas' },
    { key: 'leni_peppers',       name: 'Leni Peppers (tin)',                col: 8,  row: 20, unit: 'tin',       supplier: '5Ways' },
    // ── SAUCES ───────────────────────────────────────────────────────────────
    { key: 'dijon_mustard',      name: 'Dijon Mustard (2.5kg jar)',         col: 10, row: 5,  unit: '2.5kg jar', supplier: '5Ways' },
    { key: 'mayo',               name: 'Hellmans Mayo (20kg)',              col: 10, row: 6,  unit: '20kg',      supplier: '5Ways' },
    { key: 'ketchup',            name: 'Heinz Ketchup (4L)',                col: 10, row: 7,  unit: '4L',        supplier: '5Ways' },
    // ── MADE IN HOUSE ────────────────────────────────────────────────────────
    { key: 'tuna_mix',           name: 'Tuna Mix (5.75kg)',                 col: 12, row: 5,  unit: '5.75kg',    supplier: 'GDay Tiger' },
    { key: 'caponata',           name: 'Caponata (9.35kg)',                 col: 12, row: 6,  unit: '9.35kg',    supplier: 'GDay Tiger' },
    { key: 'mushroom_mix',       name: 'Mushroom Mix (2.5kg)',              col: 12, row: 7,  unit: '2.5kg',     supplier: 'GDay Tiger' },
    { key: 'schnittas',          name: 'Schnittas (unit)',                  col: 12, row: 8,  unit: 'unit',      supplier: 'GDay Tiger' },
    { key: 'tiger_sauce',        name: 'Tiger Sauce (950g)',                col: 12, row: 10, unit: '950g',      supplier: 'GDay Tiger' },
    { key: 'honey_mustard_mayo', name: 'Honey Mustard Mayo (900g)',         col: 12, row: 11, unit: '900g',      supplier: 'GDay Tiger' },
    // ── EXTRAS ───────────────────────────────────────────────────────────────
    { key: 'butter',             name: 'Butter (1.5kg)',                    col: 14, row: 5,  unit: '1.5kg',     supplier: '5Ways' },
    { key: 'olive_oil',          name: 'Olive Oil (4L)',                    col: 14, row: 6,  unit: '4L',        supplier: '5Ways' },
    { key: 'salt',               name: 'Sea Salt (25kg)',                   col: 14, row: 7,  unit: '25kg',      supplier: '5Ways' },
    { key: 'pepper',             name: 'Pepper (1kg)',                      col: 14, row: 8,  unit: '1kg',       supplier: '5Ways' },
    { key: 'eggs',               name: 'Eggs (15doz box)',                  col: 14, row: 9,  unit: '15doz box', supplier: 'Sciclunas' },
    // ── PACKAGING ────────────────────────────────────────────────────────────
    { key: 'napkins',            name: 'Napkins (2000pk)',                  col: 16, row: 8,  unit: '2000pk',    supplier: 'Trio Supplies' },
    { key: 'tray',               name: 'Paper Tray (150pk)',                col: 16, row: 9,  unit: '150pk',     supplier: 'Trio Supplies' },
    // ── PANTRY ───────────────────────────────────────────────────────────────
    { key: 'plain_flour',        name: 'Plain Flour (12.5kg)',              col: 18, row: 5,  unit: '12.5kg',    supplier: '5Ways' },
    { key: 'sr_flour',           name: 'Self-Raising Flour (12.5kg)',       col: 18, row: 6,  unit: '12.5kg',    supplier: '5Ways' },
    { key: 'caster_sugar',       name: 'Caster Sugar (15kg)',               col: 18, row: 7,  unit: '15kg',      supplier: '5Ways' },
    { key: 'brown_sugar',        name: 'Brown Sugar (15kg)',                col: 18, row: 8,  unit: '15kg',      supplier: '5Ways' },
    { key: 'bicarb_soda',        name: 'Bicarb Soda (500g)',                col: 18, row: 9,  unit: '500g',      supplier: '5Ways' },
    { key: 'cinnamon',           name: 'Cinnamon (500g)',                   col: 18, row: 10, unit: '500g',      supplier: '5Ways' },
    { key: 'vegetable_oil',      name: 'Vegetable Oil (20L)',               col: 18, row: 11, unit: '20L',       supplier: '5Ways' },
    // (sungold_milk removed — Coffee sheet D5 is the canonical Sungold Jersey FC entry)
    { key: 'breadcrumbs',        name: 'Breadcrumbs Panko (10kg)',          col: 18, row: 13, unit: '10kg',      supplier: '5Ways' },
    { key: 'honey',              name: 'Honey (3kg)',                       col: 18, row: 14, unit: '3kg',       supplier: '5Ways' },
    { key: 'pinenuts',           name: 'Pinenuts Kernel (1kg)',             col: 18, row: 15, unit: '1kg',       supplier: '5Ways' },
  ];

  for (const ing of foodIngredients) {
    const price = fc(ing.col, ing.row);
    if (price !== null) {
      ingredients.push({ key: ing.key, name: ing.name, price: price, unit: ing.unit, supplier: ing.supplier });
    }
  }

  // ── Custom ingredients (added via the app's Supplier Prices "+") ──────────────
  // Read from the dynamic CustomIngredients tab (see AddIngredient.js) and merge
  // any not already present by key, so app-added items appear in Supplier Prices.
  try {
    const have = {};
    ingredients.forEach(function (i) { have[i.key] = true; });
    sipCustomIngredients_().forEach(function (ci) {
      if (ci.price > 0 && !have[ci.key]) ingredients.push(ci);
    });
  } catch (e) { /* AddIngredient.js helpers unavailable — skip */ }

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