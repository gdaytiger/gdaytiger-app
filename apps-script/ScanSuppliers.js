/**
 * G'DAY TIGER — Master Supplier Invoice Scanner
 * Merged from ScanInvoicesFromDrive.gs + ScanAdditionalSuppliers.gs
 *
 * Scans supplier invoices (Drive PDFs + Gmail attachments) hourly and
 * auto-updates ingredient prices in FOOD COSTINGS and COFFEE COSTINGS sheets.
 *
 * ENTRY POINTS:
 *   scanAllSuppliers()          — master scan (Food + Coffee), called by hourly trigger
 *   scanFoodSuppliers()         — Food sheet only (manual/debug)
 *   scanCoffeeSuppliers()       — Coffee sheet only (manual/debug)
 *   resetScanHistory()          — force re-scan of last 60 days on next run
 *
 * SETUP (run once):
 *   createScanTrigger()         — sets up hourly trigger
 *   addCandiedBakeryPriceRows() — adds Choc Marshmallow, Brownie, Candied Pie rows to FOOD sheet
 *
 * DIAGNOSTICS:
 *   debugSheetLabels()          — print all label cells in both sheets
 *   printAbicorInvoiceText()    — dump latest Abicor email PDF text for format check
 *
 * FOOD SUPPLIERS:
 *   ✅ 5Ways           Drive TAX INVOICE PDFs             — meats, cheese, veg, sauces, pantry (~20 items)
 *   ✅ Sciclunas       Drive Fresho PDFs       — vegetables, eggs (14 items)
 *   ✅ Uncle's         Drive Ordermentum PDFs             — beef pastrami
 *   ✅ Woolworths      Drive eReceipt PDFs                — parmesan block /kg
 *   ✅ Dench Bakers    Drive Tax Invoice PDFs             — sourdough, ciabatta
 *   ✅ Noisette        Drive Invoice PDFs                 — croissant /unit
 *   ✅ Product Dist.   Drive PDFs                         — McClure's pickles 19L
 *   ✅ Candied Bakery  Drive PDFs                         — ciabatta, choc marshmallow, candied pie
 *   ✅ PFD Foods       Gmail Sales Orders                 — chicken /kg, sauerkraut
 *   ✅ Trio Supplies    Gmail Tax Invoice PDFs             — napkins /2000, trays /150 (formerly Abicor)
 *
 * COFFEE SUPPLIERS:
 *   ✅ Seven Seeds     Drive Invoice PDFs                 — GG 1KG, Chai /6L, F.Bomb 1KG, Decaf 1KG
 *   ✅ Mörk Chocolate  Drive invoice_pdf PDFs             — JNR Dark 1KG
 *   ✅ Matsu Tea       Drive invoice_pdf PDFs             — Matcha 500G
 *   ✅ Redi Milk       Drive Weekly Invoice    — all milks (also cross-writes FOOD R12)
 *   ✅ 5Ways           Drive TAX INVOICE PDFs             — Bundaberg Sugar
 *   ✅ Planetware     Drive Sales Order PDFs             — 6oz cup, 12oz cup, 8oz lid
 *
 * REQUIRES: Advanced Drive API enabled (Extensions → Services → Drive API)
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const SS_FOOD   = '1nZvWNFaQTrJAt-ilYihZjYZKBzHd6x3qIrjFhdNQqAU';
const SS_COFFEE = '1M5VwhnaOjL29rUh3LC4JmL_4oriqIviMvUs7vd-2NTI';
const SHEET_FOOD   = 'FOOD';
const SHEET_COFFEE = 'COFFEE';

// Drive folder IDs (confirmed Apr 2026)
const FOLDER_5WAYS       = '1nD4Mp3Un5Ixai9nP1-t3UuiRUeNQ67D4';
const FOLDER_SCICLUNAS   = '1T_Myj10iIeVf6sVI79rz10Zwm4BpSlC6';
const FOLDER_UNCLES      = '1-7Zgxo6rVDxcCZV0L6g0kF0d_pLoFULS';
const FOLDER_WOOLWORTHS  = '1uy3U9JoIhHsl2Rjp_XBn8qS4Bj06yl-V';
const FOLDER_DENCH       = '1Kes-5QAHFTHZi_dL__BcasZbVWKvSOcX';
const FOLDER_SEVEN_SEEDS = '1vUmERqIJC09Roy1GaymUbP0xuPmui0Ok';
const FOLDER_MORK        = '1X3a_XUm78VqIhBpDRFetlkqvUOw4rjtP';
const FOLDER_MATSU       = '15izmuVhg3d5M_vEQcPsSjGuACLpObS47';
const FOLDER_REDI_MILK   = '1SsSkjeVWdt64Mhau9m0dSJ-SnFOuaJcv';
const FOLDER_PLANETWARE  = '10tCI4rVKUK-2_zRAFifqNSROvdjyLSPT';

// Newer suppliers use folder names inside "Supplier Invoices" parent
const DRIVE_ROOT_FOLDER  = 'Supplier Invoices';

// Gmail senders
const GMAIL_PFD    = 'PFDPortal@pfdfoods.com.au';
const GMAIL_ABICOR = 'sales@triosuppliesaustralia.com.au';  // formerly sales@abicorsouthern.com.au

// Scan windows
const FALLBACK_DAYS = 60;  // used when no scan history exists
const ABICOR_DAYS   = 14;  // Abicor: broader window (less frequent invoices)

// ─── DEFENSIVE LAYER: CELL METADATA ───────────────────────────────────────────
// For each tracked cell:
//   min/max     — sanity range. Captured prices outside this window are
//                 logged as a guard warning and NOT written to the sheet.
//                 Keeps bad parser output from silently corrupting recipes.
//   refreshDays — how often we expect this cell to be touched by an invoice.
//                 checkPriceDrift() flags cells that have been silent for longer
//                 (typical cause: supplier renamed the SKU; parser stopped matching).
//   label       — human-friendly description used in log lines.

const COFFEE_CELL_META = {
  B5:  { min: 25,  max: 60,  refreshDays: 14, label: 'GG Espresso /kg' },
  B6:  { min: 35,  max: 100, refreshDays: 45, label: 'JNR Dark Chocolate /1kg' },
  B7:  { min: 15,  max: 40,  refreshDays: 21, label: 'Chai /L' },
  B8:  { min: 30,  max: 60,  refreshDays: 21, label: 'F.Bomb /kg' },
  B9:  { min: 35,  max: 90,  refreshDays: 21, label: 'Decaf /kg' },
  B10: { min: 70,  max: 150, refreshDays: 60, label: 'Matcha /500g' },
  D5:  { min: 3,   max: 6,   refreshDays: 14, label: 'Sungold Jersey 2LT' },
  D6:  { min: 3,   max: 6,   refreshDays: 14, label: 'Sungold Lowfat 2LT' },
  D7:  { min: 15,  max: 30,  refreshDays: 21, label: 'Happy Soy /1L' },
  D8:  { min: 28,  max: 45,  refreshDays: 21, label: 'Alt.Dairy.Co Oat /carton' },
  D9:  { min: 28,  max: 45,  refreshDays: 21, label: 'Alt.Dairy.Co Almond /carton' },
  F5:  { min: 25,  max: 50,  refreshDays: 30, label: 'Bundaberg Raw Sugar /15KG' },
  H5:  { min: 60,  max: 120, refreshDays: 90, label: 'Cup 6oz /1000' },
  H6:  { min: 70,  max: 140, refreshDays: 90, label: 'Cup 12oz /1000' },
  H7:  { min: 50,  max: 100, refreshDays: 90, label: 'Hot Lid /1000' },
  H9:  { min: 40,  max: 80,  refreshDays: 60, label: 'Sipper Lid /1000' },
  H10: { min: 80,  max: 150, refreshDays: 60, label: 'Paper Straw /2500' },
};

const FOOD_CELL_META = {
  R12: { min: 3,  max: 6,   refreshDays: 14, label: 'Sungold FC 2LT (cross-write)' },
  R15: { min: 30, max: 80,  refreshDays: 60, label: 'Pinenuts /1kg' },
  // Add ranges for other Food sheet cells incrementally as needed.
};

// ─── PRICE TABLE MAPPINGS ─────────────────────────────────────────────────────
// Used by complex parsers (5Ways, Sciclunas, etc.) with updateIfChanged().
// cell = exact cell address in the FOOD or COFFEE sheet.

const FIVEWAYS_MAP = [
  { match: ['MPR4', 'BREAD ROLL POTATO', 'MARTINS'],       cell: 'B7',  convert: p => p,              note: 'Martins Potato Bun 5×12 /box' },
  { match: ['PPCOH', 'PROSCIUTTO COTTO'],                   cell: 'D5',  convert: p => p,              note: 'Prosciutto Cotto /kg' },
  { match: ['PHSS', 'SALAMI SOPRESSATA'],                   cell: 'D7',  convert: p => p,              note: 'Salami Sopressata /kg' },
  { match: ['SMT', 'SOMARE', 'TUNA', 'ALBACORE'],          cell: 'D8',  convert: p => p,              note: 'Tuna 425g tin /unit' },
  { match: ['FCM', 'CHEESE MOZZ BLOCK FLORIDIA'],           cell: 'F5',  convert: p => r2(p / 15),     note: 'Mozz Floridia /kg (CTN ÷ 15 kg)' },
  { match: ['MSCS', 'CHEESE SLICE SWISS MAINLAND'],         cell: 'F6',  convert: p => p,              note: 'Mainland Swiss /1 kg pack' },
  { match: ['TALEGGIO'],                                    cell: 'F7',  convert: p => p,              note: 'Taleggio /kg' },
  { match: ['ABCS', 'CHEESE YELLOW PROCESS AMERICAN'],      cell: 'F8',  convert: p => r2(p / 2.27),   note: 'Hi Melt American /kg (÷ 2.27 kg)' },
  { match: ['SGGP', 'CHEESE GRANA GRATED', 'SORESI GRANA'],cell: 'F9',  convert: p => p,              note: 'Parmesan Grated Soresi /kg' },
  { match: ['MCLURES', 'CRINKLE PICKLE', 'PICKLE CRINKLE'],cell: 'H7',  convert: p => p,              note: 'McClures Crinkle Pickles 19L drum' },
  { match: ['MFDM', 'MUSTARD DIJON'],                       cell: 'J5',  convert: p => p,              note: 'Dijon Mustard 2.5kg jar' },
  { match: ['HRD', 'HELLMANS', 'HELLMANN', 'MAYO REAL'],   cell: 'J6',  convert: p => p,              note: 'Hellmans Real Mayo 20kg' },
  { match: ['HEINZ KETCHUP', 'HEINZ TOMATO', 'KETCHUP HEINZ'], cell: 'J7', convert: p => p,           note: 'Heinz Ketchup 4LT' },
  { match: ['WSB', 'BUTTER SALTED ORIG WESTERN STA'],       cell: 'N5',  convert: p => p,              note: 'Western Star Butter /1.5 kg block' },
  { match: ['BON CHEF', 'POMACE OLIVE OIL'],                cell: 'N6',  convert: p => p,              note: 'Bon Chef Pomace Olive Oil 4LT' },
  { match: ['PEPPER BLACK', 'PEPPER GROUND', 'BLACK PEPPER'],cell: 'N8', convert: p => p,             note: 'Pepper 1kg' },
  { match: ['ADPLF10', 'FLOUR PLAIN ALLIED'],               cell: 'R5',  convert: p => p,              note: 'Plain Flour Allied /12.5 kg bag' },
  { match: ['FLOUR S/RAISING', 'FLOUR SELF RAISING'],       cell: 'R6',  convert: p => p,              note: 'Self Raising Flour Allied /12.5 kg bag' },
  { match: ['LVO', 'VEGETABLE OIL GEPPINO', 'GEPPINO'],    cell: 'R11', convert: p => p,              note: 'Vegetable Oil Geppino 20LT' },
  { match: ['BCSI5', 'SUGAR CASTER BUNDABERG'],             cell: 'R7',  convert: p => p,              note: 'Bundaberg Caster Sugar /15kg bag' },
  { match: ['BRS15', 'SUGAR RAW BUNDABERG', 'RAW BUNDABERG'],cell: 'R8', convert: p => p,             note: 'Bundaberg Raw/Brown Sugar /15kg bag' },
  { match: ['BICS500', 'BI-CARB SODA', 'BICARB SODA'],     cell: 'R9',  convert: p => p,              note: 'Bi-Carb Soda /500g pkt' },
  { match: ['CPG', 'CINNAMON POWDER', 'CINNAMON GROUND'],   cell: 'R10', convert: p => p,              note: 'Cinnamon Powder Ground /500g bag' },
  { match: ['NJPB', 'BREADCRUMBS JAPANESE PANKO', 'PANKO'],cell: 'R13', convert: p => p,              note: 'Japanese Panko Breadcrumbs /10kg bag' },
  { match: ['FHON3', 'HONEY PURE BLEND', 'HONEY BLEND'],   cell: 'R14', convert: p => p,              note: 'Honey Pure Blend 100% /3kg tub' },
  { match: ['TPMU1', 'NUTS PINENUT', 'PINENUT KERNAL'],    cell: 'R15', convert: p => p,              note: 'Pinenuts Kernel Medium /1kg bag' },
];

const SCICLUNAS_MAP = [
  { match: ['Tomatoes', 'Tomato'],                 cell: 'H5',
    convert: (p, unit) => { const m = unit.match(/\((\d+)kg\)/i); return m ? r2(p / parseFloat(m[1])) : p; },
    note: 'Tomatoes /kg (Tray ÷ kg weight)' },
  { match: ['Mushrooms'],                          cell: 'H8',  convert: p => p, note: 'Mushrooms /box (4 kg)' },
  { match: ['Red Onion', 'Onion Red'],             cell: 'H9',  convert: p => p, note: 'Red Onion /kg' },
  { match: ['Fennel'],                             cell: 'H10', convert: p => p, note: 'Fennel /each' },
  { match: ['Chillies - Long Red', 'Long Red Chill'], cell: 'H11', convert: p => p, note: 'Red Chilli /kg' },
  { match: ['Chillies - Jalapeno', 'Jalapeno', 'Jalapeño'], cell: 'H12', convert: p => p, note: 'Jalapeno /kg' },
  { match: ['Parsley'],                            cell: 'H13', convert: p => p, note: 'Parsley /bunch' },
  { match: ['Dill'],                               cell: 'H14', convert: p => p, note: 'Dill /bunch' },
  { match: ['Banana', 'Bananas'],                  cell: 'H15', convert: p => p, note: 'Bananas Cooking /box' },
  { match: ['Eggplant'],                           cell: 'H16', convert: p => p, note: 'Eggplant /box (7 kg)' },
  { match: ['Lemon', 'Lemons'],                    cell: 'H17', convert: p => p, note: 'Lemons /kg' },
  { match: ['Carrot', 'Carrots'],                  cell: 'H18', convert: p => p, note: 'Carrots /kg' },
  { match: ['Cucumber'],                           cell: 'H19', convert: p => p, note: 'Cucumber /each' },
  { match: ['Eggs', 'Egg Free Range'],             cell: 'N9',  convert: p => p, note: 'Eggs /box (15 doz)' },
];

const UNCLES_MAP = [
  { match: ['Pastrami', 'New York Pastrami'], cell: 'D6', convert: p => p, note: 'Uncles Beef Pastrami /kg' },
];

const WOOLWORTHS_MAP = [
  { match: ['Parmesan', 'Grana Padano', 'Parmigiano'], cell: 'F10',
    convertWithDesc: (price, desc) => {
      const m = (desc || '').match(/(\d+)\s*(?:gms?|g)\b/i);
      return m ? r2(price / parseInt(m[1]) * 1000) : null;
    }, note: 'Parmesan Block /kg (eReceipt pack price ÷ weight)' },
];

const DENCH_MAP = [
  { match: ['BHW1600', 'HOUSE WHITE', 'BHW1600TK'], cell: 'B5', note: 'Dench House White 1600 Thick /loaf' },
  { match: ['CIABATTA', 'CANDIED'],                 cell: 'B6', note: 'Dench Candied Ciabatta /unit' },
  { match: ['CROISSANT', 'NOISETTE', 'CRSS'],       cell: 'B8', note: 'Dench Noisette Croissant /unit' },
];

const ABICOR_MAP = [
  { match: ['2LW1/8', '2LWGT', 'CAPRICE', 'LUNCH WHITE', 'DURO 2PLY', 'NAPKIN'],
    cell: 'P8', convert: p => p, note: 'Trio Supplies Napkins /2000' },
  { match: ['TRAY', 'WHITE TRAY', 'BROWN TRAY', '#2 TRAY', 'WHITE/BROWN', 'BT2'],
    cell: 'P9', convert: p => p, note: 'Trio Supplies #2 White/Brown Tray /150' },
];

// COFFEE sheet items from Trio Supplies invoices
const ABICOR_COFFEE_MAP = [
  { match: ['PSJWHITE', 'PAPER STRAW JUMBO', 'PAPER STRAW'],
    cell: 'H10', convert: p => p, note: 'Trio Supplies Paper Straw Jumbo White /2500' },
  { match: ['SFL98PET', 'STRAW FREE LID', 'SIPPER LID', 'PET STRAW FREE'],
    cell: 'H9', convert: p => p, note: 'Trio Supplies PET Straw-Free / Sipper Lid 98mm /1000' },
];

const PFD_MAP = [
  { match: ['CHICKEN BREAST', 'CHICKEN BRS', 'BREAST FILLET', 'CHICKEN IQF', 'CHICKEN'],
    cell: 'D9', convert: p => p, note: 'PFD Chicken /kg' },
  { match: ['SAUERKRAUT', 'SAUER KRAUT'],
    cell: 'H6', convert: p => p, note: 'PFD Sauerkraut /unit' },
];

const FIVEWAYS_COFFEE_MAP = [
  { match: ['BRS15'], cell: 'F5', convert: p => p, note: 'Bundaberg Raw Sugar 15KG /bag' },
  // H8 Detpak 16oz: item code TBC — add once confirmed on invoice
  // { match: ['???DETPAK???'], cell: 'H8', convert: p => p, note: 'Detpak 16oz x1000' },
];

// ─── NEWER SUPPLIERS (Drive, label-search via updateSheetPrice_) ──────────────
// These use folder names under DRIVE_ROOT_FOLDER rather than hardcoded folder IDs.
// updateSheetPrice_ searches both sheets by label text — no cell address needed.
//
// ⚠ BROWNIE SLAB: confirm whether Candied Bakery invoices per piece or per box
//   before activating. If per box of N, use: p => p / N
//   Uncomment and add sheetSearch once price row exists in FOOD sheet.

const SIMPLE_DRIVE_SUPPLIERS = [

  // ── Noisette ──────────────────────────────────────────────────────────────
  {
    name: 'Noisette', filter: /Invoice/i,
    items: [{
      label: 'Noisette Croissant (unit)', sheetSearch: 'NOISETTE CROISSANT',
      extract: text => { const m = text.match(/\d+\s+Croissant[\s\S]*?(\d+\.\d{2})/i); return m ? parseFloat(m[1]) : null; }
    }]
  },

  // ── Product Distribution ──────────────────────────────────────────────────
  {
    name: 'Product Distribution', filter: /.*/,
    items: [{
      label: "McClure's Pickles (19L)", sheetSearch: 'MCLURES',
      extract: text => { const m = text.match(/McClure[^\d\n]*[\d.]+\s+([\d.]+)\s+\d+%/i); return m ? parseFloat(m[1]) : null; }
    }]
  },

  // ── Candied Bakery ────────────────────────────────────────────────────────
  // Format: "{description} {qty.00} {unitPrice} {total.00}" — 3 decimals per line
  {
    name: 'Candied Bakery', filter: /INV-|Invoice/i,
    items: [
      {
        label: 'Candied Bakery Ciabatta Roll', sheetSearch: 'CIABATTA',
        extract: text => threeDecimalMiddle_(text, /Ciabatta roll/i)
      },
      {
        label: 'Candied Bakery Choc Marshmallow Cookie', sheetSearch: 'CHOC MARSHMALLOW',
        extract: text => threeDecimalMiddle_(text, /Choc Marshmallow/i)
      },
      // ⚠ Brownie Slab: confirm invoice pricing unit first (per piece vs per box)
      // { label: 'Candied Bakery Brownie Slab (per piece)', sheetSearch: 'BROWNIE',
      //   extract: text => threeDecimalMiddle_(text, /Brownie SLAB/i) },
      {
        label: 'Candied Bakery Candied Pie', sheetSearch: 'CANDIED PIE',
        extract: text => threeDecimalMiddle_(text, /Candied Pie/i)
      },
    ]
  },
];

// ─── MASTER ENTRY POINT ───────────────────────────────────────────────────────

function scanAllSuppliers() {
  Logger.log("=== G'Day Tiger — Supplier Price Scan ===");
  Logger.log(new Date().toLocaleString('en-AU'));

  const cutoff = getLastScanTime();  // capture before food scan advances it
  let total = 0;
  total += scanFoodSuppliers(cutoff);
  total += scanCoffeeSuppliers(cutoff);
  setLastScanTime();

  Logger.log(`\n=== Complete. ${total} total price(s) updated. ===`);
  return total;
}

// ─── FOOD SCANNER ─────────────────────────────────────────────────────────────

function scanFoodSuppliers(cutoffOverride) {
  const cutoff = cutoffOverride || getLastScanTime();
  const sheet  = SpreadsheetApp.openById(SS_FOOD).getSheetByName(SHEET_FOOD);
  if (!sheet) throw new Error(`Sheet "${SHEET_FOOD}" not found in Food Costings`);

  const log = [`\n=== FOOD Scan: ${new Date().toLocaleString('en-AU')} ===`,
               `Cutoff: ${cutoff.toLocaleString('en-AU')}`, ''];
  let updates = 0;

  // ── 5Ways (TAX INVOICE PDFs)
  log.push('--- 5WAYS FOODSERVICE ---');
  try {
    const files = getSortedPdfs(FOLDER_5WAYS, 'TAX INVOICE', cutoff);
    log.push(`${files.length} invoice(s)`);
    files.forEach(f => {
      const text  = extractPdfText(f.getId()); if (!text) return;
      const items = parse5WaysLines(text);
      const seen  = {};
      items.forEach(item => {
        FIVEWAYS_MAP.forEach(map => {
          if (!seen[map.cell] && matchesAny(item.itemCode, map.match)) {
            seen[map.cell] = true;
            if (updateIfChanged(sheet, map.cell, map.convert(item.unitPrice), map.note, log)) updates++;
          }
        });
      });
    });
  } catch(e) { log.push('ERROR (5Ways): ' + e.message); }

  // ── Sciclunas (Fresho PDFs — Drive then Gmail fallback)
  log.push('\n--- SCICLUNAS WHOLESALE ---');
  try {
    const files = getSortedPdfs(FOLDER_SCICLUNAS, 'FreshoInvoice', cutoff);
    log.push(`${files.length} Drive invoice(s)`);
    files.forEach(f => {
      const text  = extractPdfText(f.getId()); if (!text) return;
      const items = parseSciclunasLines(text);
      items.forEach(item => {
        const map = SCICLUNAS_MAP.find(m => matchesAny(item.description, m.match));
        if (map) { if (updateIfChanged(sheet, map.cell, map.convert(item.unitPrice, item.unit), map.note, log)) updates++; }
        else { log.push(`  NO MAP: ${item.description} ${item.unit} $${item.unitPrice}`); }
      });
    });
  } catch(e) { log.push('ERROR (Sciclunas): ' + e.message); }

  // ── Uncle's Smallgoods (Ordermentum Order Confirmations)
  log.push('\n--- UNCLES SMALLGOODS ---');
  try {
    const files = getSortedPdfs(FOLDER_UNCLES, 'Order Confirmation', cutoff);
    log.push(`${files.length} order(s)`);
    files.forEach(f => {
      const text  = extractPdfText(f.getId()); if (!text) return;
      const items = parseUnclesLines(text);
      items.forEach(item => {
        const map = UNCLES_MAP.find(m => matchesAny(item.description, m.match));
        if (map) { if (updateIfChanged(sheet, map.cell, map.convert(item.unitPrice), map.note, log)) updates++; }
        else { log.push(`  NO MAP: ${item.description} $${item.unitPrice}`); }
      });
    });
  } catch(e) { log.push('ERROR (Uncles): ' + e.message); }

  // ── Woolworths (eReceipts)
  log.push('\n--- WOOLWORTHS ---');
  try {
    const files = getSortedPdfs(FOLDER_WOOLWORTHS, 'eReceipt', cutoff);
    log.push(`${files.length} receipt(s)`);
    files.forEach(f => {
      const text  = extractPdfText(f.getId()); if (!text) return;
      const items = parseWoolworthsLines(text);
      items.forEach(item => {
        const map = WOOLWORTHS_MAP.find(m => matchesAny(item.description, m.match));
        if (!map) return;
        const price = map.convertWithDesc ? map.convertWithDesc(item.unitPrice, item.description) : map.convert(item.unitPrice);
        if (price && updateIfChanged(sheet, map.cell, price, map.note, log)) updates++;
      });
    });
  } catch(e) { log.push('ERROR (Woolworths): ' + e.message); }

  // ── Dench Bakers (Tax Invoice PDFs)
  log.push('\n--- DENCH BAKERS ---');
  try {
    const files = getSortedPdfs(FOLDER_DENCH, 'Invoice', cutoff);
    log.push(`${files.length} invoice(s)`);
    const seen = {};
    files.forEach(f => {
      const text  = extractPdfText(f.getId()); if (!text) return;
      const items = parseDenchLines(text);
      items.forEach(item => {
        DENCH_MAP.forEach(map => {
          if (seen[map.cell]) return;
          if (matchesAny(item.itemCode.toUpperCase(), map.match) || matchesAny(item.description, map.match)) {
            seen[map.cell] = true;
            if (updateIfChanged(sheet, map.cell, item.unitPrice, map.note, log)) updates++;
          }
        });
      });
    });
  } catch(e) { log.push('ERROR (Dench): ' + e.message); }

  // ── Newer Drive suppliers (Noisette, Product Distribution, Candied Bakery)
  log.push('\n--- NEWER DRIVE SUPPLIERS ---');
  try {
    updates += scanSimpleDriveSuppliers_(cutoff, log);
  } catch(e) { log.push('ERROR (simple Drive suppliers): ' + e.message); }

  // ── PFD Foods (Gmail Sales Order PDFs)
  try {
    updates += scanPfdFromGmail_(cutoff, log);
  } catch(e) { log.push('ERROR (PFD): ' + e.message); }

  // ── Abicor (Gmail Tax Invoice PDFs)
  log.push('\n--- ABICOR / TRIO SUPPLIES ---');
  try {
    updates += scanAbicorFromGmail_(log);
  } catch(e) { log.push('ERROR (Abicor): ' + e.message); }

  Logger.log(log.join('\n'));
  return updates;
}

// ─── NEWER DRIVE SUPPLIERS (SIMPLE_DRIVE_SUPPLIERS config array) ──────────────

function scanSimpleDriveSuppliers_(cutoff, log) {
  const root = getDriveFolder_(DRIVE_ROOT_FOLDER);
  if (!root) { log.push(`Drive folder "${DRIVE_ROOT_FOLDER}" not found — skipping`); return 0; }

  let updates = 0;
  for (const supplier of SIMPLE_DRIVE_SUPPLIERS) {
    const folder = getFolderByName_(root, supplier.name);
    if (!folder) { log.push(`\n[${supplier.name}] Folder not found — skipping`); continue; }

    const pdfs = getRecentPDFs_(folder, cutoff);
    if (pdfs.length === 0) { log.push(`\n[${supplier.name}] No new PDFs since last scan`); continue; }

    log.push(`\n[${supplier.name}] ${pdfs.length} PDF(s)`);
    for (const pdf of pdfs) {
      if (!supplier.filter.test(pdf.getName())) { log.push(`  Skipped: ${pdf.getName()}`); continue; }
      const text = extractPdfText(pdf.getId()); if (!text) continue;

      for (const item of supplier.items) {
        const price = item.extract(text);
        if (!isValidPrice_(price)) { log.push(`  [${item.label}] no match in ${pdf.getName()}`); continue; }
        if (updateSheetPrice_(item.sheetSearch, price, item.label, log)) updates++;
      }
    }
  }
  return updates;
}

// ─── COFFEE SCANNER ───────────────────────────────────────────────────────────

function scanCoffeeSuppliers(cutoffOverride) {
  const cutoff      = cutoffOverride || getLastScanTime();
  const coffeeSheet = SpreadsheetApp.openById(SS_COFFEE).getSheetByName(SHEET_COFFEE);
  const foodSheet   = SpreadsheetApp.openById(SS_FOOD).getSheetByName(SHEET_FOOD);
  if (!coffeeSheet) throw new Error(`Sheet "${SHEET_COFFEE}" not found in Coffee Costings`);

  const log = [`\n=== COFFEE Scan: ${new Date().toLocaleString('en-AU')} ===`,
               `Cutoff: ${cutoff.toLocaleString('en-AU')}`, ''];
  let updates = 0;

  // ── Seven Seeds (B5 GG 1KG, B7 Chai /6L, B8 F.Bomb, B9 Decaf)
  log.push('--- SEVEN SEEDS ---');
  try {
    const files = getSortedPdfs(FOLDER_SEVEN_SEEDS, 'Invoice INV', cutoff);
    log.push(`${files.length} invoice(s)`);
    files.forEach(f => {
      const text   = extractPdfText(f.getId()); if (!text) return;
      const prices = parseSevenSeedsText(text);
      Object.keys(prices).forEach(cell => {
        if (validateAndUpdate(coffeeSheet, cell, prices[cell], 'Seven Seeds', log, COFFEE_CELL_META)) updates++;
      });
    });
  } catch(e) { log.push('ERROR (Seven Seeds): ' + e.message); }

  // ── Mörk Chocolate (B6)
  log.push('\n--- MORK CHOCOLATE ---');
  try {
    const files = getSortedPdfs(FOLDER_MORK, 'invoice_pdf', cutoff);
    log.push(`${files.length} invoice(s)`);
    files.forEach(f => {
      const text   = extractPdfText(f.getId()); if (!text) return;
      const prices = parseMorkText(text);
      Object.keys(prices).forEach(cell => {
        if (validateAndUpdate(coffeeSheet, cell, prices[cell], 'Mork Dark Choc 1KG', log, COFFEE_CELL_META)) updates++;
      });
    });
  } catch(e) { log.push('ERROR (Mork): ' + e.message); }

  // ── Matsu Tea (B10)
  log.push('\n--- MATSU TEA ---');
  try {
    const files = getSortedPdfs(FOLDER_MATSU, 'invoice_pdf', cutoff);
    log.push(`${files.length} invoice(s)`);
    files.forEach(f => {
      const text   = extractPdfText(f.getId()); if (!text) return;
      const prices = parseMatsuText(text);
      Object.keys(prices).forEach(cell => {
        if (validateAndUpdate(coffeeSheet, cell, prices[cell], 'Matsu Matcha 500G', log, COFFEE_CELL_META)) updates++;
      });
    });
  } catch(e) { log.push('ERROR (Matsu): ' + e.message); }

  // ── Redi Milk (D5–D9 Coffee sheet; also cross-writes FOOD R12 — Drive then Gmail fallback)
  log.push('\n--- REDI MILK ---');
  try {
    const files = getSortedPdfs(FOLDER_REDI_MILK, 'Weekly Invoice', cutoff);
    log.push(`${files.length} Drive invoice(s)`);
    files.forEach(f => {
      const text   = extractPdfText(f.getId()); if (!text) return;
      const prices = parseRediMilkText(text);
      Object.keys(prices).forEach(cell => {
        if (validateAndUpdate(coffeeSheet, cell, prices[cell], 'Redi Milk', log, COFFEE_CELL_META)) updates++;
      });
      // Cross-write Sungold Full Cream to FOOD sheet R12
      if (prices['D5'] && foodSheet) {
        validateAndUpdate(foodSheet, 'R12', prices['D5'], 'Redi Milk Sungold Full Cream 2LT (FOOD)', log, FOOD_CELL_META);
      }
    });
  } catch(e) { log.push('ERROR (Redi Milk): ' + e.message); }

  // ── 5Ways coffee items (F5 Bundaberg Sugar)
  log.push('\n--- 5WAYS (Coffee items) ---');
  try {
    const files = getSortedPdfs(FOLDER_5WAYS, 'TAX INVOICE', cutoff);
    log.push(`${files.length} invoice(s)`);
    const seen = {};
    files.forEach(f => {
      const text  = extractPdfText(f.getId()); if (!text) return;
      const items = parse5WaysLines(text);
      items.forEach(item => {
        FIVEWAYS_COFFEE_MAP.forEach(map => {
          if (!seen[map.cell] && matchesAny(item.itemCode, map.match)) {
            seen[map.cell] = true;
            if (validateAndUpdate(coffeeSheet, map.cell, map.convert(item.unitPrice), map.note, log, COFFEE_CELL_META)) updates++;
          }
        });
      });
    });
  } catch(e) { log.push('ERROR (5Ways/Coffee): ' + e.message); }

  // ── Planetware (H5 Cup Small, H6 Cup Large, H7 Lid)
  log.push('\n--- PLANETWARE ---');
  try {
    const files = getSortedPdfsDeep(FOLDER_PLANETWARE, 'Sales Order', cutoff);
    log.push(`${files.length} invoice(s)`);
    files.forEach(f => {
      const text   = extractPdfText(f.getId()); if (!text) return;
      const prices = parsePlanetwareText(text);
      Object.keys(prices).forEach(cell => {
        const label = cell === 'H5' ? 'Planetware Cup 6oz /1000'
                    : cell === 'H6' ? 'Planetware Cup 12oz Slim /1000'
                    : cell === 'H7' ? 'Planetware Lid 8oz CPLA /1000'
                    : 'Planetware';
        if (validateAndUpdate(coffeeSheet, cell, prices[cell], label, log, COFFEE_CELL_META)) updates++;
      });
    });
  } catch(e) { log.push('ERROR (Planetware): ' + e.message); }

  Logger.log(log.join('\n'));
  return updates;
}

// ─── GMAIL SUPPLIERS ──────────────────────────────────────────────────────────

// PFD Foods — Gmail Sales Order PDFs
function scanPfdFromGmail_(cutoff, log) {
  log.push('\n--- PFD FOODS (Gmail Sales Orders) ---');
  const sheet = SpreadsheetApp.openById(SS_FOOD).getSheetByName(SHEET_FOOD);
  let updates = 0;

  const daysBack = Math.ceil((Date.now() - cutoff.getTime()) / 86400000);
  const query    = `from:${GMAIL_PFD} subject:"Sales Order" has:attachment newer_than:${daysBack}d`;
  let threads;
  try { threads = GmailApp.search(query, 0, 20); }
  catch(e) { log.push('ERROR searching Gmail (PFD): ' + e.message); return 0; }

  if (!threads || threads.length === 0) { log.push('No PFD Sales Order emails found'); return 0; }

  const messages = [];
  threads.forEach(t => t.getMessages().forEach(m => messages.push(m)));
  messages.sort((a, b) => b.getDate() - a.getDate());
  log.push(`${messages.length} email(s)`);

  const needed = {};
  PFD_MAP.forEach(m => { needed[m.cell] = true; });

  for (const msg of messages) {
    if (Object.keys(needed).length === 0) break;
    log.push(`\n${msg.getSubject()} (${msg.getDate().toLocaleDateString('en-AU')})`);

    const pdfBlob = getPdfBlob_(msg); if (!pdfBlob) { log.push('  SKIP: no PDF'); continue; }
    const text    = extractPdfTextFromBlob_(pdfBlob); if (!text) { log.push('  WARN: extraction failed'); continue; }
    const items   = parsePfdSalesOrderText_(text, log);

    items.forEach(item => {
      PFD_MAP.forEach(map => {
        if (!needed[map.cell]) return;
        if (!matchesAny(item.description, map.match)) return;
        const price = map.convert(item.unitPrice, item.uom);
        if (price && price > 0) {
          if (updateIfChanged(sheet, map.cell, price, map.note, log)) updates++;
          delete needed[map.cell];
        }
      });
    });
  }

  if (Object.keys(needed).length > 0)
    log.push('  WARN: prices not found for cells: ' + Object.keys(needed).join(', '));

  return updates;
}

// Trio Supplies (formerly Abicor) — Gmail Tax Invoice PDFs
// ⚠ Run printAbicorInvoiceText() first time to verify line format still matches.
function scanAbicorFromGmail_(log) {
  const cutoff  = new Date(); cutoff.setDate(cutoff.getDate() - ABICOR_DAYS);
  const dateStr = Utilities.formatDate(cutoff, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  const threads = GmailApp.search(`from:${GMAIL_ABICOR} subject:"Invoice from Trio" after:${dateStr}`)
                           .sort((a, b) => b.getLastMessageDate() - a.getLastMessageDate());

  if (threads.length === 0) { log.push('No Trio Supplies invoice emails in last ' + ABICOR_DAYS + ' days'); return 0; }

  const msg = threads[0].getMessages()[0];
  log.push(`  Processing: ${msg.getSubject()} (${msg.getDate()})`);

  const pdfBlob = getPdfBlob_(msg); if (!pdfBlob) { log.push('  No PDF found'); return 0; }
  const text    = extractPdfTextFromBlob_(pdfBlob); if (!text) return 0;

  const sheet       = SpreadsheetApp.openById(SS_FOOD).getSheetByName(SHEET_FOOD);
  const coffeeSheet = SpreadsheetApp.openById(SS_COFFEE).getSheetByName(SHEET_COFFEE);
  let updates = 0;

  // Confirmed format (Apr 2026): "...product desc... GST $ tax $ unitPrice $ extended"
  const blob = text.replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ');
  const re   = /GST\s+\$\s*([\d.]+)\s+\$\s*([\d.]+)\s+\$\s*([\d.]+)/g;
  const items = [];
  let lastEnd = 0, m;
  while ((m = re.exec(blob)) !== null) {
    const unitPrice = parseFloat(m[2]);
    if (unitPrice > 0 && unitPrice < 10000) {
      const desc = blob.substring(lastEnd, m.index).trim();
      if (desc) items.push({ description: desc, unitPrice: unitPrice });
    }
    lastEnd = m.index + m[0].length;
  }
  log.push(`  ${items.length} line(s) parsed`);

  // Food sheet items (Napkins → P8, Trays → P9)
  items.forEach(item => {
    ABICOR_MAP.forEach(map => {
      if (!matchesAny(item.description, map.match)) return;
      const price = map.convert(item.unitPrice);
      if (price > 0 && updateIfChanged(sheet, map.cell, price, map.note, log)) updates++;
    });
  });

  // Coffee sheet items (Paper Straw → H10)
  items.forEach(item => {
    ABICOR_COFFEE_MAP.forEach(map => {
      if (!matchesAny(item.description, map.match)) return;
      const price = map.convert(item.unitPrice);
      if (price > 0 && validateAndUpdate(coffeeSheet, map.cell, price, map.note, log, COFFEE_CELL_META)) updates++;
    });
  });

  // Log unmatched lines for future mapping
  items.forEach(item => {
    if (item.unitPrice <= 0.50) return;
    const inFoodMap   = ABICOR_MAP.some(map => matchesAny(item.description, map.match));
    const inCoffeeMap = ABICOR_COFFEE_MAP.some(map => matchesAny(item.description, map.match));
    if (!inFoodMap && !inCoffeeMap)
      log.push(`  NO MAP: ${item.description.substring(0, 80)} | $${item.unitPrice}`);
  });

  return updates;
}

// Diagnostic: run once to confirm Abicor invoice line formats
function printAbicorInvoiceText() {
  const cutoff  = new Date(); cutoff.setDate(cutoff.getDate() - ABICOR_DAYS);
  const dateStr = Utilities.formatDate(cutoff, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  const threads = GmailApp.search(`from:${GMAIL_ABICOR} subject:invoice after:${dateStr}`);
  if (threads.length === 0) { Logger.log('No Abicor invoice emails found'); return; }
  const msg     = threads[0].getMessages()[0];
  const pdfBlob = getPdfBlob_(msg);
  if (!pdfBlob) { Logger.log('No PDF in: ' + msg.getSubject()); return; }
  Logger.log('Email: ' + msg.getSubject() + ' | ' + msg.getDate());
  Logger.log('--- PDF TEXT ---');
  Logger.log(extractPdfTextFromBlob_(pdfBlob) || '(conversion failed)');
  Logger.log('--- END ---');
}

// ─── PARSERS: COMPLEX SUPPLIERS ───────────────────────────────────────────────

// 5Ways — column-based OCR layout
function parse5WaysLines(text) {
  const items = [];
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim());

  let tcStart = -1, n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^[DRWF]$/.test(lines[i])) {
      if (tcStart === -1) tcStart = i; n++;
    } else if (n >= 3) { break; } else { tcStart = -1; n = 0; }
  }
  if (n < 2) return items;

  const SKIP = {KG:1,CTN:1,TIN:1,BAG:1,PKT:1,JAR:1,DRUM:1,BLK:1,UNIT:1,EACH:1,BTL:1,BOX:1,
                EA:1,PK:1,PCE:1,LTR:1,VIC:1,PTY:1,LTD:1,ABN:1,BSB:1,GST:1,INC:1,REF:1,
                PAGE:1,TAX:1,AND:1,OF:1};
  const codeRe = /^[A-Z][A-Z0-9\/]{1,11}$/;
  let icStart = -1, icLines = [];
  for (let i = tcStart + n + n; i < lines.length; i++) {
    const l = lines[i]; if (!l) continue;
    if (codeRe.test(l) && !SKIP[l]) {
      if (icStart === -1) icStart = i; icLines.push(l);
      if (icLines.length === n) break;
    } else if (icStart !== -1 && l) { icStart = -1; icLines = []; }
  }
  if (icLines.length === 0) return items;

  const priceRe = /^\d{1,6}\.\d{2,4}$/;
  const prLines = [];
  for (let i = icStart + icLines.length; i < lines.length && prLines.length < icLines.length; i++) {
    if (!lines[i]) continue;
    if (priceRe.test(lines[i])) prLines.push(parseFloat(lines[i])); else break;
  }

  for (let i = 0; i < icLines.length; i++) {
    const price = prLines[i] || 0; if (price <= 0) continue;
    items.push({ itemCode: icLines[i], description: icLines[i], unitPrice: price });
  }
  return items;
}

// Sciclunas — Fresho format (OCR collapses to one mega-line)
function parseSciclunasLines(text) {
  const items  = [];
  const joined = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
  const re = /([\d.]+)\s+([A-Z][A-Z0-9]{1,10})\s+(.*?)\s+\$([\d,]+\.?\d*)\s+\$([\d,]+\.?\d*)(?=\s+[\d]|\s*[A-Z][\w]|\s*$)/g;
  let m;
  while ((m = re.exec(joined)) !== null) {
    const unitPrice = parseFloat(m[4].replace(',', ''));
    if (isNaN(unitPrice) || unitPrice <= 0) continue;
    const descAndUnit = m[3].trim();
    if (/back order/i.test(descAndUnit)) continue;
    const unitMatch = descAndUnit.match(/^(.+?)\s+((?:(?:Box|Tray)\s*\([^)]+\))|Kg|Each|Pn|Bunch|Box|Tray|Carton)\s*$/i);
    items.push({
      description: unitMatch ? unitMatch[1].trim() : descAndUnit,
      unit:        unitMatch ? unitMatch[2].trim() : '',
      unitPrice
    });
  }
  return items;
}

// Uncle's — Ordermentum format
function parseUnclesLines(text) {
  const items = [];
  text.replace(/\r/g, '').split('\n').forEach(line => {
    const m = line.trim().match(/^(.+?)\s+\d+\s+[\d.]+kg\s+\$([\d.]+)\s+\$[\d.]+\s*$/i);
    if (m) { const p = parseFloat(m[2]); if (p > 0) items.push({ description: m[1].trim(), unitPrice: p }); }
  });
  return items;
}

// Woolworths — eReceipt format
function parseWoolworthsLines(text) {
  const items = [];
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const clean = lines[i].trim().replace(/^[#^]+/, '').trim();
    let m = clean.match(/^(.+?)\s+Qty\s+\d+\s+@\s+\$([\d.]+)\s+each/i);
    if (m) { const p = parseFloat(m[2]); if (p > 0) { items.push({ description: m[1].trim(), unitPrice: p }); continue; } }
    if (i + 1 < lines.length) {
      const nc = lines[i+1].trim().replace(/^[#^]+/, '').trim();
      const qm = nc.match(/^Qty\s+\d+\s+@\s+\$([\d.]+)\s+each/i);
      if (qm && clean && !/^\d/.test(clean)) {
        const p = parseFloat(qm[1]); if (p > 0) { items.push({ description: clean, unitPrice: p }); i++; continue; }
      }
    }
    m = clean.match(/^(.+?)\s+[\d.]+\s+kg\s+NET\s+@\s+\$([\d.]+)\/kg/i);
    if (m) { const p = parseFloat(m[2]); if (p > 0) items.push({ description: m[1].trim(), unitPrice: p, isPerKg: true }); }
  }
  return items;
}

// Dench Bakers — Xero Tax Invoice: cost = Amount ÷ Qty (discount already applied)
function parseDenchLines(text) {
  const items  = [];
  const lineRe = /^(\S+)\s+(.+?)\s+([\d.]+)\s+[\d.]+\s+[\d.]+%\s+(?:GST Free|10%|GST)\s+([\d.]+)\s*$/;
  text.replace(/\r/g, '').split('\n').forEach(line => {
    const m = lineRe.exec(line.trim());
    if (!m) return;
    const code = m[1], desc = m[2].trim(), qty = parseFloat(m[3]), amount = parseFloat(m[4]);
    if (code === 'DEL' || qty <= 0 || amount <= 0) return;
    const perUnit = r2(amount / qty); if (perUnit <= 0) return;
    items.push({ itemCode: code, description: desc, unitPrice: perUnit });
  });
  return items;
}

// PFD Sales Order — block structure, unit price at nums[1] after "*** end of details ***"
function parsePfdSalesOrderText_(text, log) {
  const items     = [];
  const lines     = text.replace(/\r/g, '').split('\n');
  const END_RE    = /\*{3,}\s*end of details\s*\*{3,}/i;
  const HEADER_RE = /Net\s*Value|G\.S\.T\.|^\(Incl\.|^Value\s*$/i;

  for (let i = 0; i < lines.length; i++) {
    if (!END_RE.test(lines[i])) continue;
    let productLine = '';
    for (let b = i - 1; b >= Math.max(0, i - 6); b--) {
      const bl = lines[b].trim();
      if (bl && !HEADER_RE.test(bl)) { productLine = bl; break; }
    }
    if (!productLine) continue;
    const nums = [];
    for (let j = i + 1; j < lines.length && nums.length < 6; j++) {
      const nl = lines[j].trim(); if (!nl) continue;
      if (END_RE.test(nl)) break;
      const num = parseFloat(nl.replace(',', ''));
      if (!isNaN(num) && num >= 0) nums.push(num); else break;
    }
    if (nums.length < 2) continue;
    const unitPrice = nums[1]; if (unitPrice <= 0 || unitPrice > 10000) continue;
    const uomMatch  = productLine.match(/\b(KG|EA|CTN|UNIT|EACH|PK|PKT|JAR|TIN|BTL|BOX|BG|BAG|CS|CASE)\b/i);
    items.push({ description: productLine, unitPrice, uom: uomMatch ? uomMatch[1].toUpperCase() : '', qty: nums[0] });
  }
  return items;
}

// ─── PARSERS: COFFEE SUPPLIERS ────────────────────────────────────────────────

function parseSevenSeedsText(text) {
  // Strategy v7 (event-based — final, after reading actual older invoices).
  //
  // The previous "anchor + lookahead" approach kept misfiring on real Seven
  // Seeds invoices because product codes use characters my regex wouldn't
  // match (slashes in MTMBO-S/O_1KG, periods/spaces in FIL_PAP-BREW-FLAT_56.50B A,
  // multi-line wraps from OCR, descriptions appearing UNDER the wrong code,
  // codes with descriptions on the same line as the price, etc).
  //
  // New approach: walk the text once, accumulating any non-price text into an
  // "anchor buffer". Each time we hit a price line, emit a `priceEvent` whose
  // anchor text is everything since the last price. The anchor text is GUARANTEED
  // to belong to that product because price lines are the natural boundary
  // between product blocks in this invoice format.
  //
  // Then match each rule to its first qualifying event. No lookahead, no
  // foreign-code regex, no window heuristics — just attribution by position.
  const results = {};
  const lines   = text.replace(/\r/g, '').split('\n').map(l => l.trim());
  const priceRe = /(\d+\.\d{2})\s+(\d+\.\d{2})\s+(?:GST|10%)/i;

  // Strip BOTH whitespace AND hyphens. The OCR consistently splits item codes
  // at hyphen boundaries (e.g. `LA_SER-DECAF-1KG` becomes two lines:
  // `LA_SER` and `DECAF-1KG`), losing the middle hyphen on concatenation.
  // Stripping hyphens during normalisation makes the matching robust to that.
  // Rule patterns are written without hyphens for the same reason.
  function normalize(s) { return s.replace(/[\s\-]+/g, '').toUpperCase(); }

  // Pass 1: build event list. Each event = unit price + anchor text since
  // the previous event (or start of text). Inline anchor (text BEFORE the
  // price on the same line) is included so single-line entries like
  // "GG-BL-250G ... 8.00 11.00 GST Free 88.00" are correctly attributed.
  const events = [];
  let anchorAccum = '';
  for (let i = 0; i < lines.length; i++) {
    const m = priceRe.exec(lines[i]);
    if (m) {
      const matchStart = lines[i].search(priceRe);
      const inline = matchStart > 0 ? lines[i].substring(0, matchStart) : '';
      const anchorText = normalize(anchorAccum + ' ' + inline);
      events.push({ unitPrice: parseFloat(m[2]), anchorText: anchorText });
      anchorAccum = '';
    } else if (lines[i]) {
      anchorAccum += ' ' + lines[i];
    }
  }

  // Rule definitions — hyphenless code form to match the normalised anchor text.
  //   GGBL1KG     ← was GG-BL-1KG
  //   F_BOMBBL3KG ← was F_BOMB-BL-3KG
  //   LA_SERDECAF1KG ← was LA_SER-DECAF-1KG
  //   etc. Sizes (1KG/3KG/250G) preserved so variants stay distinguishable.
  // 3KG variants accepted with /3 conversion (same per-kg cost as 1KG).
  const rules = [
    { has: ['GGBL1KG'],                                          not: ['GGBL3KG', 'GGBL250G'],          cell: 'B5' },
    { has: ['GGBL3KG'],                                          not: ['GGBL1KG', 'GGBL250G'],          cell: 'B5', convert: p => r2(p / 3) },
    { has: ['CHAIFH6X1L'],                                       not: [],                               cell: 'B7', convert: p => r2(p / 6) },
    { has: ['F_BOMBBL1KG'],                                      not: ['F_BOMBBL3KG', 'F_BOMBBL250G'],  cell: 'B8' },
    { has: ['F_BOMBBL3KG'],                                      not: ['F_BOMBBL1KG', 'F_BOMBBL250G'],  cell: 'B8', convert: p => r2(p / 3) },
    { has: ['LA_SERDECAF1KG', 'DECAFBL1KG', 'COLOMBIADECAF1KG'], not: ['LA_SERDECAF3KG', 'DECAFBL3KG', 'COLOMBIADECAF3KG'], cell: 'B9' },
    { has: ['LA_SERDECAF3KG', 'DECAFBL3KG', 'COLOMBIADECAF3KG'], not: ['LA_SERDECAF1KG', 'DECAFBL1KG', 'COLOMBIADECAF1KG'], cell: 'B9', convert: p => r2(p / 3) },
  ];

  // Auto-build cross-cell exclusions. Any event whose anchor contains a code
  // belonging to a DIFFERENT tracked cell is ambiguous — usually because the
  // OCR dumped multiple item codes into a header section before any prices.
  // Match a rule against an ambiguous event and you'd attribute the price of
  // ONE product to ALL the codes that appeared in the dump.
  rules.forEach(r => {
    r.autoExclude = rules
      .filter(other => other.cell !== r.cell)
      .flatMap(other => other.has);
  });

  // Pass 2: match each rule to its first qualifying, unambiguous event.
  for (const rule of rules) {
    for (const ev of events) {
      if (!rule.has.some(h => ev.anchorText.includes(h))) continue;
      if (rule.not.some(bad => ev.anchorText.includes(bad))) continue;
      if (rule.autoExclude.some(other => ev.anchorText.includes(other))) continue;
      results[rule.cell] = rule.convert ? rule.convert(ev.unitPrice) : ev.unitPrice;
      break;
    }
  }
  return results;
}

function parseMorkText(text) {
  const results = {};
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const up = line.toUpperCase();
    if (up.includes('DARK') && (up.includes('JUNIOR') || up.includes('CHOCOLATE') || up.includes('50%'))) {
      const m = line.match(/\$(\d+\.\d{2})/); if (m) { results['B6'] = parseFloat(m[1]); break; }
    }
  }
  return results;
}

function parseMatsuText(text) {
  const results = {};
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const up = line.toUpperCase();
    if (up.includes('MATCHA') && up.includes('500')) {
      const m = line.match(/\$(\d+\.\d{2})/); if (m) { results['B10'] = parseFloat(m[1]); break; }
    }
  }
  return results;
}

function parsePlanetwareText(text) {
  // Invoice format (single-line OCR collapse):
  //   QTY  ITEMCODE  DESCRIPTION  / 1000  UNITPRICE  LINETOTAL  GSTAMOUNT
  // We anchor on the item code, then capture the first decimal after "/ 1000".
  const results = {};
  const items = [
    { code: 'PW6WPC-GDT',   cell: 'H5', alt: '6OZ COMPOSTABLE' },
    { code: 'PW12WPCS-GDT', cell: 'H6', alt: '12OZ SLIM' },
    { code: 'PWHL6812',     cell: 'H7', alt: '8OZ CPLA' },
  ];
  const upper = text.toUpperCase();
  for (const item of items) {
    let idx = upper.indexOf(item.code);
    if (idx === -1) idx = upper.indexOf(item.alt);
    if (idx === -1) continue;
    const window = text.substring(idx, idx + 300);
    const m = window.match(/\/\s*1000\s+(\d+\.\d{2})/);
    if (m) results[item.cell] = parseFloat(m[1]);
  }
  return results;
}

function parseRediMilkText(text) {
  // Redi Milk invoice rows look like:
  //   <supplier_id> <unit> <PRODUCT> [(pack)] <qty> <qty> [<sc%>] <unit_price> <line_total>
  // After PDF OCR all rows are concatenated onto one line. Approach:
  //   1. Locate the keyword (product name)
  //   2. Bound the row at the NEXT "<int> <int>(LT|KG|ML)" marker (= start of next row)
  //   3. Within the bounded segment, the SECOND-TO-LAST decimal is the unit price
  //      (last is the line total). This handles all 3 layouts cleanly:
  //         Alt.Dairy:  [unit, total]                   → second-to-last = unit  ✓
  //         Sungold:    [sc%, unit, total]              → second-to-last = unit  ✓
  //         Happy Soy:  [unit, total]                   → second-to-last = unit  ✓
  const results = {};
  const blob    = text.replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ');

  function findUnitPrice(keyword) {
    const idx = blob.toUpperCase().indexOf(keyword.toUpperCase());
    if (idx === -1) return null;
    const after = blob.substring(idx + keyword.length);
    // Stop at start of next product row OR at end-of-products markers
    // (Fuel Levy / Total / GST Value lines). Without this, the last product
    // (e.g. Happy Soy) would bleed into Fuel Levy decimals.
    const stop = after.match(/\s\d+\s+\d+(LT|KG|ML|GM)\b|FUEL\s*LEVY|TOTAL\s*FOR|GST\s*VALUE/i);
    const endIdx = stop ? stop.index : Math.min(after.length, 100);
    const segment = after.substring(0, endIdx);
    const nums = segment.match(/\d+\.\d{2}/g);
    if (!nums || nums.length === 0) return null;
    return nums.length >= 2
      ? parseFloat(nums[nums.length - 2])
      : parseFloat(nums[0]);
  }

  let p;
  p = findUnitPrice('SUNGOLD JERSEY');     if (p) results['D5'] = p;
  p = findUnitPrice('SUNGOLD LOWFAT');     if (p) results['D6'] = p;
  p = findUnitPrice('HAPPY HAPPY SOY');    if (p) results['D7'] = p;
  p = findUnitPrice('ALT.DAIRY.CO OAT');   if (p) results['D8'] = p;
  p = findUnitPrice('ALT.DAIRY.CO ALMOND');if (p) results['D9'] = p;
  return results;
}

// ─── CELL UPDATERS ────────────────────────────────────────────────────────────

// validateAndUpdate — wraps updateIfChanged with two defensive layers:
//   1. Sanity range check (block captured prices outside expected min/max)
//   2. Drift tracking (mark cell as "last seen" on successful update)
// Pass the relevant meta table (COFFEE_CELL_META or FOOD_CELL_META).
// Cells without metadata fall through to plain updateIfChanged (backwards compat).
function validateAndUpdate(sheet, cell, newPrice, label, log, meta) {
  // Layer 1: guard — reject prices outside expected range
  if (newPrice !== null && !isNaN(newPrice) && newPrice > 0 && meta && meta[cell]) {
    const m = meta[cell];
    if (newPrice < m.min || newPrice > m.max) {
      if (log) log.push(`  ⚠ GUARD ${cell} [${m.label}]: $${newPrice} outside expected $${m.min}-$${m.max} — NOT written`);
      return false;
    }
  }
  // Layer 2: drift tracking — stamp lastSeen on ANY successful in-range capture,
  // even if the cell value didn't change. The signal we want is "did an invoice
  // mention this item recently?", NOT "did the price move?". Stable prices that
  // are unchanged for weeks should NOT trigger drift warnings.
  if (newPrice !== null && !isNaN(newPrice) && newPrice > 0) {
    markCellSeen_(cell);
  }
  return updateIfChanged(sheet, cell, newPrice, label, log);
}

// Drift tracking: stamp cell with current time on successful update.
function markCellSeen_(cell) {
  PropertiesService.getScriptProperties().setProperty(`lastSeen.${cell}`, Date.now().toString());
}

// Maps tracked sheet cells to ingredient keys used by SyncIngredientPrices.gs.
// Used by the TIGEROS Supplier Prices widget to render drift badges on the
// matching ingredient card. Cells with no obvious match are null — they still
// appear in the drift JSON for future use, just without a visual badge.
const CELL_TO_INGREDIENT_KEY = {
  // COFFEE sheet
  B5:  'coffee_beans',   // GG Espresso 1KG (Seven Seeds)
  B6:  'chocolate',      // Mörk Dark Chocolate 1KG
  B7:  'chai',           // Seven Seeds Chai
  B8:  'coffee_beans',   // F.Bomb 1KG (Seven Seeds) — same coffee_beans ingredient
  B9:  'decaf_beans',    // Decaf 1KG (Seven Seeds)
  B10: null,             // Matsu Matcha 500G — no ingredient key yet
  D5:  null,             // Sungold Jersey 2LT (coffee sheet, separate from R12)
  D6:  null,             // Sungold Lowfat 2LT
  D7:  'soy_milk_6l',    // Happy Soy 1L
  D8:  'oat_milk_2l',    // Alt.Dairy.Co Oat (same oat_milk_2l ingredient)
  D9:  'oat_milk_2l',    // Alt.Dairy.Co Almond
  F5:  'brown_sugar',    // Bundaberg Raw Sugar 15KG (also used by coffee sheet)
  H5:  'cup_medium',     // Cup 6oz /1000
  H6:  'cup_large',      // Cup 12oz /1000
  H7:  'lid_standard',   // Hot Lid /1000
  H9:  null,             // Sipper Lid (cold drinks only, not in ingredient list)
  H10: 'straw',          // Paper Straw 2500
  // FOOD sheet
  R12: 'sungold_milk',   // Sungold FC 2LT (cross-write target)
  R15: null,             // Pinenuts 1KG — no ingredient key yet
};

// Compute severity tier from days-stale vs expected refresh window.
function driftSeverity_(daysStale, refreshDays) {
  if (daysStale >= refreshDays * 2) return 'red';
  if (daysStale >= refreshDays * 1.5) return 'amber';
  return 'yellow'; // just past expected refresh
}

// checkPriceDrift — diagnostic. Run from Apps Script editor anytime OR via
// syncDriftToNotion() on a weekly trigger. Flags cells that haven't been
// updated in longer than their refreshDays window. Most common cause: supplier
// renamed the SKU and the parser silently stopped matching.
//
// Returns structured warnings array:
//   [{ cell, label, daysStale, refreshDays, severity, ingredientKey, neverSeen }]
// severity is one of: 'yellow' (just over), 'amber' (1.5×), 'red' (2×+).
// neverSeen=true means no successful invoice capture has ever stamped this cell.
function checkPriceDrift() {
  const props = PropertiesService.getScriptProperties();
  const now   = Date.now();
  const warnings = [];

  const allMeta = Object.assign({}, COFFEE_CELL_META, FOOD_CELL_META);
  for (const cell in allMeta) {
    const m = allMeta[cell];
    if (m.manual) continue;  // cell is maintained manually — skip drift check
    const seenStr = props.getProperty(`lastSeen.${cell}`);
    const ingredientKey = CELL_TO_INGREDIENT_KEY[cell] || null;

    if (!seenStr) {
      warnings.push({
        cell: cell,
        label: m.label,
        daysStale: null,
        refreshDays: m.refreshDays,
        severity: 'red',
        ingredientKey: ingredientKey,
        neverSeen: true,
      });
      continue;
    }
    const ageDays = Math.round((now - parseInt(seenStr)) / (1000 * 60 * 60 * 24));
    if (ageDays > m.refreshDays) {
      warnings.push({
        cell: cell,
        label: m.label,
        daysStale: ageDays,
        refreshDays: m.refreshDays,
        severity: driftSeverity_(ageDays, m.refreshDays),
        ingredientKey: ingredientKey,
        neverSeen: false,
      });
    }
  }

  // Preserve existing log output for backwards compat and Apps Script editor use.
  if (warnings.length === 0) {
    Logger.log(`Price drift check: OK — all ${Object.keys(allMeta).length} tracked cells within refresh windows.`);
  } else {
    const lines = warnings.map(function(w) {
      if (w.neverSeen) return `${w.cell} [${w.label}]: NEVER updated by scanner (manual entry only?)`;
      return `${w.cell} [${w.label}]: ${w.daysStale}d stale (expected refresh within ${w.refreshDays}d, severity=${w.severity}) — supplier may have renamed SKU`;
    });
    Logger.log('Price drift check: ' + warnings.length + ' warning(s):\n  ' + lines.join('\n  '));
  }
  return warnings;
}

// ─── PRICE DRIFT → NOTION SYNC ────────────────────────────────────────────────
// Writes the structured output of checkPriceDrift() to the TIGEROS Notion OS
// page as a JSON code block tagged `price_drift_warnings`. The TIGEROS widget
// reads this block via /api/price-drift and renders inline badges on the
// affected ingredient cards. Same chunked-rich_text pattern as
// SyncIngredientPrices.gs.
//
// Constants reused via Apps Script's flat namespace:
//   SIP_NOTION_API_KEY, SIP_NOTION_PAGE_ID  (defined in SyncIngredientPrices.gs)

function syncDriftToNotion() {
  const warnings = checkPriceDrift();
  const payload = {
    type: 'price_drift_warnings',
    updated: new Date().toISOString(),
    warnings: warnings,
  };
  driftWriteToNotion_(payload);
  Logger.log('Drift warnings synced to Notion: ' + warnings.length + ' warning(s).');
}

function driftWriteToNotion_(payload) {
  const json = JSON.stringify(payload);
  const headers = {
    'Authorization': 'Bearer ' + SIP_NOTION_API_KEY,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  // Find existing price_drift_warnings block on the page.
  let allBlocks = [];
  let cursor = null;
  do {
    let url = 'https://api.notion.com/v1/blocks/' + SIP_NOTION_PAGE_ID + '/children?page_size=100';
    if (cursor) url += '&start_cursor=' + cursor;
    const res  = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());
    allBlocks  = allBlocks.concat(data.results || []);
    cursor     = data.has_more ? data.next_cursor : null;
  } while (cursor);

  const existingBlock = allBlocks.find(function(b) {
    if (b.type !== 'code') return false;
    const text = (b.code && b.code.rich_text || []).map(function(r) { return r.plain_text; }).join('');
    return text.indexOf('"price_drift_warnings"') !== -1;
  });

  // Same 2000-char rich_text chunking as ingredient_prices.
  const chunks = [];
  for (let i = 0; i < json.length; i += 1900) {
    chunks.push({ type: 'text', text: { content: json.slice(i, i + 1900) } });
  }

  const blockBody = JSON.stringify({
    type: 'code',
    code: {
      language: 'json',
      rich_text: chunks,
    },
  });

  if (existingBlock) {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + existingBlock.id, {
      method: 'PATCH',
      headers: headers,
      payload: blockBody,
      muteHttpExceptions: true,
    });
  } else {
    UrlFetchApp.fetch('https://api.notion.com/v1/blocks/' + SIP_NOTION_PAGE_ID + '/children', {
      method: 'PATCH',
      headers: headers,
      payload: JSON.stringify({ children: [JSON.parse(blockBody)] }),
      muteHttpExceptions: true,
    });
  }
}

// Run once to set up the weekly drift sync (Mondays ~7am).
function createDriftSyncTrigger() {
  ScriptApp.newTrigger('syncDriftToNotion')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(7)
    .create();
  Logger.log('Weekly drift sync trigger created (Mondays 7am).');
}

// updateIfChanged — writes to a specific cell address in a known sheet
function updateIfChanged(sheet, cell, newPrice, label, log) {
  if (newPrice === null || isNaN(newPrice) || newPrice <= 0) {
    if (log) log.push(`  SKIP ${cell} [${label}]: invalid price (${newPrice})`);
    return false;
  }
  const current = parseFloat(sheet.getRange(cell).getValue()) || 0;
  if (Math.abs(current - newPrice) < 0.005) return false;
  sheet.getRange(cell).setValue(newPrice).setNumberFormat('$#,##0.00');
  SpreadsheetApp.flush();
  if (log) log.push(`  ✔ ${cell} [${label}]: $${current} → $${newPrice}`);
  return true;
}

// updateSheetPrice_ — searches BOTH sheets by label text (used for newer/simpler suppliers)
// Updates ALL matching rows (handles same ingredient appearing in Food + Coffee sheets).
function updateSheetPrice_(searchText, newPrice, label, log) {
  const upper = searchText.toUpperCase();
  let updated = false;

  for (const ssId of [SS_FOOD, SS_COFFEE]) {
    try {
      const ss     = SpreadsheetApp.openById(ssId);
      const ssName = ss.getName();
      for (const sheet of ss.getSheets()) {
        const data = sheet.getDataRange().getValues();
        for (let r = 0; r < data.length; r++) {
          for (let c = 0; c < data[r].length; c++) {
            if (!String(data[r][c]).toUpperCase().includes(upper)) continue;
            for (let pc = c + 1; pc < data[r].length; pc++) {
              const val = data[r][pc];
              if (typeof val !== 'number' || val <= 0) continue;
              if (Math.abs(val - newPrice) < 0.02) {
                if (log) log.push(`  [${label}] unchanged at $${newPrice} (${ssName} › ${sheet.getName()})`);
              } else {
                if (log) log.push(`  [${label}] $${val} → $${newPrice} (${ssName} › ${sheet.getName()}, R${r+1}C${pc+1})`);
                sheet.getRange(r + 1, pc + 1).setValue(newPrice);
                SpreadsheetApp.flush();
                updated = true;
              }
              break; // first number in row after label = the price cell
            }
          }
        }
      }
    } catch(e) {
      if (log) log.push(`  [${label}] error searching ${ssId}: ${e}`);
    }
  }

  if (!updated && log) log.push(`  [${label}] "${searchText}" not found in either spreadsheet`);
  return updated;
}

// ─── PDF EXTRACTION ───────────────────────────────────────────────────────────

// Extract text from a Drive PDF (converts to temporary Google Doc, reads, deletes)
function extractPdfText(fileId) {
  let tmp;
  try {
    Utilities.sleep(1500); // throttle OCR — avoids Drive rate-limit errors
    tmp = Drive.Files.copy(
      { title: '_tmp_scan_' + fileId, mimeType: 'application/vnd.google-apps.document' },
      fileId
    );
    return DocumentApp.openById(tmp.id).getBody().getText();
  } catch(e) {
    Logger.log('extractPdfText failed for ' + fileId + ': ' + e.message);
    return '';
  } finally {
    if (tmp && tmp.id) try { Drive.Files.remove(tmp.id); } catch(e2) {}
  }
}

// Extract text from a Gmail PDF blob
function extractPdfTextFromBlob_(blob) {
  let tempId = null, docId = null;
  try {
    blob.setName('_tmp_scan_' + Date.now() + '.pdf');
    const tempFile = DriveApp.createFile(blob);
    tempId = tempFile.getId();
    const converted = Drive.Files.copy(
      { title: '_tmp_scan_doc_' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
      tempId, { ocr: true, ocrLanguage: 'en' }
    );
    docId = converted.id;
    return DocumentApp.openById(docId).getBody().getText();
  } catch(e) {
    Logger.log('extractPdfTextFromBlob_ error: ' + e.message);
    return '';
  } finally {
    if (tempId) try { Drive.Files.remove(tempId); } catch(e2) {}
    if (docId)  try { Drive.Files.remove(docId);  } catch(e2) {}
  }
}

// Get first PDF blob from a Gmail message
function getPdfBlob_(message) {
  const atts = message.getAttachments();
  const att  = atts.find(a => a.getContentType() === 'application/pdf' ||
                               a.getContentType() === 'application/octet-stream' ||
                               a.getName().toLowerCase().endsWith('.pdf'));
  return att ? att.copyBlob() : null;
}

// ─── EXTRACT HELPERS (simple Drive suppliers) ─────────────────────────────────

function firstDecimal_(text, anchorPattern) {
  const m = text.match(new RegExp(anchorPattern.source + '[\\s\\S]*?(\\d+\\.\\d{2})', anchorPattern.flags));
  return m ? parseFloat(m[1]) : null;
}

function threeDecimalMiddle_(text, anchorPattern) {
  const m = text.match(new RegExp(
    anchorPattern.source + '[\\s\\S]*?(\\d+\\.\\d{2})\\s+(\\d+\\.\\d{2})\\s+(\\d+\\.\\d{2})',
    anchorPattern.flags
  ));
  return m ? parseFloat(m[2]) : null;
}

function isValidPrice_(price) {
  return price !== null && !isNaN(price) && price > 0;
}

// ─── SHARED HELPERS ───────────────────────────────────────────────────────────

function r2(n) { return Math.round(n * 100) / 100; }

function matchesAny(text, keywords) {
  const up = (text || '').toUpperCase();
  return keywords.some(k => up.includes(k.toUpperCase()));
}

// ─── SCAN HISTORY ─────────────────────────────────────────────────────────────

function getLastScanTime() {
  const stored = PropertiesService.getScriptProperties().getProperty('invoiceLastScan');
  if (!stored) {
    const d = new Date(); d.setDate(d.getDate() - FALLBACK_DAYS); return d;
  }
  return new Date(parseInt(stored));
}

function setLastScanTime() {
  PropertiesService.getScriptProperties().setProperty('invoiceLastScan', Date.now().toString());
}

function resetScanHistory() {
  PropertiesService.getScriptProperties().deleteProperty('invoiceLastScan');
  Logger.log('Scan history reset — next run will process last ' + FALLBACK_DAYS + ' days.');
}

// ─── DRIVE HELPERS ────────────────────────────────────────────────────────────

// Get PDFs from a folder ID, sorted oldest→newest (so latest invoice wins on duplicate)
function getSortedPdfs(folderId, nameFilter, cutoff) {
  const folder  = DriveApp.getFolderById(folderId);
  const iter    = folder.getFilesByType('application/pdf');
  const bucket  = [];
  while (iter.hasNext()) {
    const f = iter.next();
    if (f.getLastUpdated() < cutoff) continue;
    if (nameFilter && !f.getName().includes(nameFilter)) continue;
    bucket.push(f);
  }
  bucket.sort((a, b) => a.getLastUpdated() - b.getLastUpdated());
  return bucket;
}

// Same as getSortedPdfs but recurses one level into subfolders.
// Use this for suppliers saved via SaveInvoicesToDrive (year-subfolder structure).
function getSortedPdfsDeep(folderId, nameFilter, cutoff) {
  const root   = DriveApp.getFolderById(folderId);
  const bucket = [];

  function collectFrom(folder) {
    const files = folder.getFilesByType('application/pdf');
    while (files.hasNext()) {
      const f = files.next();
      if (f.getLastUpdated() < cutoff) continue;
      if (nameFilter && !f.getName().includes(nameFilter)) continue;
      bucket.push(f);
    }
  }

  collectFrom(root);
  const subs = root.getFolders();
  while (subs.hasNext()) collectFrom(subs.next());

  bucket.sort((a, b) => a.getLastUpdated() - b.getLastUpdated());
  return bucket;
}

// Get PDFs from a folder object (for newer suppliers using folder names)
function getRecentPDFs_(folder, cutoff) {
  const results = [];
  const files   = folder.getFilesByType(MimeType.PDF);
  while (files.hasNext()) { const f = files.next(); if (f.getLastUpdated() >= cutoff) results.push(f); }
  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const sub = subs.next(); const sf = sub.getFilesByType(MimeType.PDF);
    while (sf.hasNext()) { const f = sf.next(); if (f.getLastUpdated() >= cutoff) results.push(f); }
  }
  return results;
}

function getDriveFolder_(name) {
  const f = DriveApp.getFoldersByName(name); return f.hasNext() ? f.next() : null;
}

function getFolderByName_(parent, name) {
  const f = parent.getFoldersByName(name); return f.hasNext() ? f.next() : null;
}

// ─── TRIGGER SETUP ────────────────────────────────────────────────────────────
// Run createScanTrigger() once. Deletes any existing scanAllSuppliers / scanInvoices
// / scanAllInvoices triggers first, so it's safe to re-run.

function createScanTrigger() {
  const toRemove = ['scanAllSuppliers', 'scanInvoices', 'scanAllInvoices', 'scanCoffeeInvoices'];
  ScriptApp.getProjectTriggers()
    .filter(t => toRemove.includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('scanAllSuppliers').timeBased().everyHours(1).create();
  Logger.log('Trigger created: scanAllSuppliers runs every hour.');
}

// ─── SHEET SETUP ──────────────────────────────────────────────────────────────
// Run addCandiedBakeryPriceRows() ONCE to add new bakery items to FOOD price table.
// ⚠ Confirm B9, B10, B11 are empty in column B before running.
// ⚠ Uncomment Brownie Slab extractor in SIMPLE_DRIVE_SUPPLIERS once pricing unit confirmed.

function addCandiedBakeryPriceRows() {
  const ss     = SpreadsheetApp.openById(SS_FOOD);
  const sheets = ss.getSheets();
  let sheet    = null;
  for (const s of sheets) {
    const data = s.getDataRange().getValues();
    if (data.some(row => row.some(cell => String(cell).toUpperCase().includes('DENCH SOURDOUGH')))) {
      sheet = s; break;
    }
  }
  if (!sheet) { Logger.log('ERROR: Could not find FOOD price table sheet (searched for DENCH SOURDOUGH)'); return; }

  sheet.getRange('B9').setValue('CHOC MARSHMALLOW COOKIE (UNIT) (B9)');
  sheet.getRange('B10').setValue('BROWNIE SLAB (UNIT) (B10)');
  sheet.getRange('B11').setValue('CANDIED PIE (UNIT) (B11)');
  SpreadsheetApp.flush();
  Logger.log(`Rows added to "${sheet.getName()}": B9 Choc Marshmallow, B10 Brownie Slab, B11 Candied Pie`);
  Logger.log('Prices blank — scanner will populate on next Candied Bakery invoice.');
}

// ─── DIAGNOSTICS ──────────────────────────────────────────────────────────────

function debugSheetLabels() {
  const targets = [
    'ALTERNATIVE DAIRY', 'HAPPY HAPPY SOY', 'SUNGOLD',
    'GOLDEN GATE', 'F BOMB', 'JNR DARK', 'MORK', 'MÖRK',
    'NAPKIN', 'WHITE/BROWN TRAY', 'CIABATTA', 'SAUERKRAUT',
    'CHICKEN', 'MCLURES', 'CROISSANT', 'CHOC MARSHMALLOW', 'BROWNIE', 'CANDIED PIE'
  ];
  for (const ssId of [SS_FOOD, SS_COFFEE]) {
    const ss = SpreadsheetApp.openById(ssId);
    Logger.log(`\n=== ${ss.getName()} ===`);
    Logger.log('Sheets: ' + ss.getSheets().map(s => s.getName()).join(', '));
    for (const sheet of ss.getSheets()) {
      const data = sheet.getDataRange().getValues();
      for (let r = 0; r < data.length; r++) {
        for (let c = 0; c < data[r].length; c++) {
          const val = String(data[r][c]).toUpperCase();
          for (const t of targets) {
            if (val.includes(t.toUpperCase()))
              Logger.log(`  FOUND [${sheet.getName()} R${r+1}C${c+1}] "${data[r][c]}"`);
          }
        }
      }
    }
  }
  Logger.log('\nSearch complete.');
}

// ─── SQUARE → SPREADSHEET RETAIL PRICE SYNC ──────────────────────────────────
// Pulls live retail prices from Square and writes to FOOD sheet "Retail Price" rows.
// Run syncSquarePricesToSheet() manually or set a separate trigger.
//
// SETUP: Project Settings → Script Properties → SQUARE_ACCESS_TOKEN = <token>

const SQUARE_MODIFIER_LIST_ID = 'EOKJLY2L367QS3OAPDLTTA4F';

const SQUARE_RETAIL_MAP = [
  { recipe: 'H+C CROISSANT',                   squareItem: 'Filled Croissant', variation: null, modifier: null,            cell: 'F60'  },
  { recipe: 'H+C SANDWICH',                    squareItem: 'H+C',              variation: null, modifier: null,            cell: 'F114' },
  { recipe: 'H+C SANDWICH (TIGER STYLE)',       squareItem: 'H+C',              variation: null, modifier: 'TIGER STYLE',  cell: 'F140' },
  { recipe: 'CAPONATA SANDWICH',               squareItem: 'Caponata',         variation: null, modifier: null,            cell: 'F167' },
  { recipe: 'CAPONATA SANDWICH (WITH CHEESE)',  squareItem: 'Caponata',         variation: null, modifier: 'Add Cheese',   cell: 'F195' },
  { recipe: 'MUSHROOM SANDWICH',               squareItem: 'Mushroom',         variation: null, modifier: null,            cell: 'F223' },
  { recipe: 'TUNA SANDWICH',                   squareItem: 'Tuna',             variation: null, modifier: null,            cell: 'F251' },
  { recipe: 'SALAMI PANINI',                   squareItem: 'Autogrill',        variation: 'Salami', modifier: null,        cell: 'F88'  },
  { recipe: 'CHICKEN SCHNITTA',                squareItem: 'Schnitta',         variation: null, modifier: null,            cell: 'F307' },
  { recipe: 'BEEF SANDWICH',                   squareItem: 'Beef',             variation: null, modifier: null,            cell: 'F279' },
  { recipe: 'BANANA BREAD',                    squareItem: 'Banana Bread',     variation: null, modifier: null,            cell: 'F333' },
];

function syncSquarePricesToSheet() {
  const token = PropertiesService.getScriptProperties().getProperty('SQUARE_ACCESS_TOKEN');
  if (!token) { Logger.log('ERROR: SQUARE_ACCESS_TOKEN not set in Script Properties.'); return; }

  const ss    = SpreadsheetApp.openById(SS_FOOD);
  const sheet = ss.getSheetByName(SHEET_FOOD);
  if (!sheet) { Logger.log('ERROR: FOOD sheet not found'); return; }

  const log = ['=== syncSquarePricesToSheet() ' + new Date().toISOString() + ' ==='];

  const items          = squareFetchAllItems_(token, log);    if (!items) { Logger.log(log.join('\n')); return; }
  const modifierPrices = squareFetchModifierPrices_(token, SQUARE_MODIFIER_LIST_ID, log);
  log.push(`Fetched ${items.length} catalog items, ${Object.keys(modifierPrices).length} modifiers`);

  SQUARE_RETAIL_MAP.forEach(map => {
    try {
      const item = squareFindItem_(items, map.squareItem);
      if (!item) { log.push(`WARN: Square item not found for "${map.recipe}"`); return; }

      const baseCents = squareGetVariationPrice_(item, map.variation);
      if (baseCents === null) { log.push(`WARN: No variation price for "${map.recipe}"`); return; }

      let totalCents = baseCents;
      if (map.modifier) {
        const modKey = map.modifier.toUpperCase();
        let resolvedKey = (modKey in modifierPrices) ? modKey : null;
        if (!resolvedKey) {
          for (const k in modifierPrices) { if (k.indexOf(modKey) === 0) { resolvedKey = k; break; } }
        }
        if (!resolvedKey) { log.push(`WARN: Modifier "${map.modifier}" not found for "${map.recipe}"`); return; }
        totalCents += modifierPrices[resolvedKey];
      }

      updateIfChanged(sheet, map.cell, r2(totalCents / 100), 'Square: ' + map.recipe, log);
    } catch(e) { log.push('ERROR processing "' + map.recipe + '": ' + e.message); }
  });

  Logger.log(log.join('\n'));
}

function squareFetchAllItems_(token, log) {
  const items = []; let cursor = null;
  for (let page = 0; page < 10; page++) {
    const payload = { object_types: ['ITEM'], include_deleted_objects: false };
    if (cursor) payload.cursor = cursor;
    const resp = UrlFetchApp.fetch('https://connect.squareup.com/v2/catalog/search', {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token, 'Square-Version': '2024-01-18' },
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      log.push('ERROR: Square catalog/search HTTP ' + resp.getResponseCode()); return null;
    }
    const data = JSON.parse(resp.getContentText());
    if (data.objects) data.objects.forEach(o => items.push(o));
    if (data.cursor) { cursor = data.cursor; } else { break; }
  }
  return items;
}

function squareFetchModifierPrices_(token, modifierListId, log) {
  const prices = {};
  const resp   = UrlFetchApp.fetch(`https://connect.squareup.com/v2/catalog/object/${modifierListId}`, {
    headers: { 'Authorization': 'Bearer ' + token, 'Square-Version': '2024-01-18' },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) { log.push('WARN: Could not fetch modifier list'); return prices; }
  const data = JSON.parse(resp.getContentText());
  const mods = (data.object && data.object.modifier_list_data && data.object.modifier_list_data.modifiers) || [];
  mods.forEach(mod => {
    const name  = (mod.modifier_data && mod.modifier_data.name || '').toUpperCase();
    const cents = mod.modifier_data && mod.modifier_data.price_money && mod.modifier_data.price_money.amount || 0;
    if (name) prices[name] = cents;
  });
  return prices;
}

function squareFindItem_(items, squareItem) {
  const target = squareItem.toUpperCase();
  return items.find(obj => {
    const name = (obj.item_data && obj.item_data.name || '').toUpperCase();
    return name.includes(target) || target.includes(name);
  }) || null;
}

function squareGetVariationPrice_(item, variationName) {
  const variations = (item.item_data && item.item_data.variations) || [];
  if (variations.length === 0) return null;
  let variation;
  if (variationName) {
    variation = variations.find(v => {
      const name = (v.item_variation_data && v.item_variation_data.name || '').toUpperCase();
      return name.includes(variationName.toUpperCase());
    });
  }
  variation = variation || variations[0];
  const pm = variation && variation.item_variation_data && variation.item_variation_data.price_money;
  return pm ? pm.amount : null;
}