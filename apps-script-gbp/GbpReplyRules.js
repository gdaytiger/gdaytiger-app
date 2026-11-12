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
