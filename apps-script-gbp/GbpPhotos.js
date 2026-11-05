// ═══════════════════════════════════════════════════════════════════════════════
//  GbpPhotos.gs — upload a photo from TIGER OS to the Google Business Profile
//
//  Payload from /api/google-photo: { category, mimeType, base64, description? }
//  TIGER OS shrinks the photo to ≤2000px JPEG before sending, so it stays well
//  under Vercel's request limit.
// ═══════════════════════════════════════════════════════════════════════════════

var GBP_PHOTO_CATEGORIES = ['FOOD_AND_DRINK', 'INTERIOR', 'EXTERIOR', 'TEAMS', 'AT_WORK', 'ADDITIONAL'];

function gbpUploadPhoto_(p) {
  if (!p || !p.base64) return { ok: false, error: 'no image' };
  var category = GBP_PHOTO_CATEGORIES.indexOf(p.category) >= 0 ? p.category : 'ADDITIONAL';
  var loc = gbpLocation_();

  // 1. Reserve an upload slot
  var ref = gbpFetch_(GBP_V4 + loc + '/media:startUpload', 'post', {});
  // 2. Send the bytes
  var bytes = Utilities.base64Decode(p.base64);
  var up = UrlFetchApp.fetch('https://mybusiness.googleapis.com/upload/v1/media/' + ref.resourceName + '?upload_type=media', {
    method: 'post',
    contentType: p.mimeType || 'image/jpeg',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: bytes,
    muteHttpExceptions: true
  });
  if (up.getResponseCode() >= 400) throw new Error('Photo upload ' + up.getResponseCode() + ': ' + up.getContentText().slice(0, 300));
  // 3. Attach it to the profile
  var body = { mediaFormat: 'PHOTO', locationAssociation: { category: category }, dataRef: { resourceName: ref.resourceName } };
  if (p.description) body.description = String(p.description).slice(0, 300);
  var media = gbpFetch_(GBP_V4 + loc + '/media', 'post', body);
  return { ok: true, name: media.name, googleUrl: media.googleUrl || null, category: category };
}
