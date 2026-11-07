// ═══════════════════════════════════════════════════════════════════════════════
//  GbpPhotoPool.gs — Paul's gallery → Google Business Profile photo picker
//
//  The pool is a Drive folder (GBP_POOL_FOLDER_ID). The daily gallery check drops
//  one zip per Pic-Time set into it; gbpUnpackPool() unzips each into a subfolder
//  named after the set and trashes the zip.
//
//  TIGER OS asks for 5 random photos that haven't been posted or hidden yet
//  (action 'poolSuggest'), and posts the ones Jono ticks ('poolUpload').
//  Posted + hidden photo IDs live in the `google_photo_pool` block on the OS page.
//
//  gbpPhotoNudge() runs each morning: if no photo has gone onto the profile for
//  7+ days, it adds "[STICKY] Add photos to Google" to today's To Do (ADMIN).
//  The task links to TIGER OS ?open=google and is removed once a photo goes up.
// ═══════════════════════════════════════════════════════════════════════════════

var GBP_POOL_FOLDER_ID = '1CW2Vx-JY-PT9QE967icU23iGIjMCFidY';
var GBP_NUDGE_TEXT = 'Add photos to Google';
var GBP_NUDGE_DAYS = 7;
var GBP_DAY_PAGES = {
  0: '3403c99c0e8581fa80d7ef629e63aa9c', 1: '3403c99c0e858139bd34e9f3873dc7ef',
  2: '3403c99c0e858133bb31f63559b18716', 3: '3403c99c0e85814fab17e09b32693999',
  4: '3403c99c0e8581a39fd1e3587887a1e0', 5: '3403c99c0e858192bfa7d94c8189fe3c',
  6: '3403c99c0e8581b3a01dc82031df8f09'
};

function gbpPoolState_() {
  var s = gbpReadOsBlock_('google_photo_pool') || {};
  return {
    used: s.used || [],                 // posted from the pool
    hidden: s.hidden || [],             // "don't show me this one"
    lastUploadAt: s.lastUploadAt || null,
    nudgeBlockId: s.nudgeBlockId || null,
    nudgeAt: s.nudgeAt || null,
    poolSize: s.poolSize || 0,
    sets: s.sets || [],
    updated: s.updated || null
  };
}

function gbpSavePoolState_(s) {
  s.updated = new Date().toISOString();
  gbpWriteOsBlock_('google_photo_pool', s);
}

// ─── Unzip any set zips sitting in the pool ──────────────────────────────────
function gbpUnpackPool() {
  var root = DriveApp.getFolderById(GBP_POOL_FOLDER_ID);
  var zips = root.getFiles(), done = [];
  while (zips.hasNext()) {
    var f = zips.next();
    if (!/\.zip$/i.test(f.getName())) continue;
    var setName = f.getName().replace(/\.zip$/i, '');
    var dest = gbpChildFolder_(root, setName);
    var have = {};
    var it = dest.getFiles();
    while (it.hasNext()) have[it.next().getName()] = true;
    var blob = f.getBlob().setContentType('application/zip');
    Utilities.unzip(blob).forEach(function (b) {
      var name = String(b.getName()).split('/').pop();
      if (!name || name.charAt(0) === '.' || !/\.(jpe?g|png)$/i.test(name) || have[name]) return;
      dest.createFile(b.setName(name));
    });
    f.setTrashed(true);
    done.push(setName);
  }
  if (done.length) Logger.log('Unpacked: ' + done.join(', '));
  return done;
}

function gbpChildFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// Every photo in the pool: [{ id, name, set }]
function gbpPoolPhotos_() {
  var root = DriveApp.getFolderById(GBP_POOL_FOLDER_ID), out = [];
  var folders = root.getFolders();
  while (folders.hasNext()) {
    var fo = folders.next(), files = fo.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (/^image\//.test(f.getMimeType())) out.push({ id: f.getId(), name: f.getName(), set: fo.getName() });
    }
  }
  return out;
}

// ─── 5 random photos not yet posted or hidden ────────────────────────────────
function gbpPoolSuggest_(p) {
  gbpUnpackPool();
  var s = gbpPoolState_();
  var skip = {};
  s.used.concat(s.hidden).concat((p && p.exclude) || []).forEach(function (id) { skip[id] = true; });
  var all = gbpPoolPhotos_();
  var fresh = all.filter(function (x) { return !skip[x.id]; });
  for (var i = fresh.length - 1; i > 0; i--) {            // shuffle
    var j = Math.floor(Math.random() * (i + 1)), t = fresh[i]; fresh[i] = fresh[j]; fresh[j] = t;
  }
  // Story tags (GbpStoryPhotos.js) ride along so TIGER OS can post with the matching Google category.
  var tags = typeof gbpStoryTagState_ === 'function' ? gbpStoryTagState_().tags : {};
  var pick = fresh.slice(0, (p && p.count) || 5).map(function (x) {
    x.thumb = gbpThumb_(x.id);
    x.tag = tags[x.id] || null;
    return x;
  });
  var sets = {}; all.forEach(function (x) { sets[x.set] = true; });
  s.poolSize = all.length; s.sets = Object.keys(sets).sort();
  gbpSavePoolState_(s);
  return {
    ok: true, photos: pick, remaining: fresh.length, poolSize: all.length,
    lastUploadAt: gbpLastProfilePhotoAt_(s)
  };
}

// Small JPEG preview as a data URI (Drive thumbnail, ~600px).
function gbpThumb_(id) {
  try {
    var tok = ScriptApp.getOAuthToken();
    var meta = JSON.parse(UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '?fields=thumbnailLink', {
      headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true
    }).getContentText());
    if (!meta.thumbnailLink) return null;
    var res = UrlFetchApp.fetch(meta.thumbnailLink.replace(/=s\d+$/, '=s600'), { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
    if (res.getResponseCode() >= 400) return null;
    var blob = res.getBlob();
    return 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    return null;
  }
}

// ─── Post the ticked photos ──────────────────────────────────────────────────
function gbpPoolUpload_(p) {
  var ids = (p && p.ids) || [];
  if (!ids.length) return { ok: false, error: 'no photos chosen' };
  var s = gbpPoolState_(), posted = [], failed = [];
  ids.forEach(function (id) {
    try {
      var blob = DriveApp.getFileById(id).getBlob();
      gbpUploadPhoto_({
        base64: Utilities.base64Encode(blob.getBytes()),
        mimeType: blob.getContentType() || 'image/jpeg',
        category: (p.categories && p.categories[id]) || p.category || 'FOOD_AND_DRINK'
      });
      posted.push(id);
      if (s.used.indexOf(id) < 0) s.used.push(id);
    } catch (e) {
      failed.push(String((e && e.message) || e));
    }
  });
  if (posted.length) {
    s.lastUploadAt = new Date().toISOString();
    gbpClearNudge_(s);
  }
  gbpSavePoolState_(s);
  return { ok: failed.length === 0, posted: posted.length, error: failed.length ? failed[0] : null };
}

function gbpPoolHide_(p) {
  var s = gbpPoolState_();
  ((p && p.ids) || []).forEach(function (id) { if (s.hidden.indexOf(id) < 0) s.hidden.push(id); });
  gbpSavePoolState_(s);
  return { ok: true };
}

// ─── Weekly nudge ─────────────────────────────────────────────────────────────
// Newest photo on the profile, from Google (covers photos added outside TIGER OS)
// and from our own record, whichever is later.
function gbpLastProfilePhotoAt_(s) {
  var newest = s && s.lastUploadAt ? s.lastUploadAt : null;
  try {
    var r = gbpFetch_(GBP_V4 + gbpLocation_() + '/media?pageSize=100');
    (r.mediaItems || []).forEach(function (m) {
      if (m.createTime && (!newest || m.createTime > newest)) newest = m.createTime;
    });
  } catch (e) { /* fall back to our own record */ }
  return newest;
}

function gbpPhotoNudge() {
  var s = gbpPoolState_();
  var last = gbpLastProfilePhotoAt_(s);
  var days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : 999;

  // A photo went up since the nudge — take the task away.
  if (s.nudgeBlockId && last && s.nudgeAt && last > s.nudgeAt) {
    gbpClearNudge_(s);
    gbpSavePoolState_(s);
    return;
  }
  if (days < GBP_NUDGE_DAYS) return;
  if (s.nudgeBlockId && gbpNotionBlockAlive_(s.nudgeBlockId)) return;   // one at a time

  var page = GBP_DAY_PAGES[Number(Utilities.formatDate(new Date(), 'Australia/Melbourne', 'u')) % 7];
  var id = gbpAddTaskUnderHeading_(page, 'ADMIN', '[STICKY] ' + GBP_NUDGE_TEXT);
  if (id) { s.nudgeBlockId = id; s.nudgeAt = new Date().toISOString(); gbpSavePoolState_(s); }
}

function gbpClearNudge_(s) {
  if (!s.nudgeBlockId) return;
  try { gbpNotion_('blocks/' + s.nudgeBlockId, 'delete'); } catch (e) { /* already gone */ }
  s.nudgeBlockId = null; s.nudgeAt = null;
}

function gbpNotionBlockAlive_(id) {
  try { var b = gbpNotion_('blocks/' + id, 'get'); return !(b.archived || b.in_trash); } catch (e) { return false; }
}

function gbpNotion_(path, method, body) {
  var opts = {
    method: method || 'get', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + gbpProp_('NOTION_API_KEY'), 'Notion-Version': '2022-06-28' }
  };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch('https://api.notion.com/v1/' + path, opts);
  if (res.getResponseCode() >= 400) throw new Error('Notion ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText() || '{}');
}

// Same placement as /api/add-task: after the last task under the category heading.
function gbpAddTaskUnderHeading_(pageId, heading, text) {
  var kids = gbpNotion_('blocks/' + pageId + '/children?page_size=100').results || [];
  var isHead = function (b) { return /^heading_/.test(b.type); };
  var plain = function (b) { return ((b[b.type] && b[b.type].rich_text) || []).map(function (t) { return t.plain_text; }).join('').trim(); };
  var block = { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] } };
  var hi = -1;
  for (var i = 0; i < kids.length; i++) if (isHead(kids[i]) && plain(kids[i]).toUpperCase() === heading) { hi = i; break; }
  var body = { children: [block] };
  if (hi >= 0) {
    var after = kids[hi].id;
    for (var k = hi + 1; k < kids.length && !isHead(kids[k]); k++) after = kids[k].id;
    body.after = after;
  }
  var r = gbpNotion_('blocks/' + pageId + '/children', 'patch', body);
  return r.results && r.results[0] ? r.results[0].id : null;
}
