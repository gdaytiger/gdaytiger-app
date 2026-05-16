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
// Cells in MADE-IN-HOUSE rows (L col, rows 5–11) point at SUB-RECIPES that
// are expanded recursively after the first pass.
// ─────────────────────────────────────────────────────────────────────────────
const BRM_FOOD_CELL_TO_KEY = {
  // Bread
  'B5':  'sourdough',          'B6':  'ciabatta',           'B7':  'potato_bun',
  'B8':  'croissant',
  // Meats
  'D5':  'ham',                'D6':  'beef_pastrami',      'D7':  'salami',
  'D8':  'tuna',               'D9':  'chicken',
  // Cheese
  'F5':  'mozzarella',         'F6':  'swiss_cheese',       'F7':  'taleggio',
  'F8':  'american_cheese',    'F9':  'parmesan_grated',    'F10': 'parmesan_block',
  // Vegetables
  'H5':  'tomato',             'H6':  'sauerkraut',         'H7':  'pickles',
  'H8':  'mushrooms_raw',      'H9':  'red_onion',          'H10': 'fennel',
  'H11': 'red_chilli',         'H12': 'jalapeno',           'H13': 'parsley',
  'H14': 'dill',               'H15': 'bananas',            'H16': 'eggplant',
  'H17': 'lemon',              'H18': 'carrot',             'H19': 'cucumber',
  'H20': 'leni_peppers',
  // Sauces (bought-in)
  'J5':  'dijon_mustard',      'J6':  'mayo',               'J7':  'ketchup',
  // MADE IN HOUSE — these expand recursively
  'L5':  'tuna_mix',           'L6':  'caponata',           'L7':  'mushroom_mix',
  'L8':  'schnittas',          'L9':  'basil_pesto',        'L10': 'tiger_sauce',
  'L11': 'honey_mustard_mayo',
  // Extras
  'N5':  'butter',             'N6':  'olive_oil',          'N7':  'salt',
  'N8':  'pepper',             'N9':  'eggs',
  // Packaging
  'P8':  'napkins',            'P9':  'tray',
  // Pantry
  'R5':  'plain_flour',        'R6':  'sr_flour',           'R7':  'caster_sugar',
  'R8':  'brown_sugar',        'R9':  'bicarb_soda',        'R10': 'cinnamon',
  'R11': 'vegetable_oil',      'R13': 'breadcrumbs',        'R14': 'honey',
  'R15': 'pinenuts',
};

// Made-in-house keys (these get expanded into their sub-recipe ingredients)
const BRM_MADE_IN_HOUSE = ['tuna_mix', 'caponata', 'mushroom_mix', 'schnittas',
                           'basil_pesto', 'tiger_sauce', 'honey_mustard_mayo'];

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
  // Section headers like "CAPONATA SANDWICH" or "TIGER SAUCE" usually sit in
  // col A. We accept any cell that's mostly uppercase, length>3, with text-only
  // surroundings. Diagnostic dump shows what we picked up.
  const sections = brmFindSections_(data);
  Logger.log('Sections detected: ' + sections.length);
  sections.forEach(function (s) {
    Logger.log('  · row ' + (s.row + 1) + ' col ' + brmColLetter_(s.col + 1) + ': "' + s.header + '"');
  });

  // ── 2. Parse formulas in each section to find ingredient cell refs ─────────
  // For each section, scan a row window (from header+1 to next header or +40)
  // across all columns, extract every A1 reference, match against our cell map.
  const sectionRecipes = {}; // header (uppercase) → array of ingredient keys (direct refs)
  sections.forEach(function (s, idx) {
    const endRow = (idx + 1 < sections.length) ? sections[idx + 1].row : Math.min(s.row + 40, rowCount);
    const ingredients = brmExtractIngredientsForSection_(formulas, s.row, endRow);
    sectionRecipes[s.header.toUpperCase()] = ingredients;
  });

  // ── 3. Auto-detect sub-recipes (made-in-house keys → ingredients) ──────────
  // Trace each L-col formula → its total cell → upward column scan → master
  // grid refs. No hard-coded headers; works as long as the L-col formulas
  // follow the "=M47" pattern.
  const subRecipeIngredients = brmAutoDetectSubRecipes_(formulas, data);
  // Apply manual overrides for any sub-recipe the auto-detector couldn't find
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
  // Pull Notion product list, find matching section, expand any made-in-house
  // ingredient into its sub-recipe components recursively.
  const notionProducts = brmGetNotionProducts_();
  Logger.log('Notion products fetched: ' + notionProducts.length);

  // Parse COFFEE products too — they live in a separate sheet with a simpler
  // (no sub-recipe) structure, but feed into the same Notion DB.
  const coffeeProductsMap = brmBuildCoffeeProductsMap_();
  Logger.log('Coffee sections parsed: ' + Object.keys(coffeeProductsMap).length);

  const products = {};
  const missed   = [];
  notionProducts.forEach(function (p) {
    const sectionHeader = (BRM_NOTION_TO_SHEET[p.name.toLowerCase().trim()] || p.name).toUpperCase();

    // Try FOOD first, then COFFEE
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

    // Apply product direct overrides (additive) — only for food, no overrides for coffee yet
    const directWithOverrides = direct.slice();
    if (BRM_PRODUCT_DIRECT_OVERRIDES[sectionHeader]) {
      BRM_PRODUCT_DIRECT_OVERRIDES[sectionHeader].forEach(function (k) {
        if (directWithOverrides.indexOf(k) === -1) directWithOverrides.push(k);
      });
    }
    const expanded = brmExpandIngredients_(directWithOverrides, subRecipeIngredients);
    products[p.name] = {
      id: p.id,         // Notion page ID — lets the widget fetch directly without semantic search
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
// Tuned from dry-run feedback (16 May 2026):
//   • Col A only (col E had numeric labels like "62.333..." stealing rows)
//   • Must contain at least one A–Z letter (kills pure-number false positives)
//   • Skip rows 1–MIN_PRODUCT_ROW (master ingredient grid lives up top)
//   • Skip headers ending with a cell-ref tag like "(B5)" or "(F9)"
//     — those are master grid labels, not product sections
// ─────────────────────────────────────────────────────────────────────────────
const BRM_MIN_PRODUCT_ROW = 25; // 0-indexed; first real product seen at row 35

function brmFindSections_(data) {
  const sections = [];
  for (let r = BRM_MIN_PRODUCT_ROW; r < data.length; r++) {
    const raw = String((data[r][0] || '')).trim(); // col A only
    if (raw.length < 4) continue;
    if (!/[A-Z]/.test(raw)) continue;                              // must have a letter
    if (!/^[A-Z0-9 ()+&'\.\-\/]+$/.test(raw)) continue;           // uppercase-ish only
    if (raw !== raw.toUpperCase()) continue;
    if (/\([A-Z]+\d+\)\s*$/.test(raw)) continue;                  // ends in (B5)/(F9) → master grid label

    // Must have content below it (sanity)
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
// Main product recipe lives in cols A–D. Sub-recipes (Tiger Sauce, mixes, etc.)
// live in parallel columns G+ within the same row range, so we scan a narrow
// slice to avoid attributing their ingredients to the main product.
const BRM_RECIPE_COL_START = 0; // col A
const BRM_RECIPE_COL_END   = 4; // exclusive — scan cols A,B,C,D

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
        const key   = BRM_FOOD_CELL_TO_KEY[clean];
        if (key) found[key] = true;
      });
    }
  }
  return Object.keys(found);
}

// ─────────────────────────────────────────────────────────────────────────────
// COFFEE SHEET PARSER
// ─────────────────────────────────────────────────────────────────────────────
// Coffee recipes are simpler than food — no made-in-house chain. Each section
// header sits in col A (with col B and col E empty, so we don't catch
// ingredient rows that have a value in col B). For each section, scan cols
// A–F formulas and capture refs to coffee master cells.
// ─────────────────────────────────────────────────────────────────────────────
function brmBuildCoffeeProductsMap_() {
  const sheet    = SpreadsheetApp.openById(BRM_COFFEE_SHEET_ID).getSheetByName('COFFEE');
  const data     = sheet.getDataRange().getValues();
  const formulas = sheet.getDataRange().getFormulas();
  const products = {};

  // 1. Find coffee section headers (col A non-empty, col B + col E empty,
  // string is mostly uppercase). Skip the master grid area (rows 1–20).
  const sections = [];
  for (let r = 20; r < data.length; r++) {
    const a = String(data[r][0] || '').trim();
    const b = String(data[r][1] || '').trim();
    const e = String((data[r][4] || '')).trim();
    if (!a || a.length < 4) continue;
    if (b || e) continue;                                            // not a header row
    if (!/[A-Z]/.test(a) || a !== a.toUpperCase()) continue;        // require uppercase letters
    if (!/^[A-Z0-9 ()+&'\.\-\/]+$/.test(a)) continue;
    if (/\([A-Z]+\d+\)\s*$/.test(a)) continue;                      // skip master grid labels
    const blacklist = ['TOTAL', 'PROFIT', 'PROFIT %', 'RETAIL PRICE', 'WASTAGE',
                       'PRICES', 'COFFEE', 'MILK', 'SUGAR', 'PACKAGING'];
    if (blacklist.indexOf(a) !== -1) continue;
    sections.push({ row: r, header: a });
  }

  // 2. For each section, scan formulas in cols A–F (covers both A/B and E/F
  // label/value formats). Capture coffee master cell references.
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
// Each L-col cell (rows 5–11) has a formula like "=M47" pointing at the TOTAL
// of its sub-recipe. The total is a SUM range; each row in the range uses an
// intermediate formula like "=J38/L38" where J38 itself holds the master-grid
// reference (e.g. "=D8" for tuna). Schnittas is even deeper:
//   M74 = IF(...,M72/I73)  →  M72 = SUM(M66:M70)  →  M66 = J66*K66/I66  →  I/J/K hold the master refs
// So we use a transitive walker that follows refs (and range refs) until it
// hits master-grid cells defined in BRM_FOOD_CELL_TO_KEY.
// ─────────────────────────────────────────────────────────────────────────────
function brmAutoDetectSubRecipes_(formulas, values) {
  const subRecipes = {};
  const kColIdx = 10; // col K (0-indexed)
  const lColIdx = 11; // col L (0-indexed)

  for (let r = 0; r < formulas.length; r++) {
    const f = formulas[r][lColIdx];
    if (!f) continue;
    const m = String(f).match(/^\s*=\s*\$?([A-Z]+)\$?(\d+)\s*$/);
    if (!m) continue;
    const targetCell = m[1] + m[2];

    // Find which MIH key from the K-col label
    const label = String(values[r][kColIdx] || '').toUpperCase();
    let mihKey = null;
    for (const prefix in BRM_MIH_LABEL_TO_KEY) {
      if (label.indexOf(prefix) === 0) { mihKey = BRM_MIH_LABEL_TO_KEY[prefix]; break; }
    }
    if (!mihKey) {
      Logger.log('  ⚠ L-col formula at row ' + (r + 1) + ' but K-col label "' + label + '" not recognised');
      continue;
    }

    // Transitive: follow the total cell's formula → each referenced cell's
    // formula → etc., until we hit master grid cells. Handles SUM ranges,
    // intermediate cells (M38 = J38/L38 where J38 = =D8), and the deeper
    // schnittas-style chain (M74 → M72 → M66:M70 → I/J/K refs → master).
    const ingredients = brmCollectIngredientsTransitive_(formulas, [targetCell], 6);
    // A sub-recipe shouldn't claim itself
    subRecipes[mihKey] = ingredients.filter(function (k) { return k !== mihKey; });
  }

  return subRecipes;
}

// Transitive cell-reference walker. Starts at given cells, follows formula
// references depth-first, stops when it hits master grid cells or runs out
// of depth. Range refs like SUM(A1:B5) are expanded to individual cells.
function brmCollectIngredientsTransitive_(formulas, startCells, maxDepth) {
  const ingredients = {};
  const visited     = {};

  function visit(cellRef, depth) {
    if (depth > maxDepth) return;
    if (visited[cellRef]) return;
    visited[cellRef] = true;

    // Master grid hit — record and stop traversing this branch.
    const key = BRM_FOOD_CELL_TO_KEY[cellRef];
    if (key) { ingredients[key] = true; return; }

    // Otherwise, read this cell's formula and walk its refs.
    const parsed = cellRef.match(/^([A-Z]+)(\d+)$/);
    if (!parsed) return;
    const colIdx = brmA1ColToIdx_(parsed[1]);
    const rowIdx = parseInt(parsed[2], 10) - 1;
    if (rowIdx < 0 || rowIdx >= formulas.length || colIdx < 0) return;

    const row = formulas[rowIdx];
    if (!row) return;
    const f = row[colIdx];
    if (!f) return;

    // Expand range refs first (SUM(A1:B5) → A1,A2,...,B5), then grab individual refs
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
  // 'A' → 0, 'M' → 12, 'T' → 19
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
    if (depth > 4) return; // safety
    keys.forEach(function (k) {
      if (seen[k]) return;
      seen[k] = true;
      if (BRM_MADE_IN_HOUSE.indexOf(k) !== -1 && subRecipes[k]) {
        // Expand the sub-recipe AND keep the made-in-house key itself for
        // the case where you want to track "this product uses caponata mix".
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

  // Find existing recipe_map block on the page
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
// DIAGNOSTIC: dump every detected section + its parsed ingredients to the log
// without writing to Notion. Useful when tuning section headers.
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
      // Apply product direct overrides
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

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC: dumps the structure of the Made-In-House column and hunts for
// pesto. Use to figure out where sub-recipes actually live so we can build
// the auto-detector against real layout, not guesses.
// ─────────────────────────────────────────────────────────────────────────────
function inspectPestoReferences() {
  const sheet    = SpreadsheetApp.openById(BRM_FOOD_SHEET_ID).getSheetByName('FOOD');
  const values   = sheet.getDataRange().getValues();
  const formulas = sheet.getDataRange().getFormulas();

  // 1. Every cell with a FORMULA referencing L9 (so we find products that depend on pesto's price)
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

  // 2. Every cell mentioning "pesto" / "basil pesto" (label or text)
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

  // 3. Dump the area around O63 (where "BASIL PESTO" header was found) to see
  // if there's a sub-recipe being built there
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

  // Dump K-L-M columns for each known sub-recipe range so we can see what's
  // actually in there — labels, quantities, formulas.
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
    // Dump the value/label/qty cols immediately to the left of the cost col
    // so we can see context. For M-col sub-recipes that's K (label) + L (qty).
    // For T-col it's R + S.
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
    const labelA = String(values[r][0] || '').trim();   // col A label (e.g. "MADE IN HOUSE")
    const labelK = String(values[r][10] || '').trim();  // col K label
    const labelL = String(values[r][11] || '').trim();  // col L label
    const valL   = values[r][11];                       // col L value
    const fL     = formulas[r][11];                     // col L formula
    if (labelA || labelK || labelL || valL || fL) {
      Logger.log('row ' + (r + 1) + ': A="' + labelA + '" | K="' + labelK + '" | L="' + labelL + '" | L_val=' + valL + ' | L_formula=' + (fL || '(none)'));
    }
  }

  // Scan the whole sheet for any cell containing "pesto" (case-insensitive)
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

  // Also dump the master grid headers in rows 1–20 (any non-empty cell with
  // a string value) so we can see ALL ingredient slots, not just the ones
  // SyncIngredientPrices currently maps.
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
  // Recipes don't change often; daily run is plenty.
  ScriptApp.newTrigger('buildRecipeMap').timeBased().everyDays(1).atHour(3).create();
  Logger.log('✓ Daily 3am trigger created for buildRecipeMap.');
}
