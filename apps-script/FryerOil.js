// FryerOil.js — fryer oil costing with a ROLLING usage rate (27 Nov 2026).
//
// The Schnitta costing's "Fryer Oil (L)" amount is NOT hard-coded: it points at
// FryerOil!$B$2 — litres of oil bought ÷ schnitzels sold over the last 26 weeks.
//   • Oil litres  = 5Ways SCO (Cottonseed Mediterranei 20LT tin) + OCO20 (Odessa
//                   20LT drum) on TAX INVOICEs in the window, from InvoiceTextCache
//   • Schnitzels  = Square line items "Schnitta" (in-store + Mr Yum "SCHNITTA")
//                   + "Thursday Parma Meal Deal" (both channels), one per item
// Baseline at build: 240 L ÷ 1,636 schnitzels (25 May–22 Nov 2026) = 0.147 L.
// 26 weeks because oil is bought in 20 L lumps — shorter windows swing ±20%.
//
// setupFryerOil()          — run ONCE: R17 price, FryerOil tab (seeded), recipe
//                            lines, weekly trigger, re-syncs
// updateFryerOilUsage()    — weekly (Mon 6am): adds last week, recalcs B2
// printFryerOilUsage()     — read-only: logs the rolling calc

const FO_TAB        = 'FryerOil';
const FO_WEEKS      = 26;
const FO_L_PER_UNIT = 20;                    // both SCO and OCO20 are 20 L
const FO_CODES      = ['SCO', 'OCO20'];
const FO_ITEMS      = ['SCHNITTA', 'THURSDAY PARMA MEAL DEAL'];
const FO_MIN = 0.05, FO_MAX = 0.40;          // sanity guard on L per schnitzel
const FO_LATEST_PRICE = 77.99;               // 25 Nov 2026 invoice; scanner keeps R17 current

// Square weekly counts (Mon-start, Melbourne), seeded from Square Reporting.
const FO_SEED = [
  ['2026-05-25',47],['2026-06-01',64],['2026-06-08',65],['2026-06-15',46],['2026-06-22',60],
  ['2026-06-29',68],['2026-07-06',63],['2026-07-13',69],['2026-07-20',53],['2026-07-27',55],
  ['2026-08-03',61],['2026-08-10',63],['2026-08-17',56],['2026-08-24',55],['2026-08-31',49],
  ['2026-09-07',78],['2026-09-14',79],['2026-09-21',100],['2026-09-28',52],['2026-10-05',34],
  ['2026-10-12',70],['2026-10-19',43],['2026-10-26',62],['2026-11-02',86],['2026-11-09',90],
  ['2026-11-16',68],
];

function setupFryerOil() {
  const ss = SpreadsheetApp.openById(SS_FOOD);
  const sh = ss.getSheetByName(SHEET_FOOD);
  const log = [];

  // 1. Price cell
  const lab = String(sh.getRange('Q17').getValue()).trim();
  if (lab && lab.toUpperCase().indexOf('FRYER') !== 0) throw new Error('FOOD Q17 is already used: "' + lab + '"');
  if (!lab) sh.getRange('Q17:R17').setValues([['FRYER OIL COTTONSEED MEDITERRANEI (20LT) (R17)', FO_LATEST_PRICE]]);
  log.push('✓ FOOD R17 fryer oil = $' + sh.getRange('R17').getValue());

  // 2. Rolling tab, seeded
  let t = ss.getSheetByName(FO_TAB);
  if (!t) {
    t = ss.insertSheet(FO_TAB);
    t.getRange('A1:B3').setValues([['FRYER OIL — L per schnitzel (26-wk rolling)', ''],
                                    ['L per schnitzel →', 0.147], ['Last updated', '']]);
    t.getRange('A5:C5').setValues([['Week start (Mon)', 'Schnitzels sold', 'Oil bought (L)']]);
    t.getRange(6, 1, FO_SEED.length, 2).setValues(FO_SEED);
    t.getRange('A1').setFontWeight('bold'); t.getRange('B2').setFontWeight('bold').setNumberFormat('0.000');
    t.getRange('A5:C5').setFontWeight('bold');
    t.setFrozenRows(5);
    log.push('✓ ' + FO_TAB + ' tab created, ' + FO_SEED.length + ' weeks seeded');
  }
  log.push(updateFryerOilUsage());

  // 3. Recipe line in every CHICKEN SCHNITTA block (takeaway + dine-in)
  const last = sh.getLastRow();
  const v = sh.getRange(1, 1, last, 6).getValues();
  const f = sh.getRange(1, 1, last, 6).getFormulas();
  const amt = '=' + FO_TAB + '!$B$2';
  for (let r = 0; r < v.length; r++) {
    const title = String(v[r][0]).trim().toUpperCase();
    if (title.indexOf('CHICKEN SCHNITTA') !== 0) continue;
    let totalRow = -1, existing = -1, empty = -1;
    for (let k = r + 2; k < Math.min(r + 45, v.length); k++) {
      if (String(v[k][0]).toUpperCase().indexOf('FRYER OIL') === 0) existing = k;
      if (String(v[k][4]).trim() === 'Total') { totalRow = k; break; }
      if (empty === -1 && String(v[k][0]).trim() === '' && String(v[k][5]).trim() === '' && String(v[k - 1][0]).trim() !== '') empty = k;
    }
    if (existing !== -1) {
      sh.getRange(existing + 1, 4).setFormula(amt);
      log.push('✓ ' + title + ' — fryer oil row ' + (existing + 1) + ' now uses rolling rate');
      continue;
    }
    if (totalRow === -1 || empty === -1) { log.push('⚠ ' + title + ' — no free row found, add by hand'); continue; }
    const m = /SUM\(F(\d+):F(\d+)\)/.exec(f[totalRow][5] || '');
    if (!m || empty + 1 < Number(m[1]) || empty + 1 > Number(m[2])) { log.push('⚠ ' + title + ' — free row outside Total range, add by hand'); continue; }
    const n = empty + 1;
    sh.getRange(n, 1, 1, 6).setValues([['Fryer Oil (L)', FO_L_PER_UNIT, '=R17', amt, '=B' + n + '/D' + n, '=C' + n + '/E' + n]]);
    log.push('✓ ' + title + ' — fryer oil added at row ' + n + ' (rolling rate)');
  }
  SpreadsheetApp.flush();

  // 4. Weekly trigger
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'updateFryerOilUsage') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('updateFryerOilUsage').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();
  log.push('✓ Weekly trigger: updateFryerOilUsage, Mondays ~6am');

  syncIngredientPrices();
  syncAllCostingsToNotion();
  buildRecipeMap();
  log.push('✓ Re-synced Supplier Prices, Notion costings, recipe map');
  Logger.log(log.join('\n'));
}

// Weekly: append any missing completed weeks from Square, recompute oil + rate.
function updateFryerOilUsage() {
  const ss = SpreadsheetApp.openById(SS_FOOD);
  const t  = ss.getSheetByName(FO_TAB);
  if (!t) throw new Error('Run setupFryerOil() first');
  const tz = 'Australia/Melbourne';
  const key = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  const parse = function (s) { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const add = function (d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };

  // Existing weeks
  const lastRow = Math.max(t.getLastRow(), 5);
  let rows = lastRow > 5 ? t.getRange(6, 1, lastRow - 5, 2).getValues() : [];
  rows = rows.filter(function (r) { return r[0] !== ''; })
             .map(function (r) { return [r[0] instanceof Date ? key(r[0]) : String(r[0]), Number(r[1])]; });
  const have = {}; rows.forEach(function (r) { have[r[0]] = true; });

  // This week's Monday; fill completed weeks after the last stored one (max 8 per run)
  const today = new Date();
  const dow = (Number(Utilities.formatDate(today, tz, 'u')) + 6) % 7;   // Mon=0
  const thisMon = parse(key(add(today, -dow)));
  let next = rows.length ? add(parse(rows[rows.length - 1][0]), 7) : add(thisMon, -7 * FO_WEEKS);
  let fetched = 0;
  while (next < thisMon && fetched < 8) {
    if (!have[key(next)]) {
      const orders = sdFetchWeekOrders_(next, add(next, 7));
      let n = 0;
      orders.forEach(function (o) {
        (o.line_items || []).forEach(function (li) {
          if (FO_ITEMS.indexOf(String(li.name || '').trim().toUpperCase()) !== -1) n += Number(li.quantity || 0);
        });
      });
      rows.push([key(next), n]); fetched++;
    }
    next = add(next, 7);
  }

  // Oil bought per week from cached 5Ways invoice text (dedup by invoice no)
  const cache = ss.getSheetByName('InvoiceTextCache').getDataRange().getValues();
  const seenInv = {}, oilByWeek = {};
  for (let i = 1; i < cache.length; i++) {
    const fn = String(cache[i][2] || '');
    if (cache[i][1] !== '5Ways' || fn.indexOf('TAX INVOICE') === -1) continue;
    const inv = (/TAX INVOICE - (\d+)/.exec(fn) || [])[1]; const dm = /^(\d{4}-\d{2}-\d{2})/.exec(fn);
    if (!inv || !dm || seenInv[inv]) continue; seenInv[inv] = true;
    let litres = 0;
    parse5WaysLines(String(cache[i][4] || '')).forEach(function (it) {
      if (FO_CODES.indexOf(String(it.itemCode).toUpperCase()) !== -1) litres += (it.qty || 1) * FO_L_PER_UNIT;
    });
    if (!litres) continue;
    const d = parse(dm[1]); const wd = (d.getDay() + 6) % 7;
    const wk = key(add(d, -wd));
    oilByWeek[wk] = (oilByWeek[wk] || 0) + litres;
  }

  rows.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
  const out = rows.map(function (r) { return [r[0], r[1], oilByWeek[r[0]] || 0]; });
  t.getRange(6, 1, Math.max(lastRow - 5, out.length), 3).clearContent();
  t.getRange(6, 1, out.length, 3).setValues(out);

  const win = out.slice(-FO_WEEKS);
  const sch = win.reduce(function (s, r) { return s + r[1]; }, 0);
  const oil = win.reduce(function (s, r) { return s + r[2]; }, 0);
  const rate = sch ? oil / sch : 0;
  const prev = Number(t.getRange('B2').getValue());
  let msg = 'Fryer oil rolling ' + win.length + ' wks (' + win[0][0] + ' → ' + win[win.length - 1][0] + '): ' +
            oil + ' L ÷ ' + sch + ' schnitzels = ' + rate.toFixed(3) + ' L';
  if (rate >= FO_MIN && rate <= FO_MAX) {
    t.getRange('B2').setValue(Math.round(rate * 1000) / 1000);
    msg += ' (was ' + prev.toFixed(3) + ')';
  } else {
    msg += ' — OUTSIDE ' + FO_MIN + '–' + FO_MAX + ', kept ' + prev.toFixed(3) + '. Check InvoiceTextCache / Square item names.';
  }
  t.getRange('B3').setValue(new Date());
  Logger.log(msg);
  return msg;
}

function printFryerOilUsage() { return updateFryerOilUsage(); }
