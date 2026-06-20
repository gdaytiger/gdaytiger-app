# Handoff — Multi-channel sales attribution for COFFEE costings

Replicate for coffee what we just did for food: make the weekly margin tiles count **both counter (Square POS) and online (Mr Yum / me&u)** sales, with online modifier/item names aliased so every coffee sale lands on the right costing tile.

This is a forward task brief. Paste into a new Claude session if continuing fresh.

---

## What was done for food (the pattern to copy)

`MarginReview.js` (Apps Script project **G'DAY TIGER Costings**, scriptId `1A2FgRsoaj9A_pPQSRjvj7_P6mWaEDrhloKO_PYyxC9hvw0wHs4y0c7de`) joins 7 days of Square sales to the Notion Costings DB and writes the `margin_review` JSON block that powers the `N/wk` + `−$/wk` figures on the dashboard tiles.

Key facts established:
- **One Square location only** — `G'DAY TIGER` (`NTXJ6XDXK8MNY`). Counter + Mr Yum online both flow into the **same order feed**, so the script already reads online sales.
- Sales are **bucketed by item name** (normalised: uppercase, strip non-`A-Z0-9+ `, collapse spaces). Same name = same bucket = auto-merged across channels.
- Each bucket is attributed to exactly one costing via three maps (top of `MarginReview.js`):
  - `MR_RECOGNISED_MODS` — modifiers that split a sale into its own bucket; everything else folds into the base item.
  - `MR_MOD_ALIASES` — canonicalise a modifier's real Square name to a recognised key (POS and online frequently differ).
  - `MR_NAME_ALIASES` — map a recipe / sheet-section / online item name to the Notion product name.
- The per-product tally (`acc`) is keyed by the **resolved costing**, not the bucket — so differently-named POS vs online buckets still merge onto one tile.

Food fixes applied: `TIGER STYLE (PICKLES + TIGER SAUCE)` → `TIGER STYLE`; online `CHEESE` → `ADD CHEESE`; online `SALAMI AUTOGRILL` → `AUTOGRILL (SALAMI PANINI)`; plus `MR_NAME_ALIASES` for the sheet-section variant names.

---

## Coffee specifics

- Coffee mapping already exists and is large: `COFFEE_SQUARE_MAP` (in `SyncSquarePrices.js`, shared with the price sync) + the coffee block of `MR_EXTRA_MAP` (in `MarginReview.js`) — covers dine-in whites (Flat White / Latte / Cappuccino with milk modifiers, small + large), Long Black, Hot Chocolate, iced lattes, chai, mocha, matcha, espresso-family.
- Coffee modifiers to expect in Square: milk (`Soy`/`Oat`/`Almond`, and `… Milk` variants — already aliased), `Decaf`, `Chocolate`, `Mocha`, `Matcha`, `Chai`, size as a `Large` variation **or** a `LARGE` modifier (already promoted to a variation upstream).
- Costing names live in the Notion **Product Costings** DB `8f16358a47e54062b5fe1ce7a7480754` (Category = `Coffee`). ~48/60 coffee recipes currently sync.

The risk for coffee is the same class of bug as food: **online (Mr Yum) modifier names differing from POS** (e.g. `Soy Milk` vs `Soy`, `Oat Milk` vs `Oat`, an online "Extra Shot"/"Decaf"/syrup named differently), causing online coffee sales to fold into the wrong/plain recipe or drop to `unmatched`.

---

## Step-by-step

All diagnostics run from the editor of project `1A2FgRsoaj9A…` (the one clasp pushes to). Paste a function, **Cmd+S**, pick it in the dropdown, Run, read the log. No clasp needed to run diagnostics.

### 1. List every modifier name in the feed
Run the existing **`printAllModifiers()`**. Compare each name against `MR_RECOGNISED_MODS` + `MR_MOD_ALIASES`. Flag any coffee modifier whose Square name isn't already canonicalised (online milk/decaf/syrup/size variants are the usual offenders).

### 2. Dump every bucket
Run the existing **`printAllBuckets()`**. Find every coffee line and check it resolves sensibly. Watch for:
- Online coffee buckets going to `unmatched` (not shown here — use step 4) or folding into the wrong recipe.
- Plain recipe counts that look too high (a variant folding in — the food "fold-in trap").

### 3. Pull the Mr Yum coffee catalog
In **Square → Items → filter Category = the Mr Yum coffee category** (the coffee equivalent of `MR YUM TOASTED`). Screenshot the item list **and** the modifier list(s). Compare item names + modifier names to POS and to the coffee costing names.

### 4. Confirm what currently resolves (paste this debug function)
```javascript
function mrDebugCoffee() {
  var end = new Date(), start = new Date(end.getTime() - 7 * 86400000);
  var buckets  = mrFetchSquareBuckets_(start.toISOString(), end.toISOString());
  var entries  = mrExplicitEntries_();
  var products = mrFetchCostings_().products;
  Logger.log('--- COFFEE COSTINGS IN DB ---');
  products.filter(function(p){ return (p.category||'') === 'Coffee'; })
          .sort(function(a,b){ return a.name < b.name ? -1 : 1; })
          .forEach(function(p){ Logger.log('%s  $%s  %s%%', p.name, p.sell, p.margin); });
  Logger.log('--- COFFEE-ISH BUCKETS -> RESOLVED ---');
  var KW = /COFFEE|LATTE|CAPPU|FLAT WHITE|LONG BLACK|MACCHIATO|ESPRESSO|PICCOLO|MAGIC|MOCHA|MATCHA|CHAI|BABYCHINO|BATCH|COLD BREW|FILTER|AFFOGATO|ICED|HOT CHOC|TA WHITE|LG WHITE|TA BLACK|LG BLACK/;
  for (var k in buckets) {
    var b = buckets[k];
    if (!KW.test(b.item)) continue;
    var p = mrAttribute_(b, entries, products) || (!b.mods ? mrResolveProduct_(b.itemName, products) : null);
    Logger.log('"%s" var="%s" mods="%s" qty=%s -> %s', b.item, b.variation, b.mods, b.qty, (p ? p.name : 'UNMATCHED'));
  }
}
```
Anything printing `UNMATCHED` (or resolving to the wrong recipe) is a gap to fix.

### 5. Apply fixes (smallest change that works, in this order)
- **Modifier name differs (online vs recognised):** add an `MR_MOD_ALIASES` entry — key = the modifier's UPPERCASE Square name, value = the recognised key. e.g. `'EXTRA SHOT': 'EXTRA SHOT'` only if you also add it to `MR_RECOGNISED_MODS`; milk variants like `'SOY MILK': 'SOY'` are already covered.
- **Item name differs (online vs costing/POS):** add an `MR_NAME_ALIASES` entry — key = normalised online item name, value = exact Notion costing name.
- **A genuinely new variant with its own costing:** add to the coffee block of `MR_EXTRA_MAP`.

**Decision rules (carried from food):**
- Only add a modifier to `MR_RECOGNISED_MODS` if the +modifier version has its **own costing** (different cost/price). Otherwise leave it unrecognised so it folds into the base — cheap add-ons shouldn't fragment counts.
- Only alias a **generic** modifier globally if it's effectively used on one product; otherwise it splits every item carrying it and undercounts the base.
- Prefer `MR_NAME_ALIASES` over duplicate `MR_EXTRA_MAP` entries — duplicate map entries lose a first-wins race and the fuzzy matcher silently folds them into the plain item.

### 6. Deploy + verify
On the Mac (sandbox can't git/clasp; if clasp errors `invalid_rapt`, run `clasp login` first):
```bash
cd ~/gdaytiger-app && git add apps-script/MarginReview.js && git commit -m "margin review: coffee online modifier/name aliases" && cd apps-script && clasp push
```
Then run `runWeeklyMarginReview()` in the editor. **Verify via `greenCount` / `totalShortfall` moving** (the `N flagged` / `N unmatched` log counts are display-capped and won't change). Re-run `mrDebugCoffee()` to confirm previously-UNMATCHED coffee buckets now resolve.

---

## Gotchas (learned the hard way on food)

- **There is only ONE Apps Script project** — `1A2FgRsoaj9A…` (`G'DAY TIGER Costings`). Run diagnostics and `runWeeklyMarginReview` from this same editor, or results won't match the code you edited.
- **`clasp push` overwrites the editor** — it wipes any throwaway debug functions you pasted (fine) and also pushes other in-progress `apps-script/` files (e.g. `ScanSuppliers.js`); commit/stash those first if not ready.
- **Log counts lie** — `flagged`/`unmatched` are capped (`MR_MAX_PER_CAT*2`, `MR_MAX_UNMATCHED`). Only `greenCount` and `totalShortfall` reliably reflect a change.
- **Payload to inspect:** `margin_review` JSON code block on Notion OS page `3403c99c0e858113a941c2118b3cdef9`; tiles read its `sales[]` array by uppercased name. `updated` timestamp is UTC (Phillip Island = UTC+10) — use it to confirm a fetch is fresh, not cached.
- **Online = same feed.** Don't go hunting a second location/integration — confirmed single location, online flows straight into Square orders.
