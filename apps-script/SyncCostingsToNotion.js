/**
 * G'Day Tiger — Sync Food + Coffee Costings → Notion Product Costings DB
 * Updated: 2026-05-03
 *
 * Reads Sell Price + Profit % from FOOD and COFFEE sheets, writes to Notion.
 * Setup: Project Settings → Script Properties → NOTION_API_KEY = <your token>
 */

function syncCostingsToNotion() {
  const SHEET_ID   = '1nZvWNFaQTrJAt-ilYihZjYZKBzHd6x3qIrjFhdNQqAU';
  const SHEET_NAME = 'FOOD';
  const DB_ID      = '8f16358a47e54062b5fe1ce7a7480754';
  const NOTION_KEY = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  if (!NOTION_KEY) throw new Error('NOTION_API_KEY not set.');

  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found.');
  const data = sheet.getDataRange().getValues();

  const products = getFoodNotionProducts(DB_ID, NOTION_KEY);
  Logger.log('Food Notion products found: ' + products.length);

  const updated = [];
  const missed  = [];

  products.forEach(function (product) {
    const sectionRow = findSectionRow(data, product.name);
    if (sectionRow === -1) { if (!isBoughtIn_(product.name)) missed.push('NOT FOUND in sheet: "' + product.name + '"'); return; }

    const values = extractSheetValues(data, sectionRow);
    if (values.sellPrice === null) { missed.push('No Retail Price found for: "' + product.name + '"'); return; }
    if (values.profitPct === null) { missed.push('No Profit % found for: "' + product.name + '"'); return; }

    const sellSame = product.currentSell !== null && Math.abs(product.currentSell - values.sellPrice) < 0.005;
    const pctSame  = product.currentPct  !== null && Math.abs(product.currentPct  - values.profitPct) < 0.01;
    const costSame = (values.cost == null) || (product.currentCost != null && Math.abs(product.currentCost - values.cost) < 0.005);
    if (sellSame && pctSame && costSame) return;

    const result = updateNotionPage(product.id, values.sellPrice, values.profitPct, values.cost, NOTION_KEY);
    Utilities.sleep(300);
    if (result.ok) {
      updated.push('✓ ' + product.name + ' — $' + values.sellPrice.toFixed(2) + ', ' + values.profitPct.toFixed(1) + '%');
    } else {
      missed.push('NOTION ERROR for "' + product.name + '": ' + result.error);
    }
  });

  const summary = [
    'Food sync: ' + new Date().toLocaleString('en-AU'), '',
    '=== UPDATED (' + updated.length + ') ===', updated.join('\n') || '(none)', '',
    '=== SKIPPED / ERRORS (' + missed.length + ') ===', missed.join('\n') || '(none)',
  ].join('\n');

  Logger.log(summary);
  try { SpreadsheetApp.getUi().alert(summary); } catch (e) { /* trigger run */ }
  return summary;
}

// ── FOOD HELPERS ──────────────────────────────────────────────────────────────

/** Query Notion DB for Food category items only. */
function getFoodNotionProducts(dbId, notionKey) {
  const products = [];
  let cursor  = null;
  let hasMore = true;

  while (hasMore) {
    const body = {
      page_size: 100,
      filter: { property: 'Category', select: { equals: 'Food' } },
    };
    if (cursor) body.start_cursor = cursor;

    const res  = UrlFetchApp.fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + notionKey,
                 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });

    const data = JSON.parse(res.getContentText());
    if (data.object === 'error') throw new Error('Notion query error: ' + data.message);

    (data.results || []).forEach(function (page) {
      const name = (page.properties.Name && page.properties.Name.title && page.properties.Name.title[0])
        ? page.properties.Name.title[0].plain_text : null;
      if (!name) return;
      const currentSell = (page.properties['Sell Price'] && page.properties['Sell Price'].number != null)
        ? page.properties['Sell Price'].number : null;
      const currentPct  = (page.properties['Profit %'] && page.properties['Profit %'].number != null)
        ? page.properties['Profit %'].number : null;
      var currentCost = (page.properties['Cost'] && page.properties['Cost'].number != null) ? page.properties['Cost'].number : null;
      products.push({ id: page.id, name: name, currentSell: currentSell, currentPct: currentPct, currentCost: currentCost });
    });

    hasMore = data.has_more;
    cursor  = data.next_cursor;
  }

  return products;
}

// Keep getNotionProducts for backwards compatibility (used by uppercaseAllNotionNames)
function getNotionProducts(dbId, notionKey) {
  const products = [];
  let cursor  = null;
  let hasMore = true;
  while (hasMore) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res  = UrlFetchApp.fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + notionKey,
                 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const data = JSON.parse(res.getContentText());
    if (data.object === 'error') throw new Error('Notion query error: ' + data.message);
    (data.results || []).forEach(function (page) {
      const name = (page.properties.Name && page.properties.Name.title && page.properties.Name.title[0])
        ? page.properties.Name.title[0].plain_text : null;
      if (!name) return;
      products.push({ id: page.id, name: name });
    });
    hasMore = data.has_more;
    cursor  = data.next_cursor;
  }
  return products;
}

var NOTION_TO_SHEET_NAME = {
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

// Notion products that are bought-in / priced directly (no recipe section in the
// sheet). The sync intentionally skips these — they're not errors. Their Sell
// Price is managed manually in Notion.
var NOTION_BOUGHT_IN = {
  'brownie': 1, 'cake (maple pecan slice)': 1, 'cake (carrot)': 1,
  'cookie (marshy)': 1, 'cookie (pretzel oat)': 1, 'plain croissant': 1,
  'toast (full serve)': 1, 'toast (half serve)': 1, 'orange juice': 1
};
function isBoughtIn_(name) { return !!NOTION_BOUGHT_IN[String(name || '').toLowerCase().trim()]; }

function findSectionRow(data, productName) {
  var mapped = NOTION_TO_SHEET_NAME[productName.toLowerCase().trim()];
  var target = normalise(mapped || productName);
  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      if (normalise(String(data[r][c] || '')) === target) return r;
    }
  }
  return -1;
}

function extractSheetValues(data, sectionRow) {
  var retailPrices = [];
  var profitPct    = null;
  var totalWastage = null;
  for (var r = sectionRow + 1; r < Math.min(sectionRow + 45, data.length); r++) {
    var label  = normalise(String(data[r][4] || ''));
    var rawVal = data[r][5];
    var numVal = (rawVal !== '' && rawVal !== null && !isNaN(rawVal)) ? parseFloat(rawVal) : null;
    if (label === 'retail price' && numVal !== null) retailPrices.push(numVal);
    if (label.indexOf('total') !== -1 && label.indexOf('wastage') !== -1 && numVal !== null) totalWastage = numVal;
    if (label === 'profit %'     && numVal !== null) profitPct = numVal;
    if (label === 'profit %') break;
  }
  var sellPrice = retailPrices.length >= 2 ? retailPrices[1]
                : retailPrices.length === 1 ? retailPrices[0]
                : null;
  return { sellPrice: sellPrice, profitPct: profitPct, cost: totalWastage };
}

function updateNotionPage(pageId, sellPrice, profitPct, cost, notionKey) {
  const res = UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + pageId, {
    method: 'patch',
    headers: { 'Authorization': 'Bearer ' + notionKey,
               'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      properties: {
        'Sell Price': { number: Math.round(sellPrice * 100) / 100 },
        'Profit %':   { number: Math.round(profitPct * 10)  / 10  },
        ...(cost != null && isFinite(cost) ? { 'Cost': { number: Math.round(cost * 100) / 100 } } : {}),
      },
    }),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data.object === 'error') return { ok: false, error: data.message };
  return { ok: true };
}

function normalise(str) {
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COFFEE SHEET SYNC
// ═══════════════════════════════════════════════════════════════════════════════

var COFFEE_SYNC_SS_ID = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI';
var COFFEE_SYNC_SHEET = 'COFFEE';

function syncCoffeeToNotion() {
  const DB_ID      = '8f16358a47e54062b5fe1ce7a7480754';
  const NOTION_KEY = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  if (!NOTION_KEY) throw new Error('NOTION_API_KEY not set.');

  const ss    = SpreadsheetApp.openById(COFFEE_SYNC_SS_ID);
  const sheet = ss.getSheetByName(COFFEE_SYNC_SHEET);
  if (!sheet) throw new Error('Sheet "' + COFFEE_SYNC_SHEET + '" not found.');
  const data = sheet.getDataRange().getValues();

  const coffeeProducts = getCoffeeNotionProducts(DB_ID, NOTION_KEY);
  Logger.log('Coffee Notion products: ' + coffeeProducts.length);

  const updated = [];
  const missed  = [];

  coffeeProducts.forEach(function (product) {
    const sectionRow = findCoffeeSectionRow(data, product.name);
    if (sectionRow === -1) { if (!isBoughtIn_(product.name)) missed.push('NOT FOUND in sheet: "' + product.name + '"'); return; }

    const values = extractCoffeeSheetValues(data, sectionRow);
    if (values.sellPrice === null) { missed.push('No Retail Price for: "' + product.name + '"'); return; }
    if (values.profitPct === null) { missed.push('No Profit % for: "' + product.name + '"'); return; }

    const sellSame = product.currentSell !== null && Math.abs(product.currentSell - values.sellPrice) < 0.005;
    const pctSame  = product.currentPct  !== null && Math.abs(product.currentPct  - values.profitPct) < 0.01;
    const costSame = (values.cost == null) || (product.currentCost != null && Math.abs(product.currentCost - values.cost) < 0.005);
    if (sellSame && pctSame && costSame) return;

    const result = updateNotionPage(product.id, values.sellPrice, values.profitPct, values.cost, NOTION_KEY);
    Utilities.sleep(300);
    if (result.ok) {
      updated.push('✓ ' + product.name + ' — $' + values.sellPrice.toFixed(2) + ', ' + values.profitPct.toFixed(1) + '%');
    } else {
      missed.push('NOTION ERROR for "' + product.name + '": ' + result.error);
    }
  });

  const summary = [
    'Coffee sync: ' + new Date().toLocaleString('en-AU'),
    '=== UPDATED (' + updated.length + ') ===', updated.join('\n') || '(none)',
    '=== SKIPPED / ERRORS (' + missed.length + ') ===', missed.join('\n') || '(none)',
  ].join('\n');

  Logger.log(summary);
  return summary;
}

// ─── COMBINED SYNC ───────────────────────────────────────────────────────────
function syncAllCostingsToNotion() {
  var foodSummary   = syncCostingsToNotion();
  var coffeeSummary = syncCoffeeToNotion();
  // Heartbeat so the daily health check can confirm this sync is alive (it only
  // writes product pages when a price changes, so there's otherwise no signal).
  try { writeCostingsHeartbeat_(); } catch (e) { Logger.log('costings heartbeat error: ' + e.message); }
  Logger.log('\n--- COMBINED RUN COMPLETE ---\n' + foodSummary + '\n\n' + coffeeSummary);
  return foodSummary + '\n\n' + coffeeSummary;
}

// Writes/updates a small JSON "costings_sync" code block on the TIGER OS Notion
// page with the current timestamp, every run. Mirrors the ingredient_prices
// block pattern so the health check can read an "updated" field. Best-effort.
var COSTINGS_OS_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';
function writeCostingsHeartbeat_() {
  var key = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  if (!key) return;
  var headers = { 'Authorization': 'Bearer ' + key, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
  var json = JSON.stringify({ type: 'costings_sync', updated: new Date().toISOString() });

  var allBlocks = [], cursor = null;
  do {
    var url = 'https://api.notion.com/v1/blocks/' + COSTINGS_OS_PAGE_ID + '/children?page_size=100' + (cursor ? '&start_cursor=' + cursor : '');
    var res = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  var existing = allBlocks.find(function (b) {
    if (b.type !== 'code') return false;
    var t = (b.code && b.code.rich_text || []).map(function (r) { return r.plain_text; }).join('');
    return t.indexOf('"costings_sync"') !== -1;
  });

  var blockBody = JSON.stringify({ type: 'code', code: { language: 'json', rich_text: [{ type: 'text', text: { content: json } }] } });

  if (existing) {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + existing.id, { method: 'patch', headers: headers, payload: blockBody, muteHttpExceptions: true });
  } else {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + COSTINGS_OS_PAGE_ID + '/children', { method: 'patch', headers: headers, payload: JSON.stringify({ children: [JSON.parse(blockBody)] }), muteHttpExceptions: true });
  }
}

// ─── COFFEE HELPERS ──────────────────────────────────────────────────────────

function getCoffeeNotionProducts(dbId, notionKey) {
  var products = [];
  var cursor   = null;
  var hasMore  = true;
  while (hasMore) {
    var body = { page_size: 100, filter: { property: 'Category', select: { equals: 'Coffee' } } };
    if (cursor) body.start_cursor = cursor;
    var res = UrlFetchApp.fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + notionKey,
                 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var parsed = JSON.parse(res.getContentText());
    if (parsed.object === 'error') throw new Error('Notion query: ' + parsed.message);
    (parsed.results || []).forEach(function (page) {
      var name = (page.properties.Name && page.properties.Name.title && page.properties.Name.title[0])
                 ? page.properties.Name.title[0].plain_text : null;
      if (!name) return;
      var currentSell = (page.properties['Sell Price'] && page.properties['Sell Price'].number != null)
                        ? page.properties['Sell Price'].number : null;
      var currentPct  = (page.properties['Profit %'] && page.properties['Profit %'].number != null)
                        ? page.properties['Profit %'].number : null;
      var currentCost = (page.properties['Cost'] && page.properties['Cost'].number != null) ? page.properties['Cost'].number : null;
      products.push({ id: page.id, name: name, currentSell: currentSell, currentPct: currentPct, currentCost: currentCost });
    });
    hasMore = parsed.has_more;
    cursor  = parsed.next_cursor;
  }
  return products;
}

function findCoffeeSectionRow(data, productName) {
  var target = normalise(productName);
  for (var r = 0; r < data.length; r++) {
    var cellA = String(data[r][0] || '').trim();
    var cellB = String(data[r][1] || '').trim();
    var cellE = String(data[r][4] || '').trim();
    if (cellA && !cellB && !cellE && normalise(cellA) === target) return r;
  }
  return -1;
}

function extractCoffeeSheetValues(data, sectionRow) {
  var sellPrice = null;
  var profitPct = null;
  var totalWastage = null;
  for (var r = sectionRow + 1; r < Math.min(sectionRow + 60, data.length); r++) {
    var labelEF = normalise(String(data[r][4] || ''));
    var rawEF   = data[r][5];
    var numEF   = (rawEF !== '' && rawEF !== null && !isNaN(rawEF)) ? parseFloat(rawEF) : null;
    var colEEmpty = (data[r][4] === '' || data[r][4] === null || String(data[r][4]).trim() === '');
    var labelAB   = colEEmpty ? normalise(String(data[r][0] || '')) : '';
    var rawAB     = data[r][1];
    var numAB     = (rawAB !== '' && rawAB !== null && !isNaN(rawAB)) ? parseFloat(rawAB) : null;
    if      (labelEF === 'retail price' && numEF !== null) sellPrice = numEF;
    else if (labelAB === 'retail price' && numAB !== null) sellPrice = numAB;
    if      (labelEF.indexOf('total') !== -1 && labelEF.indexOf('wastage') !== -1 && numEF !== null) totalWastage = numEF;
    else if (labelAB.indexOf('total') !== -1 && labelAB.indexOf('wastage') !== -1 && numAB !== null) totalWastage = numAB;
    if      (labelEF === 'profit %' && numEF !== null) { profitPct = numEF; break; }
    else if (labelAB === 'profit %' && numAB !== null) { profitPct = numAB; break; }
    var nextA = String(data[r][0] || '').trim();
    var nextB = String(data[r][1] || '').trim();
    var nextE = String(data[r][4] || '').trim();
    if (nextA && !nextB && !nextE && r > sectionRow + 4 &&
        nextA === nextA.toUpperCase() && nextA.length > 3) break;
  }
  return { sellPrice: sellPrice, profitPct: profitPct, cost: totalWastage };
}

// ─── TRIGGER MANAGEMENT ──────────────────────────────────────────────────────

function updateSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'syncCostingsToNotion' || fn === 'syncAllCostingsToNotion') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAllCostingsToNotion').timeBased().everyMinutes(30).create();
  Logger.log('✓ 30-minute trigger updated → syncAllCostingsToNotion (FOOD + COFFEE).');
}

// ─── RENAME ALL NOTION ITEMS TO UPPERCASE ────────────────────────────────────
// Run once, then delete this function.
function uppercaseAllNotionNames() {
  var DB_ID      = '8f16358a47e54062b5fe1ce7a7480754';
  var NOTION_KEY = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  var products   = getNotionProducts(DB_ID, NOTION_KEY);
  products.forEach(function(p) {
    var upper = p.name.toUpperCase();
    if (upper === p.name) return;
    UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + p.id, {
      method: 'patch',
      headers: { 'Authorization': 'Bearer ' + NOTION_KEY,
                 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      payload: JSON.stringify({ properties: { Name: { title: [{ text: { content: upper } }] } } }),
      muteHttpExceptions: true,
    });
    Logger.log('Renamed: "' + p.name + '" → "' + upper + '"');
    Utilities.sleep(200);
  });
  Logger.log('Done.');
}