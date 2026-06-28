// ─────────────────────────────────────────────────────────────────────────────
// INGREDIENT CATALOG — single source of truth for FOOD-sheet ingredients.
// Both SyncIngredientPrices.js (pricing) and BuildRecipeMap.js (recipe
// attribution) read from this one list, so adding an ingredient row here makes
// it resolve EVERYWHERE — no more editing two tables and getting "0 affected".
// Each entry: key, name, col (sheet column number, A=1), row, unit, supplier.
// ─────────────────────────────────────────────────────────────────────────────
const FOOD_INGREDIENTS = [
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
    { key: 'pickled_onions',     name: 'Pickled Onions (3200g)',            col: 12, row: 12, unit: '3200g',     supplier: 'GDay Tiger' },
    { key: 'fennel_slaw',        name: 'Fennel Slaw (1100g)',               col: 12, row: 13, unit: '1100g',     supplier: 'GDay Tiger' },
    // ── EXTRAS ───────────────────────────────────────────────────────────────
    { key: 'butter',             name: 'Butter (1.5kg)',                    col: 14, row: 5,  unit: '1.5kg',     supplier: '5Ways' },
    { key: 'olive_oil',          name: 'Olive Oil (4L)',                    col: 14, row: 6,  unit: '4L',        supplier: '5Ways' },
    { key: 'salt',               name: 'Sea Salt (25kg)',                   col: 14, row: 7,  unit: '25kg',      supplier: '5Ways' },
    { key: 'pepper',             name: 'Pepper (1kg)',                      col: 14, row: 8,  unit: '1kg',       supplier: '5Ways' },
    { key: 'eggs',               name: 'Eggs (15doz box)',                  col: 14, row: 9,  unit: '15doz box', supplier: 'Sciclunas' },
    // ── PACKAGING ────────────────────────────────────────────────────────────
    { key: 'napkins',            name: 'Napkins (2000pk)',                  col: 16, row: 8,  unit: '2000pk',    supplier: 'Abicor' },
    { key: 'tray',               name: 'Paper Tray (150pk)',                col: 16, row: 9,  unit: '150pk',     supplier: 'Abicor' },
    { key: 'bags_small',         name: 'Small Bags (20,200pk)',             col: 16, row: 7,  unit: '20,200pk',  supplier: 'GDay Tiger' },
    { key: 'bags_large',         name: 'Large Bags Printed (17,275pk)',     col: 16, row: 10, unit: '17,275pk',  supplier: 'GDay Tiger' },
    // ── PANTRY ───────────────────────────────────────────────────────────────
    { key: 'plain_flour',        name: 'Plain Flour (12.5kg)',              col: 18, row: 5,  unit: '12.5kg',    supplier: '5Ways' },
    { key: 'sr_flour',           name: 'Self-Raising Flour (12.5kg)',       col: 18, row: 6,  unit: '12.5kg',    supplier: '5Ways' },
    { key: 'caster_sugar',       name: 'Caster Sugar (15kg)',               col: 18, row: 7,  unit: '15kg',      supplier: '5Ways' },
    { key: 'brown_sugar',        name: 'Brown Sugar (15kg)',                col: 18, row: 8,  unit: '15kg',      supplier: '5Ways' },
    { key: 'bicarb_soda',        name: 'Bicarb Soda (500g)',                col: 18, row: 9,  unit: '500g',      supplier: '5Ways' },
    { key: 'cinnamon',           name: 'Cinnamon (500g)',                   col: 18, row: 10, unit: '500g',      supplier: '5Ways' },
    { key: 'vegetable_oil',      name: 'Vegetable Oil (20L)',               col: 18, row: 11, unit: '20L',       supplier: '5Ways' },
    // R12 (sungold_milk) intentionally omitted as a priced row — it's a cross-write
    // of D5 Sungold Jersey FC (same product/price). Mapped in FOOD_RECIPE_ONLY so
    // food recipes referencing R12 attribute to the unified `sungold_jersey_fc`.
    { key: 'breadcrumbs',        name: 'Breadcrumbs Panko (10kg)',          col: 18, row: 13, unit: '10kg',      supplier: '5Ways' },
    { key: 'honey',              name: 'Honey (3kg)',                       col: 18, row: 14, unit: '3kg',       supplier: '5Ways' },
  ];

// Cells that appear in recipes for attribution but are NOT standalone priced
// rows (sub-recipes / manual items). Merged into the recipe-map cell→key table.
const FOOD_RECIPE_ONLY = {
  'L9': 'basil_pesto',          // made-in-house sub-recipe (priced via its own components)
  'R15': 'pinenuts',            // manual item, used in basil pesto
  'R12': 'sungold_jersey_fc',   // cross-write of D5 — unify food milk under the coffee milk key
};

// Column number → sheet letter (A=1 → 'A', 2 → 'B', …).
function ic_colLetter_(col) { return String.fromCharCode(64 + col); }

// Cell-ref → ingredient key, derived from the catalog (+ recipe-only cells).
// Memoised. This REPLACES the old hand-maintained BRM_FOOD_CELL_TO_KEY.
function foodCellToKeyMap_() {
  if (foodCellToKeyMap_._m) return foodCellToKeyMap_._m;
  const m = {};
  FOOD_INGREDIENTS.forEach(function (i) { m[ic_colLetter_(i.col) + i.row] = i.key; });
  Object.keys(FOOD_RECIPE_ONLY).forEach(function (c) { m[c] = FOOD_RECIPE_ONLY[c]; });
  foodCellToKeyMap_._m = m;
  return m;
}
