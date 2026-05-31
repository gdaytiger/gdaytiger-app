// BackupCostings.gs
// Daily XLSX backups of the FOOD COSTINGS and COFFEE COSTINGS sheets to a
// dedicated Drive folder. Runs before the invoice scanners (~2am) so each
// day's snapshot captures the state BEFORE any automated writes touch the
// sheet. Prunes anything older than RETAIN_DAYS to keep the folder tidy.
//
// Why XLSX, not native Google Sheets copies?
// A native copy is also a live Sheets doc — if Google's Sheets backend ever
// has another file-access bug like 2026-05-27, the copy could be just as
// unreachable as the original. XLSX is an inert binary blob in Drive,
// downloadable and openable in Excel as a fallback.
//
// Setup (one-time):
//   1. clasp push
//   2. In Apps Script editor: run backupCostingsSmokeTest() once. Authorise
//      Drive access if prompted. Confirm files appear in the backup folder.
//   3. Run createBackupTrigger() once to install the daily 2am trigger.
//
// Monitor:
//   The function writes a `backup_health` JSON block to the Notion OS page
//   with the last-run timestamp and per-file status. The daily healthcheck
//   reads this — stale or missing = flagged.

const BC_FOOD_SHEET_ID    = '1nZvWNFaQTrJAt-ilYihZjYZKBzHd6x3qIrjFhdNQqAU';
const BC_COFFEE_SHEET_ID  = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI';
const BC_BACKUP_FOLDER    = "G'Day Tiger Backups";
const BC_RETAIN_DAYS      = 14;
const BC_NOTION_API_KEY   = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
const BC_NOTION_PAGE_ID   = '3403c99c0e858113a941c2118b3cdef9';

const BC_TARGETS = [
  { id: BC_FOOD_SHEET_ID,   prefix: 'FOOD_COSTINGS'   },
  { id: BC_COFFEE_SHEET_ID, prefix: 'COFFEE_COSTINGS' }
];

// ── PUBLIC ENTRY POINTS ───────────────────────────────────────────────────────

/**
 * Daily backup. Wire to a 2am time-based trigger via createBackupTrigger().
 */
function backupCostings() {
  const folder = bcGetOrCreateFolder_(BC_BACKUP_FOLDER);
  const datestamp = Utilities.formatDate(new Date(), 'Australia/Melbourne', 'yyyy-MM-dd');
  const results = [];

  BC_TARGETS.forEach(target => {
    const filename = target.prefix + '_' + datestamp + '.xlsx';
    try {
      const blob = bcExportSheetAsXlsx_(target.id, filename);
      const file = folder.createFile(blob);
      results.push({
        prefix: target.prefix,
        filename: filename,
        fileId: file.getId(),
        bytes: file.getSize(),
        ok: true
      });
      Logger.log('✓ Backed up ' + filename + ' (' + file.getSize() + ' bytes)');
    } catch (e) {
      results.push({
        prefix: target.prefix,
        filename: filename,
        ok: false,
        error: String(e && e.message ? e.message : e)
      });
      Logger.log('✗ FAILED ' + filename + ': ' + e);
    }
  });

  const pruned = bcPruneOldBackups_(folder, BC_RETAIN_DAYS);
  Logger.log('Pruned ' + pruned + ' file(s) older than ' + BC_RETAIN_DAYS + ' days');

  bcWriteHealthToNotion_(results, pruned);

  // Throw if any backup failed so the trigger log surfaces it loudly.
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    throw new Error('Backup failed for: ' + failed.map(f => f.prefix).join(', '));
  }
}

/**
 * Manual smoke test — runs the backup once, logs everything verbosely.
 * Use this to verify Drive auth + folder creation before installing the trigger.
 */
function backupCostingsSmokeTest() {
  Logger.log('=== Backup smoke test ===');
  Logger.log('Backup folder: ' + BC_BACKUP_FOLDER);
  Logger.log('Targets: ' + BC_TARGETS.map(t => t.prefix).join(', '));
  Logger.log('Retain days: ' + BC_RETAIN_DAYS);
  backupCostings();
  Logger.log('=== Smoke test complete ===');
}

/**
 * Install the daily 2am trigger. Idempotent — replaces any existing trigger
 * for backupCostings before adding a new one.
 */
function createBackupTrigger() {
  // Remove any existing trigger for this function
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'backupCostings')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('backupCostings')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .inTimezone('Australia/Melbourne')
    .create();

  Logger.log('✓ Daily backup trigger installed: backupCostings at 2am Melbourne');
}

// ── PRIVATE HELPERS ───────────────────────────────────────────────────────────

function bcGetOrCreateFolder_(name) {
  const it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  Logger.log('Creating new Drive folder: ' + name);
  return DriveApp.createFolder(name);
}

function bcExportSheetAsXlsx_(fileId, filename) {
  // Use the Drive export endpoint with the script's OAuth token.
  // This produces a real XLSX binary independently of the Sheets render layer,
  // which is why it survives the kind of backend bug that hit us on 2026-05-27.
  const url = 'https://www.googleapis.com/drive/v3/files/' + fileId +
              '/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('Export HTTP ' + code + ' for ' + fileId + ': ' +
                    response.getContentText().slice(0, 200));
  }

  return response.getBlob().setName(filename);
}

function bcPruneOldBackups_(folder, retainDays) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retainDays);
  let pruned = 0;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    // Only prune our own backup files (defensive — avoids nuking anything
    // a user might have manually dropped in the folder).
    const name = f.getName();
    const looksLikeOurs = BC_TARGETS.some(t => name.startsWith(t.prefix + '_')) &&
                          name.endsWith('.xlsx');
    if (!looksLikeOurs) continue;
    if (f.getDateCreated() < cutoff) {
      f.setTrashed(true);
      pruned++;
    }
  }
  return pruned;
}

function bcWriteHealthToNotion_(results, pruned) {
  if (!BC_NOTION_API_KEY) {
    Logger.log('NOTION_API_KEY not set — skipping health write');
    return;
  }

  const payload = {
    type: 'backup_health',
    updated: new Date().toISOString(),
    retainDays: BC_RETAIN_DAYS,
    pruned: pruned,
    backups: results
  };
  const blockText = JSON.stringify(payload);

  // Find the existing backup_health code block and update it, or append a new one.
  const childrenUrl = 'https://api.notion.com/v1/blocks/' + BC_NOTION_PAGE_ID + '/children?page_size=100';
  const headers = {
    Authorization: 'Bearer ' + BC_NOTION_API_KEY,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  // List children, look for an existing backup_health code block
  let existingId = null;
  let cursor = null;
  do {
    const url = cursor ? childrenUrl + '&start_cursor=' + cursor : childrenUrl;
    const resp = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      Logger.log('Notion list children failed: ' + resp.getContentText().slice(0, 200));
      return;
    }
    const data = JSON.parse(resp.getContentText());
    for (const block of data.results) {
      if (block.type === 'code') {
        const text = (block.code.rich_text || []).map(rt => rt.plain_text || '').join('');
        if (text.indexOf('"type":"backup_health"') !== -1) {
          existingId = block.id;
          break;
        }
      }
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor && !existingId);

  const codeBlock = {
    type: 'code',
    code: {
      language: 'json',
      rich_text: [{ type: 'text', text: { content: blockText } }]
    }
  };

  if (existingId) {
    const resp = UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + existingId, {
      method: 'patch',
      headers: headers,
      payload: JSON.stringify(codeBlock),
      muteHttpExceptions: true
    });
    Logger.log('Notion backup_health update: HTTP ' + resp.getResponseCode());
  } else {
    const resp = UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + BC_NOTION_PAGE_ID + '/children', {
      method: 'patch',
      headers: headers,
      payload: JSON.stringify({ children: [codeBlock] }),
      muteHttpExceptions: true
    });
    Logger.log('Notion backup_health create: HTTP ' + resp.getResponseCode());
  }
}
