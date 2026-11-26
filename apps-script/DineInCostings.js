// DineInCostings.js — 27 Nov 2026.
// Every sandwich costing in FOOD is TAKEAWAY (bag + greaseproof). This builds a
// matching "<NAME> (DINE IN)" block for each sandwich, appended below the last
// FOOD section, with dine-in packaging:
//   • Greaseproof Paper = 0.25 units (Bacon + Egg = 1.8)
//   • Bag = 0 (no bag)
//   • Napkin and every ingredient unchanged — formulas still point at the same
//     master price cells, so invoice price changes flow into BOTH versions
//   • Retail Price = live link to the takeaway block's Retail Price cell
//   • MUSHROOM only: Block Parmesan (25 g) is DINE-IN ONLY — it stays on the
//     dine-in block and is zeroed on the takeaway MUSHROOM SANDWICH block
//
// Run buildDineInCostings() once. Safe to re-run: blocks that already exist are
// skipped. Not included: H+C CROISSANT (has no greaseproof line) and BANANA BREAD
// (not a sandwich) — add them to DINE_IN_SECTIONS if wanted.

const DINE_IN_SECTIONS = {
  'SALAMI PANINI': 0.25,
  'H+C SANDWICH': 0.25,
  'H+C SANDWICH (TIGER STYLE)': 0.25,
  'CAPONATA SANDWICH': 0.25,
  'CAPONATA SANDWICH (WITH CHEESE)': 0.25,
  'MUSHROOM SANDWICH': 0.25,
  'TUNA SANDWICH': 0.25,
  'BEEF SANDWICH': 0.25,
  'CHICKEN SCHNITTA': 0.25,
  'BACON + EGG': 1.8,
};
const DINE_IN_COLS = 6; // A–F
const MUSHROOM_PARM_G = 25; // g block parmesan per DINE-IN mushroom sandwich

function buildDineInCostings() {
  const sh   = SpreadsheetApp.openById(SS_FOOD).getSheetByName(SHEET_FOOD);
  const last = sh.getLastRow();
  const vals = sh.getRange(1, 1, last, DINE_IN_COLS).getValues();
  const fx   = sh.getRange(1, 1, last, DINE_IN_COLS).getFormulas();

  const existing = {};
  vals.forEach(function (r) { existing[String(r[0]).trim().toUpperCase()] = true; });

  let writeRow = last + 4;
  const log = [];

  Object.keys(DINE_IN_SECTIONS).forEach(function (title) {
    const newTitle = title + ' (DINE IN)';
    if (existing[newTitle]) { log.push('SKIP (exists): ' + newTitle); return; }

    // Locate the takeaway block: title in col A → first "Profit %" in col E.
    let start = -1, end = -1;
    for (let r = 0; r < vals.length; r++) {
      if (String(vals[r][0]).trim().toUpperCase() === title) { start = r; break; }
    }
    if (start === -1) { log.push('NOT FOUND: ' + title); return; }
    for (let r = start + 1; r < Math.min(start + 45, vals.length); r++) {
      if (String(vals[r][4]).trim().toLowerCase() === 'profit %') { end = r; break; }
    }
    if (end === -1) { log.push('NO PROFIT % ROW: ' + title); return; }

    const offset = writeRow - (start + 1);       // 1-based target − 1-based source
    const srcLo = start + 1, srcHi = end + 1;    // 1-based source rows
    // Shift refs that point INSIDE the block; leave price-table refs alone.
    const shift = function (f) {
      return f.replace(/(\$?)([A-Z]{1,2})(\$?)(\d+)\b/g, function (m, d1, col, d2, row) {
        const n = Number(row);
        return (n >= srcLo && n <= srcHi && !d2) ? d1 + col + d2 + (n + offset) : m;
      });
    };

    const out = [];
    let gpDone = false, bagDone = false;
    for (let r = start; r <= end; r++) {
      const row = [];
      for (let c = 0; c < DINE_IN_COLS; c++) row.push(fx[r][c] ? shift(fx[r][c]) : vals[r][c]);
      const label = String(vals[r][0]).toUpperCase();
      const footer = String(vals[r][4]).trim().toLowerCase();
      if (r === start) row[0] = newTitle;
      if (label.indexOf('GREASEPROOF') === 0) { row[3] = DINE_IN_SECTIONS[title]; gpDone = true; }
      if (label.indexOf('BAG') === 0)         { row[0] = 'Bag (Unit) — none for dine in'; row[3] = 0; row[4] = ''; row[5] = 0; bagDone = true; }
      if (footer === 'retail price')          { row[5] = '=F' + (r + 1); }   // link to takeaway price
      if (title === 'MUSHROOM SANDWICH' && label.indexOf('BLOCK PARMESAN') === 0) {
        const nr = r + 1 + offset;                                        // 1-based target row
        row[3] = MUSHROOM_PARM_G; row[4] = '=B' + nr + '/D' + nr; row[5] = '=C' + nr + '/E' + nr;
      }
      out.push(row);
    }
    sh.getRange(writeRow, 1, out.length, DINE_IN_COLS).setValues(out);
    log.push('✓ ' + newTitle + ' → rows ' + writeRow + '–' + (writeRow + out.length - 1) +
             (gpDone ? '' : '  ⚠ no greaseproof line found') + (bagDone ? '' : '  ⚠ no bag line found'));
    writeRow += out.length + 2;
  });

  // Takeaway mushroom has no block parmesan → zero it (after the dine-in copy).
  for (let r = 0; r < vals.length; r++) {
    const tt = String(vals[r][0]).trim().toUpperCase();
    if (tt !== 'MUSHROOM SANDWICH' && tt !== 'MUSHROOM SANDWICH (TAKEAWAY)') continue;
    for (let k = r + 1; k < Math.min(r + 45, vals.length); k++) {
      if (String(vals[k][4]).trim().toLowerCase() === 'profit %') break;
      if (String(vals[k][0]).toUpperCase().indexOf('BLOCK PARMESAN') === 0) {
        sh.getRange(k + 1, 1, 1, DINE_IN_COLS).setValues([[
          'Block Parmesan (g) — dine in only', vals[k][1], '', 0, '', 0]]);   // no price link → not in recipe map
        log.push('✓ MUSHROOM SANDWICH (takeaway): Block Parmesan zeroed (row ' + (k + 1) + ')');
      }
    }
    break;
  }

  SpreadsheetApp.flush();
  // Report takeaway vs dine-in GP side by side (sheet's own Profit %, inc-GST basis).
  const v2 = sh.getRange(1, 1, sh.getLastRow(), DINE_IN_COLS).getValues();
  const pct = function (t) {
    for (let r = 0; r < v2.length; r++) if (String(v2[r][0]).trim().toUpperCase() === t) {
      for (let k = r + 1; k < r + 45 && k < v2.length; k++)
        if (String(v2[k][4]).trim().toLowerCase() === 'total + wastage') return Number(v2[k][5]).toFixed(2);
    }
    return '?';
  };
  log.push('', 'COST (incl wastage)  takeaway → dine in');
  Object.keys(DINE_IN_SECTIONS).forEach(function (t) {
    log.push('  ' + t + ': $' + pct(t) + ' → $' + pct(t + ' (DINE IN)'));
  });
  Logger.log(log.join('\n'));
}
