// ═══════════════════════════════════════════════════════════════════════════════
//  MarginReview.gs  (v2 — curated-map matcher)
//  Weekly margin intelligence: joins 7 days of Square item sales against the
//  Notion Product Costings DB (Sell Price + Profit %), ranks underperforming
//  recipes by WEEKLY DOLLAR IMPACT (not just margin %), and writes the result
//  to the TIGEROS Notion OS page as a `margin_review` JSON code block.
//  The dashboard reads it via /api/margin-review.
//
//  ── MATCHING (v2) ──────────────────────────────────────────────────────────
//  v1 used fuzzy name containment, which double-counted: every iced-latte
//  costing variant absorbed the full iced-latte sales pool, because Square
//  encodes milk type as a MODIFIER on the line item, not in the item name.
//
//  v2 reads li.modifiers + li.variation_name from Square orders and routes
//  each sales bucket through the SAME hand-curated maps the price sync uses:
//    COFFEE_SQUARE_MAP  (SyncSquarePrices.gs)  — item+variation+modifiers → recipes
//    SQUARE_RETAIL_MAP  (ScanSuppliers.gs)     — item+variation+modifier  → recipe
//    MR_EXTRA_MAP       (below)                — review-only additions
//  Each sales bucket is attributed to EXACTLY ONE costing (no double-count).
//  Buckets with no map entry fall back to exact/unique name match, else they
//  land in `unmatched` so coverage gaps are visible instead of silent.
//
//  ── REUSES (Apps Script flat namespace) ────────────────────────────────────
//    SIP_NOTION_API_KEY, SIP_NOTION_PAGE_ID   (SyncIngredientPrices.gs)
//    cacheSquareLocation_(), PK_LOCATION_ID    (TakeawayCupCounter.gs)
//    r2()                                      (ScanSuppliers.gs)
//    COFFEE_SQUARE_MAP                         (SyncSquarePrices.gs)
//    SQUARE_RETAIL_MAP                         (ScanSuppliers.gs)
//
//  ── SETUP (one-off) ────────────────────────────────────────────────────────
//    1. Run installMarginReview() once → grants scopes + weekly trigger
//       (Mondays 6am, before café open so it's ready with morning coffee).
//    2. Run printMarginReview() any time to preview without writing to Notion.
//
//  ── CONVENTIONS ────────────────────────────────────────────────────────────
//    Margin target: 70% (green threshold). Red <60%, amber 60–70%.
//    Shortfall $ = weeklyQty × (sell ÷ 1.1) × (70% − margin)  [GST-ex approx]
// ═══════════════════════════════════════════════════════════════════════════════

var MR_DB_ID         = '8f16358a47e54062b5fe1ce7a7480754';  // Notion Product Costings DB
var MR_TARGET_MARGIN = 70;    // % — matches the green threshold convention
var MR_RED_BELOW     = 60;    // % — red threshold
var MR_MAX_ITEMS     = 12;    // legacy global cap (kept for reference; see MR_MAX_PER_CAT)
var MR_MAX_PER_CAT   = 8;     // cap the ranked DISPLAY list PER category (coffee / food)
var MR_MAX_UNMATCHED = 12;    // top Square sellers with no costing match

// Modifiers that change WHICH recipe a drink/dish is costed against. Rule:
// only recognise a modifier if the +modifier version has its OWN costing —
// otherwise it just fragments the base count. Everything else (extra shot,
// decaf, skinny, sugar, takeaway cup, etc) folds into the base recipe.
// DECAF removed Jun 2026: no decaf costing exists and decaf beans cost ≈
// regular, so decaf drinks now count + cost on their normal tile instead of
// losing ~19/wk to `unmatched`. Re-add only if a separate decaf costing is made.
var MR_RECOGNISED_MODS = ['SOY', 'OAT', 'ALMOND', 'CHOCOLATE', 'CHAI',
                          'MOCHA', 'MATCHA', 'TIGER STYLE', 'ADD CHEESE'];

// Alternate modifier names observed in real orders (printAllModifiers, Jun
// 2026): registers use both "Soy" and "Soy Milk" etc. Canonicalise before
// matching.
var MR_MOD_ALIASES = {
  'SOY MILK':       'SOY',
  'OAT MILK':       'OAT',
  'COLD OAT MILK':  'OAT',
  'ALMOND MILK':    'ALMOND',
  // The Tiger Style modifier rings with its full descriptive name; collapse it
  // to the recognised 'TIGER STYLE' so H+C Tiger Style splits out of plain H+C
  // and attributes to its own costing (confirmed Square name Jun 2026).
  'TIGER STYLE (PICKLES + TIGER SAUCE)': 'TIGER STYLE',
  // Mr Yum online rings the cheese add-on as 'Cheese'; POS rings 'Add Cheese'.
  // Collapse to the recognised 'ADD CHEESE' so online Caponata+cheese lands on
  // CAPONATA (MOZZARELLA). Safe because cheese is ~99% a Caponata add (per
  // Jonathan); a rare cheese-on-other-sandwich just drops that one to unmatched.
  'CHEESE': 'ADD CHEESE',
};

// Recipe-name → Notion-costing-name aliases, for recipes whose sheet section
// name differs from the Notion product name. Checked before fuzzy resolution.
var MR_NAME_ALIASES = {
  'H+C CROISSANT': 'FILLED CROISSANT',
  // SQUARE_RETAIL_MAP already wires the H+C/Caponata variants, but to their
  // costings-SHEET section names. Map those to the Notion product names so the
  // modifier buckets attribute to the right tile instead of fuzzy-resolving to
  // the plain item. Keys are the normalised sheet recipe names.
  'H+C SANDWICH TIGER STYLE':      'H+C (TIGER STYLE)',
  'CAPONATA SANDWICH WITH CHEESE': 'CAPONATA (MOZZARELLA)',
  // Mr Yum online item rings as "SALAMI AUTOGRILL" (word order flipped vs the
  // POS "Autogrill SALAMI"). Alias both to the same costing so online + counter
  // sales merge onto one tile. POS name still fuzzy-resolves; this covers online.
  'SALAMI AUTOGRILL':              'AUTOGRILL (SALAMI PANINI)',
};

// Review-only map entries for Square items the price-sync maps don't cover.
// Built from observed Square line items (Jun 2026): dine-in white coffees
// ring through 'Flat White' / 'Latte' / 'Cappuccino' with milk as a modifier;
// 'Long Black' is the dine-in black; takeaway iced lattes ring through
// 'Iced Latte (TAKEAWAY)' with Small/Large variations.
var MR_EXTRA_MAP = (function () {
  var entries = [];

  // NB: H+C (Tiger Style) and Caponata (Mozzarella) are NOT mapped here — they
  // already exist in SQUARE_RETAIL_MAP. Their fix lives in MR_NAME_ALIASES
  // (sheet-name → Notion-product-name) + the MR_MOD_ALIASES Tiger Style entry
  // that lets the modifier bucket split out in the first place.

  // Dine-in white-coffee items: milk modifier picks the recipe. Register rings
  // size as a 'Large' variation (or a LARGE modifier, promoted to a variation
  // upstream in mrFetchSquareBuckets_). The SMALL/default and LARGE rows are
  // BOTH required — without the Large rows, large dine-in whites fall back to
  // the small recipe, which zeroes the (LARGE) tile (qty shows blank) AND
  // over-states + under-costs the small (large volume folded into it).
  // Observed Jun 2026: Latte/Flat White/Cappuccino LARGE alone ≈ 58 drinks/wk.
  ['Flat White', 'Latte', 'Cappuccino'].forEach(function (item) {
    // — small / default —
    entries.push({ squareItem: item, modifiers: [],
      recipes: ['DINE IN FC MILK COFFEE', 'TAKEAWAY FC MILK COFFEE'] });
    entries.push({ squareItem: item, modifiers: ['Soy'],
      recipes: ['DINE IN SOY COFFEE', 'TAKEAWAY SOY COFFEE'] });
    entries.push({ squareItem: item, modifiers: ['Oat'],
      recipes: ['DINE IN OAT COFFEE', 'TAKEAWAY OAT COFFEE'] });
    entries.push({ squareItem: item, modifiers: ['Almond'],
      recipes: ['DINE IN ALMOND COFFEE', 'TAKEAWAY ALMOND COFFEE'] });
    entries.push({ squareItem: item, modifiers: ['Chocolate'],
      recipes: ['DINE IN HOT CHOCOLATE (SMALL)', 'TAKEAWAY HOT CHOCOLATE (SMALL)'] });
    // — large —
    entries.push({ squareItem: item, variation: 'Large', modifiers: [],
      recipes: ['DINE IN FC MILK COFFEE (LARGE)', 'TAKEAWAY FC MILK COFFEE (LARGE)'] });
    entries.push({ squareItem: item, variation: 'Large', modifiers: ['Soy'],
      recipes: ['DINE IN SOY COFFEE (LARGE)', 'TAKEAWAY SOY COFFEE (LARGE)'] });
    entries.push({ squareItem: item, variation: 'Large', modifiers: ['Oat'],
      recipes: ['DINE IN OAT COFFEE (LARGE)', 'TAKEAWAY OAT COFFEE (LARGE)'] });
    entries.push({ squareItem: item, variation: 'Large', modifiers: ['Almond'],
      recipes: ['DINE IN ALMOND COFFEE (LARGE)', 'TAKEAWAY ALMOND COFFEE (LARGE)'] });
    entries.push({ squareItem: item, variation: 'Large', modifiers: ['Chocolate'],
      recipes: ['DINE IN HOT CHOCOLATE (LARGE)', 'TAKEAWAY HOT CHOCOLATE (LARGE)'] });
  });

  // Dine-in black coffee (small + large).
  entries.push({ squareItem: 'Long Black', modifiers: [],
    recipes: ['DINE IN BLACK COFFEE', 'TAKEAWAY BLACK COFFEE'] });
  entries.push({ squareItem: 'Long Black', variation: 'Large', modifiers: [],
    recipes: ['DINE IN BLACK COFFEE (LARGE)', 'TAKEAWAY BLACK COFFEE (LARGE)'] });

  // Hot Chocolate rings as its OWN item (dine-in), not White +Chocolate.
  // FC + milk variants, small + large (milk modifier picks the recipe).
  [
    { milk: [],         base: 'HOT CHOCOLATE' },
    { milk: ['Soy'],    base: 'SOY HOT CHOCOLATE' },
    { milk: ['Oat'],    base: 'OAT HOT CHOCOLATE' },
    { milk: ['Almond'], base: 'ALMOND HOT CHOCOLATE' },
  ].forEach(function (v) {
    entries.push({ squareItem: 'Hot Chocolate', modifiers: v.milk,
      recipes: ['DINE IN ' + v.base + ' (SMALL)', 'TAKEAWAY ' + v.base + ' (SMALL)'] });
    entries.push({ squareItem: 'Hot Chocolate', modifiers: v.milk, variation: 'Large',
      recipes: ['DINE IN ' + v.base + ' (LARGE)', 'TAKEAWAY ' + v.base + ' (LARGE)'] });
  });

  // Espresso-family short blacks/whites with no dedicated recipe — costed as the
  // nearest standard drink (Jonathan's call: macchiato = white). Piccolo/Magic
  // are milk coffees → small white; Espresso → small black; Long Macchiato →
  // white (small default, large safety). All low volume (~3-8/wk each).
  entries.push({ squareItem: 'Piccolo', modifiers: [],
    recipes: ['DINE IN FC MILK COFFEE', 'TAKEAWAY FC MILK COFFEE'] });
  entries.push({ squareItem: 'Magic', modifiers: [],
    recipes: ['DINE IN FC MILK COFFEE', 'TAKEAWAY FC MILK COFFEE'] });
  entries.push({ squareItem: 'Espresso', modifiers: [],
    recipes: ['DINE IN BLACK COFFEE', 'TAKEAWAY BLACK COFFEE'] });
  entries.push({ squareItem: 'Long Macchiato', modifiers: [],
    recipes: ['DINE IN FC MILK COFFEE', 'TAKEAWAY FC MILK COFFEE'] });
  entries.push({ squareItem: 'Long Macchiato', modifiers: [], variation: 'Large',
    recipes: ['DINE IN FC MILK COFFEE (LARGE)', 'TAKEAWAY FC MILK COFFEE (LARGE)'] });

  // Mocha + matcha — ring as modifiers on the white-coffee items (76/wk and
  // 86/wk observed). If no matching costing exists yet they surface in
  // `unmatched` rather than blending into plain white coffee.
  [
    { mod: 'Mocha',  base: 'MOCHA' },
    { mod: 'Matcha', base: 'MATCHA LATTE' },
  ].forEach(function (v) {
    entries.push({ squareItem: 'TA White', modifiers: [v.mod],
      recipes: ['TAKEAWAY ' + v.base, 'TAKEAWAY ' + v.base + ' (SMALL)', 'DINE IN ' + v.base] });
    entries.push({ squareItem: 'LG White', modifiers: [v.mod],
      recipes: ['TAKEAWAY ' + v.base + ' (LARGE)', 'DINE IN ' + v.base + ' (LARGE)'] });
    ['Flat White', 'Latte', 'Cappuccino'].forEach(function (item) {
      entries.push({ squareItem: item, modifiers: [v.mod],
        recipes: ['DINE IN ' + v.base, 'DINE IN ' + v.base + ' (SMALL)', 'TAKEAWAY ' + v.base] });
      entries.push({ squareItem: item, modifiers: [v.mod], variation: 'Large',
        recipes: ['DINE IN ' + v.base + ' (LARGE)', 'TAKEAWAY ' + v.base + ' (LARGE)'] });
    });
  });

  // Takeaway iced lattes — same structure as the DINE IN item in
  // COFFEE_SQUARE_MAP: Small is the default variation, Large is named.
  [
    { mods: [],         base: 'ICED LATTE' },
    { mods: ['Soy'],    base: 'SOY ICED LATTE' },
    { mods: ['Oat'],    base: 'OAT ICED LATTE' },
    { mods: ['Almond'], base: 'ALMOND ICED LATTE' },
  ].forEach(function (v) {
    entries.push({ squareItem: 'Iced Latte (TAKEAWAY)', modifiers: v.mods,
      recipes: ['TAKEAWAY ' + v.base, 'DINE IN ' + v.base] });
    entries.push({ squareItem: 'Iced Latte (TAKEAWAY)', modifiers: v.mods, variation: 'Large',
      recipes: ['TAKEAWAY ' + v.base + ' (LARGE)', 'DINE IN ' + v.base + ' (LARGE)'] });
  });

  // Chai — never wired in COFFEE_SQUARE_MAP (see its TODO). Rings through
  // the white-coffee items with a 'Chai' modifier; milk modifiers stack
  // (Chai+Soy etc). Safety entries also cover a standalone 'Chai' item in
  // case some registers ring it directly.
  [
    { milk: [],         base: 'CHAI' },
    { milk: ['Soy'],    base: 'SOY CHAI' },
    { milk: ['Oat'],    base: 'OAT CHAI' },
    { milk: ['Almond'], base: 'ALMOND CHAI' },
  ].forEach(function (v) {
    var withChai = ['Chai'].concat(v.milk);
    entries.push({ squareItem: 'TA White', modifiers: withChai,
      recipes: ['TAKEAWAY ' + v.base, 'TAKEAWAY ' + v.base + ' (SMALL)', 'DINE IN ' + v.base] });
    entries.push({ squareItem: 'LG White', modifiers: withChai,
      recipes: ['TAKEAWAY ' + v.base + ' (LARGE)', 'DINE IN ' + v.base + ' (LARGE)'] });
    ['Flat White', 'Latte', 'Cappuccino'].forEach(function (item) {
      entries.push({ squareItem: item, modifiers: withChai,
        recipes: ['DINE IN ' + v.base, 'DINE IN ' + v.base + ' (SMALL)', 'TAKEAWAY ' + v.base] });
    });
    ['Chai', 'Chai Latte'].forEach(function (item) {
      // Use the explicit (SMALL) names — bare 'TAKEAWAY CHAI' is ambiguous
      // (both '… (SMALL)' and '… (LARGE)' contain it) so the resolver returns
      // null and the sale drops to unmatched.
      entries.push({ squareItem: item, modifiers: v.milk,
        recipes: ['DINE IN ' + v.base + ' (SMALL)', 'TAKEAWAY ' + v.base + ' (SMALL)'] });
      entries.push({ squareItem: item, modifiers: v.milk, variation: 'Large',
        recipes: ['DINE IN ' + v.base + ' (LARGE)', 'TAKEAWAY ' + v.base + ' (LARGE)'] });
    });
  });

  return entries;
})();

// ─────────────────────────────────────────────────────────────────────────────
//  ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────

function runWeeklyMarginReview() {
  var payload = buildMarginReview_();
  mrWriteToNotion_(payload);
  Logger.log('Margin review synced: %s flagged item(s), $%s/wk total shortfall, %s green, %s unmatched bucket(s).',
             payload.items.length, payload.totalShortfall, payload.greenCount, payload.unmatched.length);
}

// Preview in the editor without touching Notion.
function printMarginReview() {
  Logger.log(JSON.stringify(buildMarginReview_(), null, 2));
}

// Diagnostic: dump EVERY 7-day sales bucket (item|variation|modifiers → qty),
// sorted by qty. Use to discover how a drink actually rings through Square
// before adding MR_EXTRA_MAP entries.
function printAllBuckets() {
  var end     = new Date();
  var start   = new Date(end.getTime() - 7 * 86400000);
  var buckets = mrFetchSquareBuckets_(start.toISOString(), end.toISOString());
  var list = [];
  for (var k in buckets) list.push(buckets[k]);
  list.sort(function (a, b) { return b.qty - a.qty; });
  list.forEach(function (b) {
    Logger.log('%s | qty %s | $%s', b.display, b.qty, (b.gross / 100).toFixed(2));
  });
  Logger.log('— %s buckets total —', list.length);
}

// Diagnostic: every distinct line-item modifier name in the last 7 days,
// with quantities. Use to keep MR_RECOGNISED_MODS / MR_MOD_ALIASES honest.
function printAllModifiers() {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  var locationId = PropertiesService.getScriptProperties().getProperty(PK_LOCATION_ID) || cacheSquareLocation_();
  var end = new Date(); var start = new Date(end.getTime() - 7 * 86400000);
  var counts = {};
  var cursor = null; var safety = 0;
  do {
    var body = { location_ids: [locationId], query: { filter: { date_time_filter: { created_at: { start_at: start.toISOString(), end_at: end.toISOString() } }, state_filter: { states: ['COMPLETED'] } } }, limit: 500 };
    if (cursor) body.cursor = cursor;
    var resp = UrlFetchApp.fetch('https://connect.squareup.com/v2/orders/search', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token, 'Square-Version': '2024-06-04' }, payload: JSON.stringify(body), muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) break;
    var json = JSON.parse(resp.getContentText());
    (json.orders || []).forEach(function (o) {
      (o.line_items || []).forEach(function (li) {
        (li.modifiers || []).forEach(function (mod) {
          var n = (mod.name || '').trim();
          if (n) counts[n] = (counts[n] || 0) + (parseInt(li.quantity || '1', 10) || 1);
        });
      });
    });
    cursor = json.cursor || null; safety++;
  } while (cursor && safety < 50);
  var out = [];
  for (var k in counts) out.push(k + ':' + counts[k]);
  out.sort();
  Logger.log(out.join('  |  ') || 'NO MODIFIERS');
}

// Diagnostic: list every Coffee-category costing in the DB, then every
// coffee-ish 7-day sales bucket with what it currently resolves to (or
// UNMATCHED). Use this to catch online (Mr Yum / me&u) coffee buckets that fold
// into the wrong recipe or drop out — the multi-channel attribution check.
// Run from the editor; no clasp/deploy needed.
function mrDebugCoffee() {
  var end = new Date(), start = new Date(end.getTime() - 7 * 86400000);
  var buckets  = mrFetchSquareBuckets_(start.toISOString(), end.toISOString());
  var entries  = mrExplicitEntries_();
  var products = mrFetchCostings_().products;

  Logger.log('--- COFFEE COSTINGS IN DB ---');
  products.filter(function (p) { return (p.category || '') === 'Coffee'; })
          .sort(function (a, b) { return a.name < b.name ? -1 : 1; })
          .forEach(function (p) { Logger.log('%s  $%s  %s%%', p.name, p.sell, p.margin); });

  Logger.log('--- COFFEE-ISH BUCKETS -> RESOLVED ---');
  var KW = /COFFEE|LATTE|CAPPU|FLAT WHITE|LONG BLACK|MACCHIATO|ESPRESSO|PICCOLO|MAGIC|MOCHA|MATCHA|CHAI|BABYCHINO|BATCH|COLD BREW|FILTER|AFFOGATO|ICED|HOT CHOC|TA WHITE|LG WHITE|TA BLACK|LG BLACK/;
  var rows = [];
  for (var k in buckets) {
    var b = buckets[k];
    if (!KW.test(b.item)) continue;
    var p = mrAttribute_(b, entries, products) || (!b.mods ? mrResolveProduct_(b.itemName, products) : null);
    rows.push({ disp: b.item + (b.variation && b.variation !== 'REGULAR' ? ' ' + b.variation : '') +
                       (b.mods ? ' +' + b.mods : ''), qty: b.qty, to: (p ? p.name : 'UNMATCHED') });
  }
  rows.sort(function (a, b) { return (a.to === 'UNMATCHED' ? 0 : 1) - (b.to === 'UNMATCHED' ? 0 : 1) || b.qty - a.qty; });
  rows.forEach(function (r) { Logger.log('%s  qty %s  ->  %s', r.disp, r.qty, r.to); });
}

function installMarginReview() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runWeeklyMarginReview') ScriptApp.deleteTrigger(t);
  });
  // Daily at ~6am: the review always covers a rolling 7-day window, so a
  // daily refresh keeps the dashboard current without changing the maths.
  ScriptApp.newTrigger('runWeeklyMarginReview')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  Logger.log('✓ Margin review trigger created (daily ~6am, rolling 7-day window).');
}

// ─────────────────────────────────────────────────────────────────────────────
//  BUILD
// ─────────────────────────────────────────────────────────────────────────────

function buildMarginReview_() {
  var end   = new Date();
  var start = new Date(end.getTime() - 7 * 86400000);

  var buckets  = mrFetchSquareBuckets_(start.toISOString(), end.toISOString());
  var fetched  = mrFetchCostings_();
  var products = fetched.products;     // deduped, with .norm
  var entries  = mrExplicitEntries_();

  // Accumulate sales per product. Each bucket is attributed at most once.
  var acc = {};   // product.norm → { product, qty, gross }
  var unmatched = [];

  for (var key in buckets) {
    var b = buckets[key];
    var product = mrAttribute_(b, entries, products);
    if (!product) {
      // Fuzzy fallback ONLY for modifier-free buckets (a modifier means it's
      // a variant we'd rather report as a gap than mis-attribute).
      if (!b.mods) product = mrResolveProduct_(b.itemName, products);
    }
    if (product) {
      if (!acc[product.norm]) acc[product.norm] = { product: product, qty: 0, gross: 0 };
      acc[product.norm].qty   += b.qty;
      acc[product.norm].gross += b.gross;
    } else {
      unmatched.push({ name: b.display, weeklyQty: b.qty, weeklyGross: r2(b.gross / 100) });
    }
  }

  // Rank underperformers by weekly $ shortfall vs the 70% target.
  //
  // Coffee vs food are reported as SEPARATE badges on the dashboard. Two traps
  // this code now avoids on purpose:
  //   1. Dollar-shortfall ranking structurally favours food. A $19 panini 12pts
  //      under target loses ~$20/wk; a $7 coffee 10pts under loses ~$0.50/wk.
  //      A single global top-N list therefore lets food crowd coffee out, and
  //      the coffee badge reads near-zero. Fix: cap the DISPLAY list per
  //      category (MR_MAX_PER_CAT each), not globally.
  //   2. The badge $ figure must be CATEGORY-COMPLETE, i.e. summed over ALL
  //      underperformers in that category — never over the display-capped
  //      slice. Fix: coffeeShortfall / foodShortfall below are computed from
  //      the full `items` array before any capping.
  var items = [];
  var greenCount = 0;
  // Category revenue (GST-inc gross) for every matched product, greens
  // included — the denominator for "% of category sales at risk". Low-ticket
  // coffee will always show a smaller $ at-risk than food even when fully
  // costed; the % makes the real pressure comparable across categories.
  var catRevenue = { coffee: 0, food: 0 };
  function mrIsCoffee_(p) { return (p.category || '') === 'Coffee'; }
  for (var norm in acc) {
    var a = acc[norm];
    var p = a.product;
    if (mrIsCoffee_(p)) catRevenue.coffee += a.gross / 100;
    else                catRevenue.food   += a.gross / 100;
    if (p.margin >= MR_TARGET_MARGIN) { greenCount++; continue; }
    var sellEx    = p.sell / 1.1;
    var shortfall = r2(a.qty * sellEx * (MR_TARGET_MARGIN - p.margin) / 100);
    items.push({
      name:        p.name,
      category:    p.category || '',
      margin:      r2(p.margin),
      sell:        p.sell,
      weeklyQty:   a.qty,
      weeklyGross: r2(a.gross / 100),
      shortfall:   shortfall,
      severity:    p.margin < MR_RED_BELOW ? 'red' : 'amber',
    });
  }
  items.sort(function (a, b) { return b.shortfall - a.shortfall; });

  var coffeeItems = items.filter(function (i) { return i.category === 'Coffee'; });
  var foodItems   = items.filter(function (i) { return i.category !== 'Coffee'; });

  // Category-complete at-risk $ (summed over ALL underperformers, pre-cap).
  function mrSumShortfall_(list) {
    return r2(list.reduce(function (s, i) { return s + i.shortfall; }, 0));
  }
  var coffeeShortfall = mrSumShortfall_(coffeeItems);
  var foodShortfall   = mrSumShortfall_(foodItems);

  // % of category revenue lost to sub-target margin — comparable across coffee
  // and food regardless of ticket size.
  var coffeeShortfallPct = catRevenue.coffee > 0 ? r2(100 * coffeeShortfall / catRevenue.coffee) : 0;
  var foodShortfallPct   = catRevenue.food   > 0 ? r2(100 * foodShortfall   / catRevenue.food)   : 0;

  // Display list: top N per category, re-merged and re-sorted by $ shortfall so
  // each category is guaranteed representation but the combined list still reads
  // worst-first.
  var top = coffeeItems.slice(0, MR_MAX_PER_CAT)
    .concat(foodItems.slice(0, MR_MAX_PER_CAT))
    .sort(function (a, b) { return b.shortfall - a.shortfall; });

  unmatched.sort(function (a, b) { return b.weeklyQty - a.weeklyQty; });

  // Weekly volume for EVERY matched product (greens included) so the
  // dashboard can show qty/wk on all tiles, not just flagged ones.
  var sales = [];
  for (var sk in acc) {
    sales.push({ name: acc[sk].product.name, weeklyQty: acc[sk].qty });
  }

  // Honest coverage signal: how many unmatched buckets look like drinks/coffee
  // with no costing yet (Babychino, Batch Brew, Iced Filter, Long Macchiato…).
  // These contribute $0 to coffeeShortfall, so the badge can flag the gap
  // ("+N drinks not yet costed") instead of silently under-reporting.
  var COFFEE_KW = /\b(COFFEE|LATTE|CAPPU|FLAT WHITE|LONG BLACK|MACCHIATO|ESPRESSO|PICCOLO|MAGIC|CORTADO|MOCHA|MATCHA|CHAI|BABYCHINO|BATCH BREW|COLD BREW|FILTER|AFFOGATO|ICED|HOT CHOC|TA WHITE|LG WHITE)\b/;
  var unmatchedCoffee = unmatched.filter(function (u) { return COFFEE_KW.test(String(u.name).toUpperCase()); });

  return {
    type:                'margin_review',
    updated:             new Date().toISOString(),
    weekStart:           start.toISOString().slice(0, 10),
    weekEnd:             end.toISOString().slice(0, 10),
    targetMargin:        MR_TARGET_MARGIN,
    items:               top,
    // Category-complete at-risk totals (summed pre-cap). totalShortfall is now
    // coffee + food so it stays consistent with the two badges.
    coffeeShortfall:     coffeeShortfall,
    foodShortfall:       foodShortfall,
    coffeeShortfallPct:  coffeeShortfallPct,
    foodShortfallPct:    foodShortfallPct,
    coffeeRevenue:       r2(catRevenue.coffee),
    foodRevenue:         r2(catRevenue.food),
    coffeeFlagged:       coffeeItems.length,
    foodFlagged:         foodItems.length,
    totalShortfall:      r2(coffeeShortfall + foodShortfall),
    greenCount:          greenCount,
    sales:               sales,
    unmatched:           unmatched.slice(0, MR_MAX_UNMATCHED),
    unmatchedCoffeeCount: unmatchedCoffee.length,
    unmatchedCoffeeQty:   unmatchedCoffee.reduce(function (s, u) { return s + u.weeklyQty; }, 0),
    duplicates:          fetched.duplicates,   // Notion costing entries sharing a name
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  ATTRIBUTION
// ─────────────────────────────────────────────────────────────────────────────

// Normalise for comparison: uppercase, strip punctuation (keeps + for H+C),
// collapse whitespace. "Iced Latte (DINE IN)" → "ICED LATTE DINE IN".
function mrNorm_(s) {
  return String(s || '').toUpperCase()
    .replace(/[^A-Z0-9+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Canonical key for a set of recognised modifiers.
function mrModsKey_(mods) {
  return (mods || [])
    .map(function (m) {
      var up = String(m).toUpperCase().trim();
      return MR_MOD_ALIASES[up] || up;
    })
    .filter(function (m) { return MR_RECOGNISED_MODS.indexOf(m) !== -1; })
    .sort()
    .join('+');
}

// Flatten the curated maps into uniform entries:
//   { item: <norm item name>, variation: <UPPER or null>, mods: <modsKey>, recipes: [...] }
function mrExplicitEntries_() {
  var entries = [];
  function add(squareItem, variation, mods, recipes) {
    entries.push({
      item:      mrNorm_(squareItem),
      variation: variation ? String(variation).toUpperCase().trim() : null,
      mods:      mrModsKey_(mods),
      recipes:   recipes,
    });
  }
  try {
    COFFEE_SQUARE_MAP.forEach(function (e) {
      add(e.squareItem, e.variation || null, e.modifiers || [], e.recipes || []);
    });
  } catch (err) { Logger.log('WARN: COFFEE_SQUARE_MAP unavailable: ' + err.message); }
  try {
    SQUARE_RETAIL_MAP.forEach(function (e) {
      add(e.squareItem, e.variation || null, e.modifier ? [e.modifier] : [], [e.recipe]);
    });
  } catch (err) { Logger.log('WARN: SQUARE_RETAIL_MAP unavailable: ' + err.message); }
  MR_EXTRA_MAP.forEach(function (e) {
    add(e.squareItem, e.variation || null, e.modifiers || [], e.recipes || []);
  });
  return entries;
}

// Match one sales bucket to a costing product via the explicit entries.
// Returns the product or null.
function mrAttribute_(bucket, entries, products) {
  // Same item, same recognised-modifier set.
  var candidates = entries.filter(function (e) {
    return e.item === bucket.item && e.mods === bucket.mods;
  });
  if (candidates.length === 0) return null;

  // Variation: prefer an entry whose variation appears in the bucket's
  // variation name; otherwise fall back to the variation-less entry
  // (= the small/default recipe).
  var chosen = null;
  for (var i = 0; i < candidates.length; i++) {
    var e = candidates[i];
    if (e.variation && bucket.variation.indexOf(e.variation) !== -1) { chosen = e; break; }
  }
  if (!chosen) {
    for (var j = 0; j < candidates.length; j++) {
      if (!candidates[j].variation) { chosen = candidates[j]; break; }
    }
  }
  if (!chosen) return null;

  // First recipe name that resolves to a Notion costing wins.
  for (var k = 0; k < chosen.recipes.length; k++) {
    var p = mrResolveProduct_(chosen.recipes[k], products);
    if (p) return p;
  }
  return null;
}

// Resolve a name to a costing product: exact normalised match first, then
// containment ONLY if it's unambiguous (exactly one candidate).
function mrResolveProduct_(name, products) {
  var n = mrNorm_(name);
  if (!n) return null;
  if (MR_NAME_ALIASES[n]) n = mrNorm_(MR_NAME_ALIASES[n]);
  for (var i = 0; i < products.length; i++) {
    if (products[i].norm === n) return products[i];
  }
  var hits = [];
  for (var j = 0; j < products.length; j++) {
    var pn = products[j].norm;
    if (pn.length >= 3 && n.length >= 3 &&
        (n.indexOf(pn) !== -1 || pn.indexOf(n) !== -1)) hits.push(products[j]);
  }
  return hits.length === 1 ? hits[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SQUARE — 7-day sales, bucketed by item + variation + recognised modifiers
// ─────────────────────────────────────────────────────────────────────────────

function mrFetchSquareBuckets_(startIso, endIso) {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN not set.');
  var locationId = PropertiesService.getScriptProperties().getProperty(PK_LOCATION_ID) || cacheSquareLocation_();

  var buckets = {};   // key → { itemName, item, variation, mods, display, qty, gross }
  var cursor  = null;
  var safety  = 0;

  do {
    var body = {
      location_ids: [locationId],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: startIso, end_at: endIso } },
          state_filter: { states: ['COMPLETED'] }
        },
        sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' }
      },
      limit: 500
    };
    if (cursor) body.cursor = cursor;

    var resp = UrlFetchApp.fetch('https://connect.squareup.com/v2/orders/search', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, 'Square-Version': '2024-06-04' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log('Square Orders.search failed: %s %s', resp.getResponseCode(),
                 resp.getContentText().slice(0, 400));
      break;
    }

    var json = JSON.parse(resp.getContentText());
    (json.orders || []).forEach(function (o) {
      (o.line_items || []).forEach(function (li) {
        if (!li.name) return;
        var itemName  = li.name.trim();
        var variation = (li.variation_name || '').toUpperCase().trim();
        var modNames  = (li.modifiers || []).map(function (m) { return (m.name || '').trim(); });
        // Some registers ring size as a LARGE modifier rather than a
        // variation (152/wk observed) — promote it so larges aren't costed
        // as smalls.
        if (!variation || variation === 'REGULAR') {
          var hasLarge = modNames.some(function (n) { return n.toUpperCase() === 'LARGE'; });
          if (hasLarge) variation = 'LARGE';
        }
        var modsKey   = mrModsKey_(modNames);

        var key = mrNorm_(itemName) + '|' + variation + '|' + modsKey;
        if (!buckets[key]) {
          buckets[key] = {
            itemName:  itemName,
            item:      mrNorm_(itemName),
            variation: variation,
            mods:      modsKey,
            display:   itemName +
                       (variation && variation !== 'REGULAR' ? ' ' + variation : '') +
                       (modsKey ? ' +' + modsKey : ''),
            qty: 0, gross: 0,
          };
        }
        buckets[key].qty   += parseInt(li.quantity || '1', 10) || 1;
        buckets[key].gross += (li.gross_sales_money && li.gross_sales_money.amount) || 0;
      });
    });

    cursor = json.cursor || null;
    safety++;
  } while (cursor && safety < 50);

  return buckets;
}

// ─────────────────────────────────────────────────────────────────────────────
//  NOTION — Product Costings (Name, Category, Sell Price, Profit %), deduped
// ─────────────────────────────────────────────────────────────────────────────

function mrFetchCostings_() {
  var raw     = [];
  var cursor  = null;
  var hasMore = true;

  while (hasMore) {
    var body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    var res = UrlFetchApp.fetch('https://api.notion.com/v1/databases/' + MR_DB_ID + '/query', {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + SIP_NOTION_API_KEY,
                 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var data = JSON.parse(res.getContentText());
    if (data.object === 'error') throw new Error('Notion query error: ' + data.message);

    (data.results || []).forEach(function (page) {
      var props = page.properties || {};
      var name = (props.Name && props.Name.title && props.Name.title[0])
        ? props.Name.title[0].plain_text : null;
      if (!name) return;
      raw.push({
        name:     name,
        norm:     mrNorm_(name),
        category: (props.Category && props.Category.select && props.Category.select.name) || '',
        sell:     (props['Sell Price'] && props['Sell Price'].number != null) ? props['Sell Price'].number : null,
        margin:   (props['Profit %']   && props['Profit %'].number   != null) ? props['Profit %'].number   : null,
      });
    });

    hasMore = data.has_more;
    cursor  = data.next_cursor;
  }

  // Dedupe by normalised name (e.g. the same recipe entered twice in Notion
  // with different casing). Keep the first complete entry; report the rest.
  var seen = {};
  var products = [];
  var duplicates = [];
  raw.forEach(function (p) {
    if (p.sell === null || p.margin === null) return;  // unusable for review
    if (seen[p.norm]) { duplicates.push(p.name); return; }
    seen[p.norm] = true;
    products.push(p);
  });

  return { products: products, duplicates: duplicates };
}

// ─────────────────────────────────────────────────────────────────────────────
//  NOTION WRITER — same chunked code-block pattern as ingredient_prices / drift
// ─────────────────────────────────────────────────────────────────────────────

function mrWriteToNotion_(payload) {
  var json = JSON.stringify(payload);
  var headers = {
    'Authorization': 'Bearer ' + SIP_NOTION_API_KEY,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  var allBlocks = [];
  var cursor = null;
  do {
    var url = 'https://api.notion.com/v1/blocks/' + SIP_NOTION_PAGE_ID + '/children?page_size=100';
    if (cursor) url += '&start_cursor=' + cursor;
    var res  = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    allBlocks = allBlocks.concat(data.results || []);
    cursor    = data.has_more ? data.next_cursor : null;
  } while (cursor);

  var existingBlock = allBlocks.find(function (b) {
    if (b.type !== 'code') return false;
    var text = (b.code && b.code.rich_text || []).map(function (r) { return r.plain_text; }).join('');
    return text.indexOf('"margin_review"') !== -1;
  });

  var chunks = [];
  for (var i = 0; i < json.length; i += 1900) {
    chunks.push({ type: 'text', text: { content: json.slice(i, i + 1900) } });
  }
  var blockBody = JSON.stringify({ type: 'code', code: { language: 'json', rich_text: chunks } });

  if (existingBlock) {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + existingBlock.id, {
      method: 'PATCH', headers: headers, payload: blockBody, muteHttpExceptions: true,
    });
  } else {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + SIP_NOTION_PAGE_ID + '/children', {
      method: 'PATCH', headers: headers,
      payload: JSON.stringify({ children: [JSON.parse(blockBody)] }),
      muteHttpExceptions: true,
    });
  }
}
