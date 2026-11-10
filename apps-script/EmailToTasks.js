// ─────────────────────────────────────────────────────────────────────────────
// EmailToTasks.js — sweeps the G'Day Tiger inbox and adds real actions to the
// TigerOS Daily To Do.
//
// How it works
//   1. Every 30 min (6am–9pm) pulls inbox messages from the last 2 days,
//      skipping promos/social/updates, your own sent mail, and suppliers the
//      invoice scanner already handles.
//   2. POSTs them to TigerOS /api/email-scan, which asks Claude which emails
//      need you to DO something and writes those through /api/add-task
//      (same categories, supplier links and context panel as a manual task).
//   3. Threads that produced a task get the Gmail label "TigerOS" so you can
//      see what's been picked up. TigerOS remembers every message it has seen,
//      so nothing is double-added.
//
// Needs Script Property CRON_SECRET (already set for the Morning Brief push).
//
// First run:  previewEmailTasks()       → logs what it WOULD add, writes nothing
// Go live:    installEmailTaskTrigger() → every 30 min
// Stop:       removeEmailTaskTrigger()
// ─────────────────────────────────────────────────────────────────────────────

var ET_URL = 'https://gdaytiger-app.vercel.app/api/email-scan';
var ET_LABEL = 'TigerOS';
var ET_MAX = 25;          // messages per sweep
var ET_START_HOUR = 6;    // don't sweep overnight
var ET_END_HOUR = 21;

// Senders the invoice scanner already handles, plus noise that never needs action.
var ET_SKIP_FROM = [
  'pfdfoods.com.au', 'abicorsouthern.com.au', 'unleashedsoftware.com',
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'notifications@',
  'mailer-daemon', 'calendar-notification', 'squareup.com', 'deputy.com',
];

var ET_QUERY = 'in:inbox newer_than:2d -category:promotions -category:social -category:updates -category:forums -from:me';

function sweepEmailTasks() {
  var h = Number(Utilities.formatDate(new Date(), 'Australia/Melbourne', 'H'));
  if (h < ET_START_HOUR || h >= ET_END_HOUR) return;
  etRun_(false);
}

function previewEmailTasks() {
  etRun_(true);
}

function etRun_(dryRun) {
  var secret = PropertiesService.getScriptProperties().getProperty('CRON_SECRET');
  if (!secret) { Logger.log('ET: CRON_SECRET not set — aborting.'); return; }

  var emails = etCollect_();
  if (!emails.length) { Logger.log('ET: no candidate emails.'); return; }

  var res = UrlFetchApp.fetch(ET_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify({ emails: emails, dryRun: dryRun }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code !== 200) { Logger.log('ET: ' + code + ' ' + text.slice(0, 500)); return; }

  var out = JSON.parse(text);
  if (dryRun) {
    Logger.log('ET DRY RUN — scanned ' + (out.scanned || 0) + ', would add ' + ((out.tasks || []).length) + ':');
    (out.tasks || []).forEach(function (t) {
      Logger.log('• [' + t.date + '] ' + (t.category || '?') + ' — ' + t.text + '\n    ' + t.context.split('\n')[0]);
    });
    return;
  }

  var label = GmailApp.getUserLabelByName(ET_LABEL) || GmailApp.createLabel(ET_LABEL);
  (out.added || []).forEach(function (a) {
    try { GmailApp.getThreadById(a.threadId).addLabel(label); } catch (e) { /* thread gone */ }
    Logger.log('ET added: [' + a.date + '] ' + a.text);
  });
  (out.errors || []).forEach(function (e) { Logger.log('ET error: ' + e); });
  Logger.log('ET: scanned ' + (out.scanned || 0) + ', added ' + ((out.added || []).length));
}

function etCollect_() {
  var me = Session.getActiveUser().getEmail().toLowerCase();
  var threads = GmailApp.search(ET_QUERY, 0, 40);
  var out = [];
  for (var i = 0; i < threads.length && out.length < ET_MAX; i++) {
    var msgs = threads[i].getMessages();
    var m = msgs[msgs.length - 1];            // latest message in the thread
    var from = m.getFrom();
    var fl = from.toLowerCase();
    if (fl.indexOf(me) !== -1 || fl.indexOf('gdaytiger.com.au') !== -1) continue;
    if (ET_SKIP_FROM.some(function (s) { return fl.indexOf(s) !== -1; })) continue;
    var body = (m.getPlainBody() || '')
      .replace(/\r/g, '')
      .split(/\n(?:On .+wrote:|From: .+\nSent: )/)[0]  // drop quoted history
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, 2500);
    out.push({
      id: m.getId(),
      threadId: threads[i].getId(),
      from: from,
      subject: m.getSubject() || '(no subject)',
      date: Utilities.formatDate(m.getDate(), 'Australia/Melbourne', 'yyyy-MM-dd HH:mm'),
      body: body,
    });
  }
  return out;
}

function installEmailTaskTrigger() {
  removeEmailTaskTrigger();
  ScriptApp.newTrigger('sweepEmailTasks').timeBased().everyMinutes(30).create();
  Logger.log('ET: trigger installed — every 30 min, ' + ET_START_HOUR + 'am–' + (ET_END_HOUR - 12) + 'pm.');
}

function removeEmailTaskTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sweepEmailTasks') ScriptApp.deleteTrigger(t);
  });
}
