// ═══════════════════════════════════════════════════════════════════════════════
//  GbpStoryPhotos.gs — photo library for the TIGER OS Story Maker
//
//  Same Drive pool as the Google photo picker (GBP_POOL_FOLDER_ID, Paul's
//  gallery), but browsable: every photo, including ones already posted to
//  Google (stories don't care), minus anything hidden with × in the Google tile.
//
//    storyBrowse   { set?, cat?, page?, pageSize?, random? } → { ok, sets, photos:[{id,name,set,tag,thumb}], page, pages, total, untagged, auto, cats }
//    storyImage    { id, size? }                → { ok, id, dataUri }   (~1920px JPEG for the 1080×1920 canvas)
//    storyTagQueue { count?, size?, exclude? }  → { ok, photos:[{id,name,set,thumb}], remaining, auto }  — untagged photos
//    storyTag      { tags: {id: CATEGORY} }     → { ok, saved, remaining, auto }
//
//  Categories are Google's photo categories, stored per photo in the `story_photo_tags`
//  block on the OS page. Jono tags the backlog by hand in TIGER OS; once nothing is
//  left untagged `auto` flips on and TIGER OS has Claude tag new arrivals.
// ═══════════════════════════════════════════════════════════════════════════════

function gbpStoryBrowse_(p) {
  p = p || {};
  gbpUnpackPool();
  var s = gbpPoolState_();
  var hidden = {};
  s.hidden.forEach(function (id) { hidden[id] = true; });
  var all = gbpPoolPhotos_().filter(function (x) { return !hidden[x.id]; });

  var counts = {};
  all.forEach(function (x) { counts[x.set] = (counts[x.set] || 0) + 1; });
  var sets = Object.keys(counts).sort().map(function (n) { return { name: n, count: counts[n] }; });

  var ts = gbpStoryTagState_();
  var untagged = 0, cats = {};
  all.forEach(function (x) {
    x.tag = ts.tags[x.id] || null;
    if (x.tag) cats[x.tag] = (cats[x.tag] || 0) + 1; else untagged++;
  });

  var list = p.set ? all.filter(function (x) { return x.set === p.set; }) : all;
  if (p.cat) list = list.filter(function (x) { return x.tag === p.cat; });
  if (p.random) {                                // Story tab: a fresh random handful each time
    for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = list[i]; list[i] = list[j]; list[j] = t; }
  } else {
    list.sort(function (a, b) {
      if (a.set !== b.set) return a.set < b.set ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  }

  var size = Math.min(Math.max(Number(p.pageSize) || 24, 1), 36);
  var pages = Math.max(1, Math.ceil(list.length / size));
  var page = Math.min(Math.max(Math.floor(Number(p.page) || 0), 0), pages - 1);
  var slice = list.slice(page * size, (page + 1) * size);
  var thumbs = gbpStoryThumbs_(slice.map(function (x) { return x.id; }), 320);

  return {
    ok: true, sets: sets, total: list.length, page: page, pages: pages,
    untagged: untagged, auto: ts.auto, cats: cats,
    photos: slice.map(function (x, i) { return { id: x.id, name: x.name, set: x.set, tag: x.tag, thumb: thumbs[i] }; })
  };
}

function gbpStoryImage_(p) {
  if (!p || !p.id) return { ok: false, error: 'no photo id' };
  if (!gbpStoryInPool_(p.id)) return { ok: false, error: 'not a pool photo' };
  var px = Math.min(Math.max(Number(p.size) || 1920, 600), 2400);
  var uri = gbpStoryThumbs_([p.id], px)[0];
  if (!uri) {                                   // no Drive preview — send the original if it's small enough
    var blob = DriveApp.getFileById(p.id).getBlob();
    var bytes = blob.getBytes();
    if (bytes.length > 3000000) return { ok: false, error: 'photo too large and Drive has no preview yet' };
    uri = 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(bytes);
  }
  return { ok: true, id: p.id, dataUri: uri };
}

// Drive previews at `px` on the long edge, fetched in parallel. Returns data URIs (or null) in id order.
function gbpStoryThumbs_(ids, px) {
  if (!ids.length) return [];
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var metas = UrlFetchApp.fetchAll(ids.map(function (id) {
    return { url: 'https://www.googleapis.com/drive/v3/files/' + id + '?fields=thumbnailLink', headers: auth, muteHttpExceptions: true };
  }));
  var reqs = [], idx = [];
  metas.forEach(function (r, i) {
    var link = null;
    try { link = JSON.parse(r.getContentText()).thumbnailLink || null; } catch (e) { link = null; }
    if (!link) return;
    reqs.push({ url: /=s\d+$/.test(link) ? link.replace(/=s\d+$/, '=s' + px) : link + '=s' + px, headers: auth, muteHttpExceptions: true });
    idx.push(i);
  });
  var out = ids.map(function () { return null; });
  if (reqs.length) {
    UrlFetchApp.fetchAll(reqs).forEach(function (r, k) {
      if (r.getResponseCode() >= 400) return;
      var b = r.getBlob();
      out[idx[k]] = 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
    });
  }
  return out;
}

// Only hand out photos that live in a set folder inside the pool.
function gbpStoryInPool_(id) {
  try {
    var parents = DriveApp.getFileById(id).getParents();
    while (parents.hasNext()) {
      var grand = parents.next().getParents();
      while (grand.hasNext()) if (grand.next().getId() === GBP_POOL_FOLDER_ID) return true;
    }
  } catch (e) { /* not found / no access */ }
  return false;
}

// ─── Category tags ───────────────────────────────────────────────────────────
var STORY_CATS = ['FOOD_AND_DRINK', 'INTERIOR', 'EXTERIOR', 'TEAMS', 'AT_WORK', 'ADDITIONAL'];

function gbpStoryTagState_() {
  var s = gbpReadOsBlock_('story_photo_tags') || {};
  return { tags: s.tags || {}, auto: !!s.auto };
}

// Untagged, not-hidden pool photos in a stable order (set, then name).
function gbpStoryUntagged_(ts) {
  gbpUnpackPool();
  var hidden = {};
  gbpPoolState_().hidden.forEach(function (id) { hidden[id] = true; });
  return gbpPoolPhotos_()
    .filter(function (x) { return !hidden[x.id] && !ts.tags[x.id]; })
    .sort(function (a, b) {
      if (a.set !== b.set) return a.set < b.set ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
}

function gbpStoryTagQueue_(p) {
  p = p || {};
  var ts = gbpStoryTagState_();
  var skip = {};
  (p.exclude || []).forEach(function (id) { skip[id] = true; });
  var list = gbpStoryUntagged_(ts).filter(function (x) { return !skip[x.id]; });
  var n = Math.min(Math.max(Number(p.count) || 6, 1), 12);
  var px = Math.min(Math.max(Number(p.size) || 600, 200), 1000);
  var slice = list.slice(0, n);
  var thumbs = gbpStoryThumbs_(slice.map(function (x) { return x.id; }), px);
  return {
    ok: true, remaining: list.length, auto: ts.auto,
    photos: slice.map(function (x, i) { return { id: x.id, name: x.name, set: x.set, thumb: thumbs[i] }; })
  };
}

function gbpStoryTag_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);                         // tags arrive one tap at a time — don't lose any
  try {
    var ts = gbpStoryTagState_();
    var saved = 0;
    var tags = (p && p.tags) || {};
    Object.keys(tags).forEach(function (id) {
      if (STORY_CATS.indexOf(tags[id]) < 0 || !/^[\w-]{10,100}$/.test(id)) return;
      ts.tags[id] = tags[id];
      saved++;
    });
    var remaining = gbpStoryUntagged_(ts).length;
    if (!remaining) ts.auto = true;             // backlog done by hand → Claude takes new arrivals
    gbpWriteOsBlock_('story_photo_tags', { tags: ts.tags, auto: ts.auto, updated: new Date().toISOString() });
    return { ok: true, saved: saved, remaining: remaining, auto: ts.auto };
  } finally {
    lock.releaseLock();
  }
}
