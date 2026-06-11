// ═══════════════════════════════════════════════════════════════════════════════
//  MarginReview.gs
//  Weekly margin intelligence: joins 7 days of Square item sales against the
//  Notion Product Costings DB (Sell Price + Profit %), ranks underperforming
//  recipes by WEEKLY DOLLAR IMPACT (not just margin %), and writes the result
//  to the TIGEROS Notion OS page as a `margin_review` JSON code block.
//  The dashboard reads it via /api/margin-review.
//
//  Why dollar-ranked: a 55% margin on something selling 8/week matters less
//  than a 64% margin on something selling 160/week. Ranking by weekly margin
//  shortfall vs the 70% target puts the money leak at the top of the list.
//
//  ── REUSES (Apps Script flat namespace) ────────────────────────────────────
//    SIP_NOTION_API_KEY, SIP_NOTION_PAGE_ID   (SyncIngredientPrices.gs)
//    cacheSquareLocation_(), PK_LOCATION_ID    (TakeawayCupCounter.gs)
//    r2()                                      (ScanSuppliers.gs)
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
var MR_MAX_ITEMS     = 12;    // cap the ranked list
var MR_MAX_UNMATCHED = 5;     // top Square sellers with no costing match

// ─────────────────────────────────────────────────────────────────────────────
//  ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────

function runWeeklyMarginReview() {
  var payload = buildMarginReview_();
  mrWriteToNotion_(payload);
  Logger.log('Margin review synced: %s flagged item(s), $%s/wk total shortfall, %s green.',
             payload.items.length, payload.totalShortfall, payload.greenCount);
}

// Preview in the editor without touching Notion.
function printMarginReview() {
  Logger.log(JSON.stringify(buildMarginReview_(), null, 2));
}

function installMarginReview() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runWeeklyMarginReview') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runWeeklyMarginReview')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(6)
    .create();
  Logger.log('✓ Weekly margin review trigger created (Mondays 6am).');
}

// ─────────────────────────────────────────────────────────────────────────────
//  BUILD
// ─────────────────────────────────────────────────────────────────────────────

function buildMarginReview_() {
  var end   = new Date();
  var start = new Date(end.getTime() - 7 * 86400000);

  var sales    = mrFetchSquareSales_(start.toISOString(), end.toISOString());
  var products = mrFetchCostings_();

  var items     = [];
  var matched   = {};   // normalised Square key → true
  var greenCount = 0;

  products.forEach(function (p) {
    if (p.margin === null || p.sell === null) return;

    // Sum sales across every Square line whose normalised name matches this
    // product (covers "TA FLAT WHITE", "Flat White", "Iced Latte (DINE IN)" etc).
    var pNorm = mrNormalise_(p.name);
    var qty = 0, gross = 0;
    for (var key in sales) {
      if (mrNamesMatch_(pNorm, key)) {
        qty   += sales[key].qty;
        gross += sales[key].gross;
        matched[key] = true;
      }
    }
    if (qty === 0) return;  // didn't sell this week — nothing to rank

    if (p.margin >= MR_TARGET_MARGIN) { greenCount++; return; }

    // Weekly margin shortfall vs target, on GST-exclusive revenue.
    var sellEx     = p.sell / 1.1;
    var shortfall  = r2(qty * sellEx * (MR_TARGET_MARGIN - p.margin) / 100);
    items.push({
      name:        p.name,
      category:    p.category || '',
      margin:      r2(p.margin),
      sell:        p.sell,
      weeklyQty:   qty,
      weeklyGross: r2(gross / 100),                       // cents → $
      shortfall:   shortfall,                             // $ / week vs 70% target
      severity:    p.margin < MR_RED_BELOW ? 'red' : 'amber',
    });
  });

  items.sort(function (a, b) { return b.shortfall - a.shortfall; });
  var top = items.slice(0, MR_MAX_ITEMS);

  // Top sellers Square knows about but no costing matched — coverage gaps.
  var unmatched = [];
  for (var key in sales) {
    if (matched[key]) continue;
    unmatched.push({ name: sales[key].displayName, weeklyQty: sales[key].qty,
                     weeklyGross: r2(sales[key].gross / 100) });
  }
  unmatched.sort(function (a, b) { return b.weeklyQty - a.weeklyQty; });

  return {
    type:           'margin_review',
    updated:        new Date().toISOString(),
    weekStart:      start.toISOString().slice(0, 10),
    weekEnd:        end.toISOString().slice(0, 10),
    targetMargin:   MR_TARGET_MARGIN,
    items:          top,
    totalShortfall: r2(top.reduce(function (s, i) { return s + i.shortfall; }, 0)),
    greenCount:     greenCount,
    unmatched:      unmatched.slice(0, MR_MAX_UNMATCHED),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SQUARE — 7-day item sales, aggregated by normalised line-item name
// ─────────────────────────────────────────────────────────────────────────────

function mrFetchSquareSales_(startIso, endIso) {
  var token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN not set.');
  var locationId = PropertiesService.getScriptProperties().getProperty(PK_LOCATION_ID) || cacheSquareLocation_();

  var sales  = {};   // normalised name → { qty, gross (cents), displayName }
  var cursor = null;
  var safety = 0;

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
        var key = mrNormalise_(li.name);
        if (!key) return;
        if (!sales[key]) sales[key] = { qty: 0, gross: 0, displayName: li.name.trim() };
        sales[key].qty   += parseInt(li.quantity || '1', 10) || 1;
        sales[key].gross += (li.gross_sales_money && li.gross_sales_money.amount) || 0;
      });
    });

    cursor = json.cursor || null;
    safety++;
  } while (cursor && safety < 50);

  return sales;
}

// ─────────────────────────────────────────────────────────────────────────────
//  NOTION — Product Costings (Name, Category, Sell Price, Profit %)
// ─────────────────────────────────────────────────────────────────────────────

function mrFetchCostings_() {
  var products = [];
  var cursor   = null;
  var hasMore  = true;

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
      products.push({
        name:     name,
        category: (props.Category && props.Category.select && props.Category.select.name) || '',
        sell:     (props['Sell Price'] && props['Sell Price'].number != null) ? props['Sell Price'].number : null,
        margin:   (props['Profit %']   && props['Profit %'].number   != null) ? props['Profit %'].number   : null,
      });
    });

    hasMore = data.has_more;
    cursor  = data.next_cursor;
  }
  return products;
}

// ─────────────────────────────────────────────────────────────────────────────
//  NAME MATCHING
// ─────────────────────────────────────────────────────────────────────────────

// Normalise a product/line-item name for matching: uppercase, strip takeaway
// prefixes ("TA ", "LG "), parentheticals ("(DINE IN)"), and noise words that
// differ between Square and the costing sheets ("SANDWICH").
function mrNormalise_(name) {
  return String(name).toUpperCase()
    .replace(/^(TA|LG)\s+/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bSANDWICH\b/g, ' ')
    .replace(/[^A-Z0-9+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Match if either normalised name contains the other (mirrors squareFindItem_'s
// bidirectional containment, which is already proven on this catalog).
function mrNamesMatch_(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3) return a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
  return false;
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
