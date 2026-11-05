// ═══════════════════════════════════════════════════════════════════════════════
//  GbpReviews.gs — new Google reviews → Claude-drafted replies → TIGER OS
//
//  syncGoogleReviews() (every 30 min):
//    pulls the newest 50 reviews, and for each one with no owner reply that came
//    in after REVIEWS_SINCE, drafts a reply in Jono's voice and stores it in the
//    `google_reviews` JSON block on the Notion OS page. TIGER OS shows them with
//    Post / Redraft / Skip. NOTHING is posted to Google without a tap in TIGER OS.
//
//  REVIEWS_SINCE (Script Property, ISO date) is set to "now" on the first run so
//  the old backlog isn't drafted. Set it earlier by hand to pull older reviews in.
// ═══════════════════════════════════════════════════════════════════════════════

var GBP_DRAFT_MODEL = 'claude-sonnet-5';
var GBP_MAX_PENDING = 30;

// Jono's reply voice + terminology log. Edit here — every new draft follows it.
var GBP_VOICE_RULES = [
  'You write owner replies to Google reviews for G\'Day Tiger, a cafe in Cowes, Phillip Island. You are Jono, the owner.',
  'Australian English. Sound like a real person at the counter: natural, warm, short (1-3 sentences). Vary wording so replies never read like a template.',
  'No sign-off and no name at the end.',
  'Emoji: only about half of replies get one, never more than two. Only use these: ☺️ 😎 👌🏻 🤙🏼 🤣 🔥 ☕ 🍔',
  'Terminology: the chicken burger / chicken schnitzel sandwich is always called the "Chicken Schnitta". A staff member\'s name is spelled "Surina".',
  'Use the reviewer\'s first name only if it looks like a real first name.',
  'If the review has no text, write a short simple thank-you.',
  '1-3 star reviews: thank them, acknowledge the specific issue without arguing or making excuses, and end by inviting them to reach out at jono@gdaytiger.com.au. Never promise changes or facts you have not been told.',
  'Only put jono@gdaytiger.com.au in replies to negative or mixed reviews.',
  'If the reviewer praises a specific food or drink that is NOT on the regular menu list provided (e.g. a special), add a light line such as maybe it needs to become a permanent fixture, or to keep an eye out for it in future.',
  'Never mention AI, never invent details about the cafe.'
].join('\n');

var GBP_STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

function syncGoogleReviews() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var since = props.getProperty('REVIEWS_SINCE');
    if (!since) { since = new Date().toISOString(); props.setProperty('REVIEWS_SINCE', since); }

    var loc = gbpLocation_();
    var data = gbpFetch_(GBP_V4 + loc + '/reviews?pageSize=50&orderBy=' + encodeURIComponent('updateTime desc'));
    var state = gbpReviewState_();
    var skipped = {}; state.skipped.forEach(function (id) { skipped[id] = true; });
    var pendingById = {}; state.pending.forEach(function (p) { pendingById[p.name] = p; });
    var menu = null; // loaded lazily — only needed when there's something to draft

    var nextPending = [];
    (data.reviews || []).forEach(function (r) {
      if (r.reviewReply) return;                      // already answered (here or in Google)
      if (skipped[r.name]) return;
      if (r.createTime < since) return;               // old backlog — leave alone
      var existing = pendingById[r.name];
      if (existing && existing.updateTime === r.updateTime) { nextPending.push(existing); return; }
      if (!menu) menu = gbpMenuNames_();
      var draft = gbpDraftReply_(r, menu, null);
      nextPending.push({
        name: r.name,
        reviewer: (r.reviewer && r.reviewer.displayName) || 'Google user',
        stars: GBP_STARS[r.starRating] || 0,
        comment: r.comment || '',
        createTime: r.createTime,
        updateTime: r.updateTime,
        draft: draft.reply,
        offMenu: draft.offMenu
      });
    });

    state.pending = nextPending.slice(0, GBP_MAX_PENDING);
    state.average = data.averageRating || state.average;
    state.total = data.totalReviewCount || state.total;
    state.updated = new Date().toISOString();
    state.error = null;
    gbpWriteOsBlock_('google_reviews', state);
  } catch (err) {
    var s = gbpReviewState_();
    s.error = String((err && err.message) || err);
    s.updated = new Date().toISOString();
    gbpWriteOsBlock_('google_reviews', s);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function gbpReviewState_() {
  var s = gbpReadOsBlock_('google_reviews') || {};
  return {
    updated: s.updated || null,
    average: s.average || null,
    total: s.total || null,
    pending: s.pending || [],
    skipped: (s.skipped || []).slice(-300),
    replied: (s.replied || []).slice(-20),
    error: s.error || null
  };
}

// Regular-menu item names, for spotting praised specials. Prefers the menu
// published on Google (what customers see); falls back to the Square catalogue.
function gbpMenuNames_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('gbp_menu_names');
  if (hit) return JSON.parse(hit);
  var names = [];
  try {
    var fm = gbpFetch_(GBP_V4 + gbpLocation_() + '/foodMenus');
    (fm.menus || []).forEach(function (m) {
      (m.sections || []).forEach(function (s) {
        (s.items || []).forEach(function (it) { names.push(gbpLabel_(it.labels)); });
      });
    });
  } catch (e) { Logger.log('foodMenus read failed, using Square: ' + e.message); }
  if (!names.length) names = gbpSquareItems_().map(function (i) { return i.name; });
  names = names.filter(String);
  cache.put('gbp_menu_names', JSON.stringify(names), 21600); // 6h
  return names;
}

function gbpLabel_(labels) {
  if (!labels) return '';
  if (Array.isArray(labels)) return (labels[0] && labels[0].displayName) || '';
  return labels.displayName || '';
}

// Returns { reply, offMenu: [items praised that aren't on the menu] }
function gbpDraftReply_(review, menuNames, note) {
  var key = gbpProp_('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY not set.');
  var stars = GBP_STARS[review.starRating] || 0;
  var user = [
    'Regular menu items:\n' + menuNames.join(', '),
    '',
    'Review (' + stars + ' stars) from ' + ((review.reviewer && review.reviewer.displayName) || 'Google user') + ':',
    review.comment ? review.comment : '(no text — stars only)',
    note ? '\nJono\'s note for this reply: ' + note : '',
    '',
    'Reply with JSON only: {"reply": "<the reply>", "offMenu": ["<praised items not on the regular menu>"]}'
  ].join('\n');

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: GBP_DRAFT_MODEL, max_tokens: 400, system: GBP_VOICE_RULES, messages: [{ role: 'user', content: user }] }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Anthropic ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  var text = (JSON.parse(res.getContentText()).content || []).map(function (c) { return c.text || ''; }).join('');
  var m = text.match(/\{[\s\S]*\}/);
  try {
    var out = JSON.parse(m ? m[0] : text);
    return { reply: String(out.reply || '').trim(), offMenu: out.offMenu || [] };
  } catch (e) {
    return { reply: text.trim(), offMenu: [] };
  }
}

// ─── Web app actions ──────────────────────────────────────────────────────────
function gbpPostReply_(reviewName, comment) {
  if (!reviewName || !comment) return { ok: false, error: 'reviewName and comment required' };
  if (reviewName.indexOf(gbpLocation_() + '/reviews/') !== 0) return { ok: false, error: 'review not on this location' };
  var res = gbpFetch_(GBP_V4 + reviewName + '/reply', 'put', { comment: String(comment).slice(0, 4000) });
  var s = gbpReviewState_();
  var p = s.pending.filter(function (x) { return x.name === reviewName; })[0];
  s.pending = s.pending.filter(function (x) { return x.name !== reviewName; });
  s.replied.push({ name: reviewName, reviewer: p ? p.reviewer : '', stars: p ? p.stars : null, reply: comment, at: new Date().toISOString() });
  gbpWriteOsBlock_('google_reviews', s);
  return { ok: true, reply: res };
}

function gbpSkipReview_(reviewName) {
  var s = gbpReviewState_();
  s.pending = s.pending.filter(function (x) { return x.name !== reviewName; });
  if (s.skipped.indexOf(reviewName) === -1) s.skipped.push(reviewName);
  gbpWriteOsBlock_('google_reviews', s);
  return { ok: true };
}

function gbpRedraft_(reviewName, note) {
  var s = gbpReviewState_();
  var p = s.pending.filter(function (x) { return x.name === reviewName; })[0];
  if (!p) return { ok: false, error: 'review not pending' };
  var stars = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'][p.stars] || 'FIVE';
  var d = gbpDraftReply_({ starRating: stars, comment: p.comment, reviewer: { displayName: p.reviewer } }, gbpMenuNames_(), note || null);
  p.draft = d.reply; p.offMenu = d.offMenu;
  gbpWriteOsBlock_('google_reviews', s);
  return { ok: true, draft: d.reply, offMenu: d.offMenu };
}
