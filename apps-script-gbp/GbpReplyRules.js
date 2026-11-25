// ═══════════════════════════════════════════════════════════════════════════════
//  GbpReplyRules.gs — standing reply rules learned from Jono's redraft notes
//
//  Every redraft note is checked by Claude: a general preference ("don't say
//  awesome", "less formal") becomes a short standing rule that goes into every
//  future draft; a note that only fits that one review ("mention his dog") is
//  used once and not saved. Duplicates of an existing rule aren't saved twice.
//  Rules live in the 'google_reply_rules' block; TIGER OS lists them with a ×.
// ═══════════════════════════════════════════════════════════════════════════════

var GBP_MAX_RULES = 40;

function gbpReplyRules_() {
  var b = gbpReadOsBlock_('google_reply_rules') || {};
  return b.rules || [];
}

function gbpSaveReplyRules_(rules) {
  gbpWriteOsBlock_('google_reply_rules', { updated: new Date().toISOString(), rules: rules.slice(-GBP_MAX_RULES) });
}

// Text block appended to the drafting system prompt.
function gbpReplyRulesPrompt_() {
  var rules = gbpReplyRules_();
  if (!rules.length) return '';
  return '\n\nJono\'s standing preferences, learned from his redraft notes (follow these; they override the defaults above if they conflict):\n'
    + rules.map(function (r) { return '- ' + r.text; }).join('\n');
}

// Returns the saved rule text, or null if the note was one-off / a duplicate.
function gbpLearnNote_(note, review) {
  note = String(note || '').trim();
  if (!note) return null;
  var key = gbpProp_('ANTHROPIC_API_KEY');
  var rules = gbpReplyRules_();
  var prompt = [
    'Jono owns G\'Day Tiger, a café. When redrafting a reply to a Google review, he gave this note:',
    '"' + note + '"',
    '',
    'The review was (' + (review.stars || '?') + ' stars): ' + (review.comment ? '"' + String(review.comment).slice(0, 400) + '"' : '(stars only)'),
    '',
    'Existing standing rules:',
    rules.length ? rules.map(function (r) { return '- ' + r.text; }).join('\n') : '(none)',
    '',
    'Decide: does the note express a GENERAL preference for how all future review replies should be written (tone, words to use or avoid, names, emoji, length, sign-offs, what to mention)?',
    '- If yes, and it is not already covered by an existing rule, rewrite it as ONE short standing rule (max 20 words, imperative, Australian English).',
    '- If it only makes sense for this particular review, or is already covered, answer SKIP.',
    'Reply with JSON only: {"rule": "<rule text>"} or {"rule": null}'
  ].join('\n');
  try {
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: GBP_DRAFT_MODEL, max_tokens: 150, messages: [{ role: 'user', content: prompt }] })
    });
    if (res.getResponseCode() !== 200) return null;
    var text = (JSON.parse(res.getContentText()).content || []).map(function (c) { return c.text || ''; }).join('');
    var m = text.match(/\{[\s\S]*\}/);
    var out = JSON.parse(m ? m[0] : '{}');
    var rule = out.rule ? String(out.rule).trim() : '';
    if (!rule || /^skip$/i.test(rule)) return null;
    rules.push({ id: Utilities.getUuid().slice(0, 8), text: rule.slice(0, 200), note: note.slice(0, 200), at: new Date().toISOString() });
    gbpSaveReplyRules_(rules);
    return rule;
  } catch (e) {
    Logger.log('learn note: ' + e);
    return null;
  }
}

function gbpDeleteReplyRule_(id) {
  var rules = gbpReplyRules_().filter(function (r) { return r.id !== id; });
  gbpSaveReplyRules_(rules);
  return { ok: true };
}

// ─── Learning from Jono's real replies ────────────────────────────────────────
// 1. Every draft gets his 25 most recent replies on Google as style examples
//    (collected by gbpExactRating_ on each sync — includes replies posted outside
//    TIGER OS).
// 2. When he edits a draft before posting, Claude compares draft vs final and
//    saves a standing rule if the edit shows a general preference.

var GBP_EXAMPLE_COUNT = 25;

function gbpReplyExamples_() {
  var cached = CacheService.getScriptCache().get('gbp_examples');
  if (cached) { try { return JSON.parse(cached); } catch (e) { /* fall through */ } }
  var b = gbpReadOsBlock_('google_reviews') || {};
  return b.examples || [];
}

function gbpReplyExamplesPrompt_() {
  var ex = gbpReplyExamples_();
  if (!ex.length) return '';
  return '\n\nJono\'s ' + ex.length + ' most recent real replies (newest first). Match his voice, length, warmth, nicknames and emoji habits — don\'t copy them word for word:\n'
    + ex.map(function (x) {
      return '- [' + x.s + '★] Review: ' + (x.c ? '"' + x.c + '"' : '(stars only)') + '\n  Jono: "' + x.r + '"';
    }).join('\n');
}

function gbpNormText_(t) {
  return String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Returns the saved rule text, or null if the edit was one-off / already covered.
function gbpLearnEdit_(draft, finalText, review) {
  var key = gbpProp_('ANTHROPIC_API_KEY');
  var rules = gbpReplyRules_();
  var prompt = [
    'Jono owns G\'Day Tiger, a café. Claude drafted a reply to a Google review and Jono edited it before posting.',
    '',
    'Review (' + (review.stars || '?') + ' stars): ' + (review.comment ? '"' + String(review.comment).slice(0, 400) + '"' : '(stars only)'),
    'Draft: "' + String(draft).slice(0, 600) + '"',
    'What Jono posted: "' + String(finalText).slice(0, 600) + '"',
    '',
    'Existing standing rules:',
    rules.length ? rules.map(function (r) { return '- ' + r.text; }).join('\n') : '(none)',
    '',
    'Does the edit show a GENERAL preference for how all future replies should be written (tone, words he adds or removes, nicknames, emoji, length, sign-offs)?',
    '- If yes, and it is not already covered by an existing rule, write ONE short standing rule (max 20 words, imperative, Australian English).',
    '- If the edit only fits this particular review (a personal detail, a fact about this visit), or is just a small wording tweak, answer null.',
    'Reply with JSON only: {"rule": "<rule text>"} or {"rule": null}'
  ].join('\n');
  try {
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: GBP_DRAFT_MODEL, max_tokens: 150, messages: [{ role: 'user', content: prompt }] })
    });
    if (res.getResponseCode() !== 200) return null;
    var text = (JSON.parse(res.getContentText()).content || []).map(function (c) { return c.text || ''; }).join('');
    var m = text.match(/\{[\s\S]*\}/);
    var out = JSON.parse(m ? m[0] : '{}');
    var rule = out.rule ? String(out.rule).trim() : '';
    if (!rule || /^(skip|null)$/i.test(rule)) return null;
    rules.push({ id: Utilities.getUuid().slice(0, 8), text: rule.slice(0, 200), note: 'Learned from an edited reply', at: new Date().toISOString() });
    gbpSaveReplyRules_(rules);
    return rule;
  } catch (e) {
    Logger.log('learn edit: ' + e);
    return null;
  }
}
