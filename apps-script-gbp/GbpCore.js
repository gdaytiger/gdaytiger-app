// ═══════════════════════════════════════════════════════════════════════════════
//  GbpCore.gs — Google Business Profile plumbing for TIGER OS
//
//  A SEPARATE Apps Script project from the costings scripts (apps-script/), so
//  its OAuth scopes (business.manage) never touch the invoice/costings triggers.
//  It runs as gday@gdaytiger.com.au and calls the Business Profile APIs with the
//  script's own OAuth token — so the script's Cloud project MUST be the
//  allowlisted `tigeros` project (Project Settings → Google Cloud Platform
//  project → change to project number 92946970006).
//
//  Script Properties:
//    NOTION_API_KEY        — same integration key the costings scripts use
//    SQUARE_ACCESS_TOKEN   — production Square token (catalogue read)
//    ANTHROPIC_API_KEY     — drafts review replies
//    GBP_SECRET            — shared secret; must match GBP_SECRET in Vercel
//    MENU_SYNC_MODE        — 'preview' (default) or 'live'
//  Cached automatically: GBP_LOCATION (accounts/…/locations/…)
//
//  First run: gbpCheckSetup() from the editor (authorises + logs what it finds),
//  then installGbpTriggers().
// ═══════════════════════════════════════════════════════════════════════════════

var GBP_NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9'; // TIGEROS OS page
var GBP_V4 = 'https://mybusiness.googleapis.com/v4/';

function gbpProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

// Authenticated call to a Business Profile API. Throws with Google's error text.
function gbpFetch_(url, method, body) {
  var opts = {
    method: method || 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (body !== undefined) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(body);
  }
  var res = UrlFetchApp.fetch(url, opts);
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code >= 400) {
    if (code === 429) throw new Error('GBP quota is 0 — API access not approved yet (or rate-limited). ' + text.slice(0, 200));
    throw new Error('GBP ' + code + ' ' + url.replace(GBP_V4, '') + ': ' + text.slice(0, 400));
  }
  return text ? JSON.parse(text) : {};
}

// Resolves and caches the v4 location path: accounts/{a}/locations/{l}
function gbpLocation_() {
  var cached = gbpProp_('GBP_LOCATION');
  if (cached) return cached;

  var accts = gbpFetch_('https://mybusinessaccountmanagement.googleapis.com/v1/accounts').accounts || [];
  for (var i = 0; i < accts.length; i++) {
    var locs = gbpFetch_('https://mybusinessbusinessinformation.googleapis.com/v1/' + accts[i].name +
      '/locations?readMask=name,title&pageSize=100').locations || [];
    var hit = locs.filter(function (l) { return /tiger/i.test(l.title || ''); })[0] || (locs.length === 1 ? locs[0] : null);
    if (hit) {
      var path = accts[i].name + '/' + hit.name; // accounts/123/locations/456
      PropertiesService.getScriptProperties().setProperty('GBP_LOCATION', path);
      return path;
    }
  }
  throw new Error('No G\'DAY TIGER location found on accounts: ' + accts.map(function (a) { return a.name; }).join(', '));
}

// ─── Notion OS page JSON blocks (same storage pattern as sales_daily etc.) ────
function gbpNotionHeaders_() {
  var key = gbpProp_('NOTION_API_KEY');
  if (!key) throw new Error('NOTION_API_KEY not set.');
  return { Authorization: 'Bearer ' + key, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
}

function gbpListOsBlocks_() {
  var headers = gbpNotionHeaders_();
  var all = [], cursor = null;
  do {
    var url = 'https://api.notion.com/v1/blocks/' + GBP_NOTION_PAGE_ID + '/children?page_size=100' + (cursor ? '&start_cursor=' + cursor : '');
    var data = JSON.parse(UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true }).getContentText());
    all = all.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return all;
}

function gbpBlockText_(b) {
  return ((b.code && b.code.rich_text) || []).map(function (r) { return r.plain_text; }).join('');
}

function gbpFindBlock_(blocks, type) {
  var re = new RegExp('"type"\\s*:\\s*"' + type + '"');
  return blocks.filter(function (b) { return b.type === 'code' && re.test(gbpBlockText_(b)); })[0] || null;
}

function gbpReadOsBlock_(type) {
  var b = gbpFindBlock_(gbpListOsBlocks_(), type);
  if (!b) return null;
  try { return JSON.parse(gbpBlockText_(b)); } catch (e) { return null; }
}

function gbpWriteOsBlock_(type, payload) {
  payload.type = type;
  var json = JSON.stringify(payload);
  var chunks = [];
  for (var i = 0; i < json.length; i += 1900) chunks.push({ type: 'text', text: { content: json.slice(i, i + 1900) } });
  if (chunks.length > 100) throw new Error(type + ' block too large (' + json.length + ' chars)');
  var block = { type: 'code', code: { language: 'json', rich_text: chunks } };
  var headers = gbpNotionHeaders_();
  var existing = gbpFindBlock_(gbpListOsBlocks_(), type);
  if (existing) {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + existing.id,
      { method: 'patch', headers: headers, payload: JSON.stringify(block), muteHttpExceptions: true });
  } else {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + GBP_NOTION_PAGE_ID + '/children',
      { method: 'patch', headers: headers, payload: JSON.stringify({ children: [block] }), muteHttpExceptions: true });
  }
}

// ─── Square catalogue (items + variation prices, in cents) ────────────────────
function gbpSquareItems_() {
  var token = gbpProp_('SQUARE_ACCESS_TOKEN');
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN not set.');
  var items = [], cursor = null;
  do {
    var url = 'https://connect.squareup.com/v2/catalog/list?types=ITEM' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token, 'Square-Version': '2024-06-04' },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error('Square catalog: ' + res.getContentText().slice(0, 300));
    var data = JSON.parse(res.getContentText());
    (data.objects || []).forEach(function (o) {
      if (o.is_deleted || !o.item_data) return;
      items.push({
        name: o.item_data.name,
        variations: (o.item_data.variations || []).map(function (v) {
          var vd = v.item_variation_data || {};
          return { name: vd.name || '', cents: vd.price_money ? vd.price_money.amount : null };
        })
      });
    });
    cursor = data.cursor || null;
  } while (cursor);
  return items;
}

// Lower-case, strip punctuation/sizes noise so "Chicken Schnitta Sanga" ≈ "chicken schnitta sanga".
function gbpNorm_(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Run from the editor first. Authorises the scopes and logs what it can see.
function gbpCheckSetup() {
  Logger.log('Token OK, scopes granted.');
  var loc = gbpLocation_();
  Logger.log('Location: ' + loc);
  var info = gbpFetch_('https://mybusinessbusinessinformation.googleapis.com/v1/' + loc.split('/').slice(2).join('/') + '?readMask=title,metadata');
  Logger.log('Title: ' + info.title + ' | canHaveFoodMenus: ' + (info.metadata && info.metadata.canHaveFoodMenus));
  var reviews = gbpFetch_(GBP_V4 + loc + '/reviews?pageSize=1');
  Logger.log('Reviews: ' + reviews.totalReviewCount + ' @ ' + reviews.averageRating);
  Logger.log('Square items: ' + gbpSquareItems_().length);
}

// ─── Web app entry (called by TIGER OS /api/google-reviews + /api/google-photo) ─
function doPost(e) {
  try {
    var expected = gbpProp_('GBP_SECRET');
    var provided = (e && e.parameter && e.parameter.secret) || '';
    if (!expected || provided !== expected) return gbpJson_({ ok: false, error: 'unauthorized' });
    var p = JSON.parse(e.postData.contents || '{}');
    var result;
    switch (p.action) {
      case 'reply':    result = gbpPostReply_(p.reviewName, p.comment); break;
      case 'skip':     result = gbpSkipReview_(p.reviewName); break;
      case 'redraft':  result = gbpRedraft_(p.reviewName, p.note); break;
      case 'sync':     syncGoogleReviews(); result = { ok: true }; break;
      case 'photo':    result = gbpUploadPhoto_(p); break;
      case 'menuSync': result = syncGoogleMenuPrices(p.apply === true); break;
      case 'poolSuggest': result = gbpPoolSuggest_(p); break;
      case 'poolUpload':  result = gbpPoolUpload_(p); break;
      case 'poolHide':    result = gbpPoolHide_(p); break;
      case 'storyBrowse': result = gbpStoryBrowse_(p); break;
      case 'storyImage':  result = gbpStoryImage_(p); break;
      case 'storyTagQueue': result = gbpStoryTagQueue_(p); break;
      case 'storyTag':    result = gbpStoryTag_(p); break;
      case 'storyUse':    result = gbpStoryUse_(p); break;
      default:         result = { ok: false, error: 'unknown action ' + p.action };
    }
    return gbpJson_(result);
  } catch (err) {
    return gbpJson_({ ok: false, error: String((err && err.message) || err) });
  }
}

function gbpJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Triggers: reviews every 30 min, menu prices hourly. Safe to re-run.
function installGbpTriggers() {
  var want = { syncGoogleReviews: 30, syncGoogleMenuPricesTrigger: 60, gbpUnpackPool: 60, gbpPhotoNudge: 1440 };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (want[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncGoogleReviews').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('syncGoogleMenuPricesTrigger').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('gbpUnpackPool').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('gbpPhotoNudge').timeBased().everyDays(1).atHour(6).create();
  Logger.log('Installed: reviews every 30 min, menu prices + photo pool unpack hourly, photo nudge daily ~6am.');
}
