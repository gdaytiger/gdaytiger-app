// BuildRecipeMap.js
// Parses the FOOD costings spreadsheet, extracts ingredient→product
// relationships by reading getFormulas() on each recipe section, resolves
// "Made In House" multi-hop (e.g. lemon → Caponata Mix → Caponata Sandwich),
// and writes a recipe_map JSON block to the Notion OS page.
//
// Run buildRecipeMap() manually first; check Logger output; then attach a
// daily trigger via createRecipeMapTrigger().

const BRM_NOTION_API_KEY  = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
const BRM_NOTION_PAGE_ID  = '3403c99c0e858113a941c2118b3cdef9';
const BRM_FOOD_SHEET_ID   = '1nZvWNFaQTrJAt-ilYihZjYZKBzHd6x3qIrjFhdNQqAU';
const BRM_COFFEE_SHEET_ID = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI';

// Master cell map for the COFFEE sheet (mirrors SyncIngredientPrices.js).
// Layout: A→B beans/chocolate/chai/etc, C→D milks, E→F sugar, G→H packaging.
const BRM_COFFEE_CELL_TO_KEY = {
  'B5':  'coffee_beans',       'B6': 'chocolate',          'B7': 'chai',
  'B8':  'fbomb',              'B9': 'decaf_beans',        'B10': 'matcha',
  'D5':  'sungold_jersey_fc',  'D6': 'sungold_lowfat',     'D7': 'happy_soy',
  'D8':  'alt_dairy_oat',      'D9': 'alt_dairy_almond',
  'F5':  'bundaberg_raw_sugar',
  'H5':  'cup_small_6oz',      'H6': 'cup_large_12oz',     'H7': 'lid_hot',
  'H8':  'cup_detpak_16oz',    'H9': 'lid_sipper',         'H10': 'straw',
};

// ─────────────────────────────────────────────────────────────────────────────
// Master ingredient cell map (mirrors SyncIngredientPrices.js exactly).
// Key = A1 cell reference. Value = ingredient key.
// Cells in MADE-IN-HOUSE rows (L col, rows 5–13) point at SUB-RECIPES that
// are expanded recursively after the first pass.
// ─────────────────────────────────────────────────────────────────────────────
// Food-sheet cell → ingredient key. DERIVED from the single source of truth in
// IngredientCatalog.js (FOOD_INGREDIENTS + FOOD_RECIPE_ONLY) via foodCellToKeyMap_().
// Add a new ingredient there once and it resolves in BOTH pricing and recipe
// attribution — no second table to keep in sync. (Made-in-house L-cells expand
// recursively in the parser below.)

// Made-in-house keys (these get expanded into their sub-recipe ingredients)
const BRM_MADE_IN_HOUSE = ['tuna_mix', 'caponata', 'mushroom_mix', 'schnittas',
                           'basil_pesto', 'tiger_sauce', 'honey_mustard_mayo',
                           'pickled_onions', 'fennel_slaw'];

// Map of K-col label prefix → MIH key. Used by the sub-recipe auto-detector to
// figure out which made-in-house item each L-col formula corresponds to.
const BRM_MIH_LABEL_TO_KEY = {
  'TUNA MIX':            'tuna_mix',
  'CAPONATA':            'caponata',
  'MUSHROOM MIX':        'mushroom_mix',
  'SCHNITTAS':           'schnittas',
  'PESTO':               'basil_pesto',
  'BASIL PESTO':         'basil_pesto',
  'TIGER SAUCE':         'tiger_sauce',
  'HONEY MUSTARD MAYO':  'honey_mustard_mayo',
  'PICKLED ONIONS':      'pickled_onions',
  'FENNEL SLAW':         'fennel_slaw',
};

// ─── MANUAL OVERRIDES ─────────────────────────────────────────────────────────
// Used to patch gaps where the sheet's formula chain isn't fully wired. Each
// override only applies when the auto-detector returned no data, so the moment
// Jonathan wires the sheet properly the override becomes a no-op automatically.
//
// CURRENT GAP — basil pesto:
//   • L9 has no formula → no auto-detected sub-recipe
//   • Salami Panini's recipe row (A69) labels pesto but has no cost formula
//     referencing L9 → no main-product auto-link
// To remove this override:
//   1. In the FOOD sheet, populate T66–T73 with =Qx/Sx style cost formulas
//      and Q66–Q73 with =master cell refs (e.g. Q73 = =H17 for lemon)
//   2. Set L9 = =T75
//   3. On Salami Panini's basil pesto row, add a cost formula that references
//      L9 within cols A–D (e.g. D69 = =L9 * (qty / batch))
// ─────────────────────────────────────────────────────────────────────────────
const BRM_SUB_RECIPE_OVERRIDES = {
  basil_pesto: ['olive_oil', 'parmesan_grated', 'pinenuts', 'salt', 'pepper', 'lemon'],
};

// Section header (UPPERCASE) → array of MIH/ingredient keys to add to that
// product's direct ingredient list. Additive only.
const BRM_PRODUCT_DIRECT_OVERRIDES = {
  'SALAMI PANINI': ['basil_pesto'],
};

// Notion product name (lowercase) → section header in the sheet.
// Extends the mapping in SyncCostingsToNotion.js. Verified against the actual
// Notion product list pulled on 2026-05-17 (81 products; 5 sandwich entries
// needed name normalisation, 75 are coffee items we don't yet parse).
const BRM_NOTION_TO_SHEET = {
  'autogrill (salami panini)':  'SALAMI PANINI',
  'caponata':                   'CAPONATA SANDWICH',
  'caponata (mozzarella)':      'CAPONATA SANDWICH (WITH CHEESE)',
  'mushroom':                   'MUSHROOM SANDWICH',
  'filled croissant':           'H+C CROISSANT',
  'h+c':                        'H+C SANDWICH',
  'h+c (tiger style)':          'H+C SANDWICH (TIGER STYLE)',
  'tuna':                       'TUNA SANDWICH',
  'beef':                       'BEEF SANDWICH',
};

// Sub-recipes are auto-detected from L-col formulas — see brmAutoDetectSubRecipes_().
// Each L-cell with a formula like "=M47" points at the TOTAL cell of its sub-recipe.
// Walking upward in that column from the previous total (or top) yields all the
// formula cells that reference master grid ingredients. No hard-coded headers needed.

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY
// ─────────────────────────────────────────────────────────────────────────────
function buildRecipeMap() {
  const sheet     = SpreadsheetApp.openById(BRM_FOOD_SHEET_ID).getSheetByName('FOOD');
  const data      = sheet.getDataRange().getValues();
  const formulas  = sheet.getDataRange().getFormulas();
  const rowCount  = data.length;
  const colCount  = (data[0] || []).length;

  Logger.log('=== BuildRecipeMap ===');
  Logger.log('Sheet size: ' + rowCount + ' rows × ' + colCount + ' cols');

  // ── 1. Find all section headers (uppercase-ish strings in col A or E) ──────
  const sections = brmFindSections_(data);
  Logger.log('Sections detected: ' + sections.length);
  sections.forEach(function (s) {
    Logger.log('  · row ' + (s.row + 1) + ' col ' + brmColLetter_(s.col + 1) + ': "' + s.header + '"');
  });

  // ── 2. Parse formulas in each section to find ingredient cell refs ─────────
  const sectionRecipes = {};
  sections.forEach(function (s, idx) {
    const endRow = (idx + 1 < sections.length) ? sections[idx + 1].row : Math.min(s.row + 40, rowCount);
    const ingredients = brmExtractIngredientsForSection_(formulas, s.row, endRow);
    sectionRecipes[s.header.toUpperCase()] = ingredients;
  });

  // ── 3. Auto-detect sub-recipes (made-in-house keys → ingredients) ──────────
  const subRecipeIngredients = brmAutoDetectSubRecipes_(formulas, data);
  for (const k in BRM_SUB_RECIPE_OVERRIDES) {
    if (!subRecipeIngredients[k] || subRecipeIngredients[k].length === 0) {
      subRecipeIngredients[k] = BRM_SUB_RECIPE_OVERRIDES[k].slice();
      Logger.log('  ⚙ Override applied for sub-recipe: ' + k);
    }
  }
  Logger.log('Sub-recipes (after overrides): ' + Object.keys(subRecipeIngredients).length);
  for (const k in subRecipeIngredients) {
    Logger.log('  · ' + k + ' → ' + JSON.stringify(subRecipeIngredients[k]));
  }

  // ── 4. Build the products map (Notion products → expanded ingredient list) ─
  const notionProducts = brmGetNotionProducts_();
  Logger.log('Notion products fetched: ' + notionProducts.length);

  const coffeeProductsMap = brmBuildCoffeeProductsMap_();
  Logger.log('Coffee sections parsed: ' + Object.keys(coffeeProductsMap).length);

  const products = {};
  const missed   = [];
  notionProducts.forEach(function (p) {
    const sectionHeader = (BRM_NOTION_TO_SHEET[p.name.toLowerCase().trim()] || p.name).toUpperCase();

    let direct = sectionRecipes[sectionHeader];
    let source = 'food';
    if (!direct) {
      direct = coffeeProductsMap[sectionHeader];
      source = 'coffee';
    }
    if (!direct) {
      missed.push(p.name + ' (looked for "' + sectionHeader + '")');
      return;
    }

    const directWithOverrides = direct.slice();
    if (BRM_PRODUCT_DIRECT_OVERRIDES[sectionHeader]) {
      BRM_PRODUCT_DIRECT_OVERRIDES[sectionHeader].forEach(function (k) {
        if (directWithOverrides.indexOf(k) === -1) directWithOverrides.push(k);
      });
    }
    const expanded = brmExpandIngredients_(directWithOverrides, subRecipeIngredients);
    products[p.name] = {
      id: p.id,
      section: sectionHeader,
      source: source,
      direct: directWithOverrides,
      expanded: expanded,
    };
    Logger.log('Product (' + source + '): ' + p.name + ' → ' + JSON.stringify(expanded));
  });
  if (missed.length) {
    Logger.log('Products with no matching section: ' + missed.length);
    missed.forEach(function (m) { Logger.log('  · ' + m); });
  }

  // ── 5. Build inverse map: ingredient_to_products ───────────────────────────
  const ingredientToProducts = {};
  for (const pname in products) {
    products[pname].expanded.forEach(function (ingKey) {
      if (!ingredientToProducts[ingKey]) ingredientToProducts[ingKey] = [];
      if (ingredientToProducts[ingKey].indexOf(pname) === -1) {
        ingredientToProducts[ingKey].push(pname);
      }
    });
  }

  Logger.log('Inverse map: ' + Object.keys(ingredientToProducts).length + ' ingredients referenced');
  Logger.log('Lemon → ' + JSON.stringify(ingredientToProducts['lemon'] || []));
  Logger.log('Mozzarella → ' + JSON.stringify(ingredientToProducts['mozzarella'] || []));
  Logger.log('Eggplant → ' + JSON.stringify(ingredientToProducts['eggplant'] || []));

  // ── 6. Write to Notion ─────────────────────────────────────────────────────
  const payload = {
    type: 'recipe_map',
    updated: new Date().toISOString(),
    products: products,
    ingredient_to_products: ingredientToProducts,
    sub_recipes: subRecipeIngredients,
    missed_products: missed,
  };

  brmWriteToNotion_(payload);
  Logger.log('✓ recipe_map written to Notion. ' + Object.keys(products).length + ' products, '
             + Object.keys(ingredientToProducts).length + ' ingredients indexed.');

  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION DETECTION
// ─────────────────────────────────────────────────────────────────────────────
const BRM_MIN_PRODUCT_ROW = 25;

function brmFindSections_(data) {
  const sections = [];
  for (let r = BRM_MIN_PRODUCT_ROW; r < data.length; r++) {
    const raw = String((data[r][0] || '')).trim();
    if (raw.length < 4) continue;
    if (!/[A-Z]/.test(raw)) continue;
    if (!/^[A-Z0-9 ()+&'\.\-\/]+$/.test(raw)) continue;
    if (raw !== raw.toUpperCase()) continue;
    if (/\([A-Z]+\d+\)\s*$/.test(raw)) continue;

    let hasBelow = false;
    for (let rr = r + 1; rr < Math.min(r + 4, data.length) && !hasBelow; rr++) {
      for (let cc = 0; cc < 6; cc++) {
        if (String(data[rr][cc] || '').trim() !== '') { hasBelow = true; break; }
      }
    }
    if (!hasBelow) continue;

    const blacklist = ['TOTAL', 'PROFIT', 'PROFIT %', 'RETAIL PRICE', 'WASTAGE',
                       'INGREDIENT', 'COST', 'NAME', 'QTY', 'UNIT', 'NOTES',
                       'BREAD', 'MEATS', 'CHEESE', 'VEGETABLES', 'SAUCES',
                       'MADE IN HOUSE', 'EXTRAS', 'PACKAGING', 'PANTRY',
                       'BEANS', 'MILK', 'SUGAR', 'PRICES'];
    if (blacklist.indexOf(raw) !== -1) continue;

    sections.push({ row: r, col: 0, header: raw });
  }
  return sections;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMULA PARSING
// ─────────────────────────────────────────────────────────────────────────────
const BRM_RECIPE_COL_START = 0;
const BRM_RECIPE_COL_END   = 4;

function brmExtractIngredientsForSection_(formulas, startRow, endRow) {
  const found = {};
  for (let r = startRow + 1; r < endRow; r++) {
    const row = formulas[r] || [];
    for (let c = BRM_RECIPE_COL_START; c < BRM_RECIPE_COL_END && c < row.length; c++) {
      const f = row[c];
      if (!f) continue;
      const matches = String(f).match(/\$?[A-Z]{1,2}\$?\d+/g);
      if (!matches) continue;
      matches.forEach(function (ref) {
        const clean = ref.replace(/\$/g, '');
        const key   = foodCellToKeyMap_()[clean];
        if (key) found[key] = true;
      });
    }
  }
  return Object.keys(found);
}

// ─────────────────────────────────────────────────────────────────────────────
// COFFEE SHEET PARSER
// ─────────────────────────────────────────────────────────────────────────────
function brmBuildCoffeeProductsMap_() {
  const sheet    = SpreadsheetApp.openById(BRM_COFFEE_SHEET_ID).getSheetByName('COFFEE');
  const data     = sheet.getDataRange().getValues();
  const formulas = sheet.getDataRange().getFormulas();
  const products = {};

  const sections = [];
  for (let r = 0; r < data.length; r++) {
    const a = String(data[r][0] || '').trim();
    const b = String(data[r][1] || '').trim();
    const e = String((data[r][4] || '')).trim();
    if (!a || a.length < 4) continue;
    if (b || e) continue;
    if (!/[A-Z]/.test(a) || a !== a.toUpperCase()) continue;
    if (!/^[A-Z0-9 ()+&'\.\-\/]+$/.test(a)) continue;
    if (/\([A-Z]+\d+\)\s*$/.test(a)) continue;
    const blacklist = ['TOTAL', 'PROFIT', 'PROFIT %', 'RETAIL PRICE', 'WASTAGE',
                       'PRICES', 'COFFEE', 'MILK', 'SUGAR', 'PACKAGING',
                       'MILKS', 'EXTRAS', 'PANTRY', 'MADE IN HOUSE'];
    if (blacklist.indexOf(a) !== -1) continue;
    sections.push({ row: r, header: a });
  }

  for (let i = 0; i < sections.length; i++) {
    const s      = sections[i];
    const endRow = (i + 1 < sections.length) ? sections[i + 1].row : Math.min(s.row + 50, data.length);
    const found  = {};
    for (let r = s.row + 1; r < endRow; r++) {
      for (let c = 0; c < 6 && c < (formulas[r] || []).length; c++) {
        const f = formulas[r][c];
        if (!f) continue;
        const matches = String(f).match(/\$?[A-Z]{1,2}\$?\d+/g);
        if (!matches) continue;
        matches.forEach(function (ref) {
          const clean = ref.replace(/\$/g, '');
          const key   = BRM_COFFEE_CELL_TO_KEY[clean];
          if (key) found[key] = true;
        });
      }
    }
    products[s.header] = Object.keys(found);
  }

  return products;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-RECIPE AUTO-DETECTOR
// ─────────────────────────────────────────────────────────────────────────────
function brmAutoDetectSubRecipes_(formulas, values) {
  const subRecipes = {};
  const kColIdx = 10;
  const lColIdx = 11;

  for (let r = 0; r < formulas.length; r++) {
    const f = formulas[r][lColIdx];
    if (!f) continue;
    const m = String(f).match(/^\s*=\s*\$?([A-Z]+)\$?(\d+)\s*$/);
    if (!m) continue;
    const targetCell = m[1] + m[2];

    const label = String(values[r][kColIdx] || '').toUpperCase();
    let mihKey = null;
    for (const prefix in BRM_MIH_LABEL_TO_KEY) {
      if (label.indexOf(prefix) === 0) { mihKey = BRM_MIH_LABEL_TO_KEY[prefix]; break; }
    }
    if (!mihKey) {
      Logger.log('  ⚠ L-col formula at row ' + (r + 1) + ' but K-col label "' + label + '" not recognised');
      continue;
    }

    const ingredients = brmCollectIngredientsTransitive_(formulas, [targetCell], 6);
    subRecipes[mihKey] = ingredients.filter(function (k) { return k !== mihKey; });
  }

  return subRecipes;
}

function brmCollectIngredientsTransitive_(formulas, startCells, maxDepth) {
  const ingredients = {};
  const visited     = {};

  function visit(cellRef, depth) {
    if (depth > maxDepth) return;
    if (visited[cellRef]) return;
    visited[cellRef] = true;

    const key = foodCellToKeyMap_()[cellRef];
    if (key) { ingredients[key] = true; return; }

    const parsed = cellRef.match(/^([A-Z]+)(\d+)$/);
    if (!parsed) return;
    const colIdx = brmA1ColToIdx_(parsed[1]);
    const rowIdx = parseInt(parsed[2], 10) - 1;
    if (rowIdx < 0 || rowIdx >= formulas.length || colIdx < 0) return;

    const row = formulas[rowIdx];
    if (!row) return;
    const f = row[colIdx];
    if (!f) return;

    const expanded = brmExpandRanges_(String(f));
    const refs = expanded.match(/\$?[A-Z]{1,2}\$?\d+/g);
    if (!refs) return;
    refs.forEach(function (ref) {
      visit(ref.replace(/\$/g, ''), depth + 1);
    });
  }

  startCells.forEach(function (c) { visit(c, 0); });
  return Object.keys(ingredients);
}

function brmExpandRanges_(formula) {
  return formula.replace(/\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)/g, function (_, c1, r1, c2, r2) {
    const startCol = brmA1ColToIdx_(c1);
    const endCol   = brmA1ColToIdx_(c2);
    const startRow = parseInt(r1, 10);
    const endRow   = parseInt(r2, 10);
    const cells    = [];
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        cells.push(brmColLetter_(c + 1) + r);
      }
    }
    return cells.join(',');
  });
}

function brmA1ColToIdx_(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// RECURSIVE EXPANSION
// ─────────────────────────────────────────────────────────────────────────────
function brmExpandIngredients_(direct, subRecipes) {
  const out  = {};
  const seen = {};
  function walk(keys, depth) {
    if (depth > 4) return;
    keys.forEach(function (k) {
      if (seen[k]) return;
      seen[k] = true;
      if (BRM_MADE_IN_HOUSE.indexOf(k) !== -1 && subRecipes[k]) {
        out[k] = true;
        walk(subRecipes[k], depth + 1);
      } else {
        out[k] = true;
      }
    });
  }
  walk(direct, 0);
  return Object.keys(out);
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTION
// ─────────────────────────────────────────────────────────────────────────────
function brmGetNotionProducts_() {
  const DB_ID = '8f16358a47e54062b5fe1ce7a7480754';
  const products = [];
  let cursor = null, hasMore = true;
  while (hasMore) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = UrlFetchApp.fetch('https://api.notion.com/v1/databases/' + DB_ID + '/query', {
      method:  'post',
      headers: {
        'Authorization':  'Bearer ' + BRM_NOTION_API_KEY,
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json',
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const parsed = JSON.parse(res.getContentText());
    if (parsed.object === 'error') throw new Error('Notion: ' + parsed.message);
    (parsed.results || []).forEach(function (page) {
      const titleArr = page.properties.Name && page.properties.Name.title;
      const name = (titleArr && titleArr[0]) ? titleArr[0].plain_text : null;
      if (name) products.push({ id: page.id, name: name });
    });
    hasMore = parsed.has_more;
    cursor  = parsed.next_cursor;
  }
  return products;
}

function brmWriteToNotion_(payload) {
  const json = JSON.stringify(payload);
  const headers = {
    'Authorization':  'Bearer ' + BRM_NOTION_API_KEY,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json',
  };

  let allBlocks = [];
  let cursor = null;
  do {
    let url = 'https://api.notion.com/v1/blocks/' + BRM_NOTION_PAGE_ID + '/children?page_size=100';
    if (cursor) url += '&start_cursor=' + cursor;
    const res = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  const existing = allBlocks.find(function (b) {
    if (b.type !== 'code') return false;
    const text = (b.code && b.code.rich_text || []).map(function (r) { return r.plain_text; }).join('');
    return text.indexOf('"recipe_map"') !== -1;
  });

  const chunks = [];
  for (let i = 0; i < json.length; i += 1900) {
    chunks.push({ type: 'text', text: { content: json.slice(i, i + 1900) } });
  }

  const blockBody = JSON.stringify({
    type: 'code',
    code: { language: 'json', rich_text: chunks },
  });

  if (existing) {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + existing.id, {
      method: 'PATCH', headers: headers, payload: blockBody, muteHttpExceptions: true,
    });
  } else {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + BRM_NOTION_PAGE_ID + '/children', {
      method: 'PATCH', headers: headers,
      payload: JSON.stringify({ children: [JSON.parse(blockBody)] }),
      muteHttpExceptions: true,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function brmColLetter_(col) {
  let s = '';
  while (col > 0) {
    const m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────
function buildRecipeMapDryRun() {
  const sheet    = SpreadsheetApp.openById(BRM_FOOD_SHEET_ID).getSheetByName('FOOD');
  const data     = sheet.getDataRange().getValues();
  const formulas = sheet.getDataRange().getFormulas();
  const sections = brmFindSections_(data);

  Logger.log('=== DRY RUN — products: ' + sections.length + ' sections ===');
  sections.forEach(function (s, idx) {
    const endRow = (idx + 1 < sections.length) ? sections[idx + 1].row : Math.min(s.row + 40, data.length);
    const ings   = brmExtractIngredientsForSection_(formulas, s.row, endRow);
    Logger.log((idx + 1) + '. row ' + (s.row + 1) + ' ' + brmColLetter_(s.col + 1) + ': "' + s.header + '"  →  ' + JSON.stringify(ings));
  });

  Logger.log('');
  Logger.log('=== DRY RUN — sub-recipes (auto-detected + overrides) ===');
  const subRecipes = brmAutoDetectSubRecipes_(formulas, data);
  for (const k in BRM_SUB_RECIPE_OVERRIDES) {
    if (!subRecipes[k] || subRecipes[k].length === 0) {
      subRecipes[k] = BRM_SUB_RECIPE_OVERRIDES[k].slice();
      Logger.log('  ⚙ Override applied: ' + k);
    }
  }
  for (const k in subRecipes) {
    Logger.log('  · ' + k + ' → ' + JSON.stringify(subRecipes[k]));
  }

  Logger.log('');
  Logger.log('=== DRY RUN — COFFEE products ===');
  const coffee = brmBuildCoffeeProductsMap_();
  const coffeeKeys = Object.keys(coffee);
  Logger.log(coffeeKeys.length + ' coffee sections parsed');
  coffeeKeys.slice(0, 12).forEach(function (k) {
    Logger.log('  · ' + k + ' → ' + JSON.stringify(coffee[k]));
  });
  if (coffeeKeys.length > 12) Logger.log('  ... and ' + (coffeeKeys.length - 12) + ' more');

  Logger.log('');
  Logger.log('=== DRY RUN — sample expansions ===');
  ['lemon', 'mozzarella', 'eggplant', 'mushrooms_raw', 'mayo', 'olive_oil', 'pinenuts'].forEach(function (ingKey) {
    const products = [];
    sections.forEach(function (s, idx) {
      const endRow = (idx + 1 < sections.length) ? sections[idx + 1].row : Math.min(s.row + 40, data.length);
      const direct = brmExtractIngredientsForSection_(formulas, s.row, endRow);
      const directWithOverrides = direct.slice();
      if (BRM_PRODUCT_DIRECT_OVERRIDES[s.header.toUpperCase()]) {
        BRM_PRODUCT_DIRECT_OVERRIDES[s.header.toUpperCase()].forEach(function (k) {
          if (directWithOverrides.indexOf(k) === -1) directWithOverrides.push(k);
        });
      }
      const expanded = brmExpandIngredients_(directWithOverrides, subRecipes);
      if (expanded.indexOf(ingKey) !== -1) products.push(s.header);
    });
    Logger.log('  ' + ingKey + ' → ' + JSON.stringify(products));
  });
}

function inspectPestoReferences() {
  const sheet    = SpreadsheetApp.openById(BRM_FOOD_SHEET_ID).getSheetByName('FOOD');
  const values   = sheet.getDataRange().getValues();
  const formulas = sheet.getDataRange().getFormulas();

  Logger.log('=== Cells with formulas referencing L9 ===');
  let l9hits = 0;
  for (let r = 0; r < formulas.length; r++) {
    for (let c = 0; c < (formulas[r] || []).length; c++) {
      const f = formulas[r][c];
      if (!f) continue;
      if (/\bL9\b/.test(String(f))) {
        Logger.log('  ' + brmColLetter_(c + 1) + (r + 1) + ': ' + f);
        l9hits++;
      }
    }
  }
  Logger.log('L9 reference hits: ' + l9hits);

  Logger.log('');
  Logger.log('=== Cells mentioning pesto/basil ===');
  let pestohits = 0;
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < (values[r] || []).length; c++) {
      const v = String(values[r][c] || '');
      if (/\bpesto\b/i.test(v) || /\bbasil\b/i.test(v)) {
        const f = formulas[r][c] || '(no formula)';
        Logger.log('  ' + brmColLetter_(c + 1) + (r + 1) + ': value="' + v.trim() + '"  formula=' + f);
        pestohits++;
      }
    }
  }
  Logger.log('Pesto mention hits: ' + pestohits);

  Logger.log('');
  Logger.log('=== Area around O63 (rows 60–90, cols N–T) ===');
  for (let r = 59; r < Math.min(90, values.length); r++) {
    for (let c = 13; c <= 19 && c < (values[r] || []).length; c++) {
      const v = values[r][c];
      const f = formulas[r] && formulas[r][c];
      if ((typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && v !== 0) || f) {
        Logger.log('  ' + brmColLetter_(c + 1) + (r + 1) + ': value=' + v + '  formula=' + (f || '(none)'));
      }
    }
  }
}

function inspectSubRecipeBlocks() {
  const sheet    = SpreadsheetApp.openById(BRM_FOOD_SHEET_ID).getSheetByName('FOOD');
  const values   = sheet.getDataRange().getValues();
  const formulas = sheet.getDataRange().getFormulas();

  const ranges = [
    { name: 'TUNA MIX',           col: 'M', start: 35, end: 48 },
    { name: 'CAPONATA',           col: 'M', start: 48, end: 62 },
    { name: 'SCHNITTAS',          col: 'M', start: 62, end: 75 },
    { name: 'MUSHROOM MIX',       col: 'M', start: 75, end: 89 },
    { name: 'TIGER SAUCE',        col: 'T', start: 35, end: 48 },
    { name: 'HONEY MUSTARD MAYO', col: 'T', start: 48, end: 62 },
  ];

  ranges.forEach(function (r) {
    Logger.log('');
    Logger.log('=== ' + r.name + '  (' + r.col + r.start + '–' + r.col + r.end + ') ===');
    const colIdx = brmA1ColToIdx_(r.col);
    const labelColIdx = colIdx - 2;
    const qtyColIdx   = colIdx - 1;
    for (let row = r.start; row <= r.end; row++) {
      const idx = row - 1;
      if (idx < 0 || idx >= values.length) continue;
      const label = String(values[idx][labelColIdx] || '').trim();
      const qty   = values[idx][qtyColIdx];
      const cost  = values[idx][colIdx];
      const costF = formulas[idx] && formulas[idx][colIdx];
      Logger.log('  ' + r.col + row + ': label="' + label + '" qty=' + qty + ' cost=' + cost + ' formula=' + (costF || '(no formula)'));
    }
  });
}

function inspectMadeInHouse() {
  const sheet    = SpreadsheetApp.openById(BRM_FOOD_SHEET_ID).getSheetByName('FOOD');
  const values   = sheet.getDataRange().getValues();
  const formulas = sheet.getDataRange().getFormulas();

  Logger.log('=== L-COL (Made In House) dump, rows 1–20 ===');
  for (let r = 0; r < Math.min(20, values.length); r++) {
    const labelA = String(values[r][0] || '').trim();
    const labelK = String(values[r][10] || '').trim();
    const labelL = String(values[r][11] || '').trim();
    const valL   = values[r][11];
    const fL     = formulas[r][11];
    if (labelA || labelK || labelL || valL || fL) {
      Logger.log('row ' + (r + 1) + ': A="' + labelA + '" | K="' + labelK + '" | L="' + labelL + '" | L_val=' + valL + ' | L_formula=' + (fL || '(none)'));
    }
  }

  Logger.log('=== PESTO search ===');
  let hits = 0;
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const v = String(values[r][c] || '');
      if (v.toLowerCase().indexOf('pesto') !== -1) {
        Logger.log('  · row ' + (r + 1) + ' col ' + brmColLetter_(c + 1) + ': "' + v + '"  formula=' + (formulas[r][c] || '(value)'));
        hits++;
      }
    }
  }
  Logger.log('Pesto hits: ' + hits);

  Logger.log('=== MASTER GRID dump, rows 1–25, any non-empty string cell ===');
  for (let r = 0; r < Math.min(25, values.length); r++) {
    for (let c = 0; c < values[r].length; c++) {
      const v = values[r][c];
      if (typeof v === 'string' && v.trim().length > 2) {
        Logger.log('  ' + brmColLetter_(c + 1) + (r + 1) + ': "' + v.trim() + '"');
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
function createRecipeMapTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'buildRecipeMap') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildRecipeMap').timeBased().everyDays(1).atHour(3).create();
  Logger.log('✓ Daily 3am trigger created for buildRecipeMap.');
}