// ═══════════════════════════════════════════════════════════════════════════════
//  GbpStoryPhotos.gs — photo library for the TIGER OS Story Maker
//
//  Same Drive pool as the Google photo picker (GBP_POOL_FOLDER_ID, Paul's
//  gallery), but browsable: every photo, including ones already posted to
//  Google (stories don't care), minus anything hidden with × in the Google tile.
//
//    storyBrowse { set?, page?, pageSize? } → { ok, sets:[{name,count}], photos:[{id,name,set,thumb}], page, pages, total }
//    storyImage  { id, size? }              → { ok, id, dataUri }   (~1920px JPEG for the 1080×1920 canvas)
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

  var list = p.set ? all.filter(function (x) { return x.set === p.set; }) : all;
  list.sort(function (a, b) {
    if (a.set !== b.set) return a.set < b.set ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  var size = Math.min(Math.max(Number(p.pageSize) || 24, 1), 36);
  var pages = Math.max(1, Math.ceil(list.length / size));
  var page = Math.min(Math.max(Math.floor(Number(p.page) || 0), 0), pages - 1);
  var slice = list.slice(page * size, (page + 1) * size);
  var thumbs = gbpStoryThumbs_(slice.map(function (x) { return x.id; }), 320);

  return {
    ok: true, sets: sets, total: list.length, page: page, pages: pages,
    photos: slice.map(function (x, i) { return { id: x.id, name: x.name, set: x.set, thumb: thumbs[i] }; })
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
