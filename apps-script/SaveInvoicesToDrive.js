/**
 * G'DAY TIGER — Auto-Save Supplier Invoices to Google Drive
 *
 * Watches Gmail for invoices from known suppliers and saves PDF attachments
 * to a structured folder in Google Drive. Runs hourly.
 *
 * SETUP:
 * 1. Paste this into the Apps Script project (same project as ScanSuppliers.gs)
 * 2. Click Run → savePDFsToDrive (first run — authorise permissions when prompted)
 * 3. Run createSaveToDriveTrigger() once to set up the hourly trigger
 *
 * BACKFILL: To catch older invoices, temporarily increase DAYS_TO_LOOK_BACK to 90
 * and run once manually, then set it back to 7.
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────

const STD_ROOT_FOLDER_NAME    = "Supplier Invoices";
const STD_PROCESSED_LABEL     = "invoice-saved";
const STD_DAYS_TO_LOOK_BACK   = 7;
const STD_FOOD_SPREADSHEET_ID = "1nZvWNFaQTrJAt-ilYihZjYZKBzHd6x3qIrjFhdNQqAU";
const STD_FOOD_SHEET_NAME     = "FOOD";

// ─── ORDERMENTUM SUPPLIERS ─────────────────────────────────────────────────
// These suppliers send order confirmations via Ordermentum (no PDF attachment).
// The script converts the email body to a PDF and saves it to Drive.
// priceRules: optional — extracts item prices and updates the Food spreadsheet.
//   keywords:   match the item line (case-insensitive)
//   sheetSearch: text to find in the spreadsheet to locate the price cell
//   priceType:  "per_kg" = 3rd dollar amount after item name (Name|Qty|Weight|Price|Total)
//               "per_unit" = 1st dollar amount after item name (Name|Qty|Price|Total)

const ORDERMENTUM_SUPPLIERS = [
  {
    name: "Assembly",
    query: "from:notifications@ordermentum.com subject:\"Assembly Store\"",
    // Teas not yet in costings spreadsheet — no price rules
    priceRules: []
  },
  {
    name: "Uncles Smallgoods",
    query: "from:notifications@ordermentum.com subject:\"Uncles Smallgoods\"",
    priceRules: [
      { keywords: ["pastrami"], sheetSearch: "UNCLES BEEF PASTRAMI", priceType: "per_kg" }
    ]
  },
];

// ─── SUPPLIERS ─────────────────────────────────────────────────────────────
// Each entry needs a display name and a Gmail search query.
// For suppliers whose invoices you forward to yourself, the query targets
// your own sent/received mail with the relevant subject keywords.

const SUPPLIERS = [

  // ── Regular invoice emails ──────────────────────────────────────────────

  {
    name: "Noisette",
    query: "from:(orders@noisette.com.au OR billings@noisette.com.au) has:attachment filename:pdf"
  },
  {
    name: "PFD Foods",
    query: "from:ar@pfdfoods.com.au has:attachment filename:pdf"
  },
  {
    name: "5Ways Foodservice",
    query: "from:prontodocuments@5ways.com.au has:attachment filename:pdf"
  },
  {
    name: "Sciclunas Wholesale",
    query: "from:(orders@fresho.com OR ar@sciclunas.com.au) has:attachment filename:pdf"
  },
  {
    name: "Dench Bakers",
    query: "from:messaging-service@post.xero.com subject:\"Dench Bakers\" has:attachment filename:pdf"
  },
  {
    name: "Redi Milk",
    query: "from:hello@redimilk.com.au has:attachment filename:pdf"
  },
  {
    name: "Seven Seeds Coffee",
    query: "(from:messaging-service@post.xero.com subject:\"Seven Seeds\") OR (from:receipts+acct_16TkyAAcMTBTWSu4@stripe.com) has:attachment filename:pdf"
  },
  {
    name: "Little Bertha",
    query: "from:messaging-service@post.xero.com subject:\"Little Bertha\" has:attachment filename:pdf"
  },
  {
    name: "Candied Bakery",
    query: "from:messaging-service@post.xero.com subject:\"Tea and Cake\" has:attachment filename:pdf"
  },
  {
    name: "Product Distribution",
    query: "from:noreply@unleashedsoftware.com subject:\"Product Distribution\" has:attachment filename:pdf"
  },
  {
    name: "Planetware",
    query: "from:noreply@unleashedsoftware.com subject:\"PlanetWare\" has:attachment filename:pdf"
  },
  {
    name: "WF Plastics",
    query: "from:sales@wfplastic.com.au has:attachment filename:pdf"
  },
  {
    name: "Trio Supplies",
    query: "from:sales@triosuppliesaustralia.com.au subject:\"Invoice from Trio\" has:attachment filename:pdf"
  },

  // ── Self-forwarded invoices (you email them to yourself) ─────────────────
  // These catch emails FROM your own address with invoice-related subjects.

  {
    name: "Mork Chocolate",
    query: "from:gday@gdaytiger.com.au to:gday@gdaytiger.com.au subject:\"Mork\" has:attachment filename:pdf"
  },
  {
    name: "Matsu Tea",
    query: "from:gday@gdaytiger.com.au to:gday@gdaytiger.com.au subject:\"Matsu\" has:attachment filename:pdf"
  },
  {
    name: "Woolworths",
    query: "from:gday@gdaytiger.com.au to:gday@gdaytiger.com.au subject:\"Woolworths\" has:attachment filename:pdf"
  },

];

// ─── MAIN FUNCTION ─────────────────────────────────────────────────────────

function savePDFsToDrive() {
  const rootFolder = stdGetOrCreateFolder_(DriveApp.getRootFolder(), STD_ROOT_FOLDER_NAME);
  const savedLabel = stdGetOrCreateLabel_(STD_PROCESSED_LABEL);
  const afterDate  = getDateDaysAgo(STD_DAYS_TO_LOOK_BACK);

  let totalSaved = 0;

  for (const supplier of SUPPLIERS) {
    const fullQuery = `${supplier.query} after:${afterDate} -label:${STD_PROCESSED_LABEL}`;
    const threads   = GmailApp.search(fullQuery);

    if (threads.length === 0) continue;

    const supplierFolder = stdGetOrCreateFolder_(rootFolder, supplier.name);
    const yearFolder     = stdGetOrCreateFolder_(supplierFolder, String(new Date().getFullYear()));

    for (const thread of threads) {
      for (const message of thread.getMessages()) {
        for (const attachment of message.getAttachments()) {
          if (!isPDF(attachment)) continue;

          const filename = buildFilename(supplier.name, message.getDate(), attachment.getName());
          if (fileExists(yearFolder, filename)) continue;

          yearFolder.createFile(attachment.copyBlob().setName(filename));
          totalSaved++;
          Logger.log(`Saved: ${filename}`);
        }
      }
      thread.addLabel(savedLabel);
    }
  }

  // ── Ordermentum suppliers (email body → PDF) ──────────────────────────────
  for (const supplier of ORDERMENTUM_SUPPLIERS) {
    const fullQuery = `${supplier.query} after:${afterDate} -label:${STD_PROCESSED_LABEL}`;
    const threads   = GmailApp.search(fullQuery);

    if (threads.length === 0) continue;

    const supplierFolder = stdGetOrCreateFolder_(rootFolder, supplier.name);
    const yearFolder     = stdGetOrCreateFolder_(supplierFolder, String(new Date().getFullYear()));

    for (const thread of threads) {
      for (const message of thread.getMessages()) {
        const filename = buildFilename(supplier.name, message.getDate(), message.getSubject());
        if (fileExists(yearFolder, filename)) continue;

        const pdf = convertEmailToPDF(message, supplier.name);
        if (pdf) {
          yearFolder.createFile(pdf.setName(filename));
          totalSaved++;
          Logger.log(`Saved (email→PDF): ${filename}`);
        }

        // Stage 2: extract prices and update spreadsheet
        if (supplier.priceRules && supplier.priceRules.length > 0) {
          extractAndUpdatePrices(message, supplier.priceRules);
        }
      }
      thread.addLabel(savedLabel);
    }
  }

  Logger.log(`Done. ${totalSaved} new file(s) saved.`);
}

// ─── EMAIL → PDF CONVERTER ─────────────────────────────────────────────────

function convertEmailToPDF(message, supplierName) {
  try {
    const subject = message.getSubject();
    const date    = Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), "dd MMM yyyy");
    const body    = message.getPlainBody() || message.getBody();

    // Build a clean HTML document
    const html = `
      <html><head><style>
        body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
        h2   { margin-bottom: 4px; }
        pre  { white-space: pre-wrap; font-size: 11px; }
      </style></head>
      <body>
        <h2>${supplierName}</h2>
        <p><strong>${subject}</strong> — ${date}</p>
        <hr/>
        <pre>${body.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
      </body></html>`;

    // Create a temporary Google Doc, export as PDF, then delete it
    const blob    = Utilities.newBlob(html, MimeType.HTML, "temp.html");
    const tempDoc = DriveApp.createFile(blob);
    const pdf     = tempDoc.getAs(MimeType.PDF);
    tempDoc.setTrashed(true);
    return pdf;

  } catch (e) {
    Logger.log(`Error converting email to PDF for ${supplierName}: ${e}`);
    return null;
  }
}

// ─── PRICE EXTRACTION & SPREADSHEET UPDATE ────────────────────────────────

function extractAndUpdatePrices(message, priceRules) {
  // Strip HTML tags to get plain text for parsing
  const raw  = message.getBody() || "";
  const text = raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const rule of priceRules) {
    const kw = rule.keywords.join("|");
    const re = new RegExp(`(${kw})[^$]*\\$(\\d+\\.\\d{2})[^$]*\\$(\\d+\\.\\d{2})`, "i");
    const match = text.match(re);
    if (!match) {
      Logger.log(`Price rule [${kw}]: no match found in email`);
      continue;
    }

    // per_kg: format is Name | Qty | Weight | Price | Total
    //   → first $ = price/kg, second $ = line total
    // per_unit: format is Name | Qty | Price | Total
    //   → first $ = unit price
    const price = parseFloat(match[2]);
    Logger.log(`Price rule [${kw}]: found $${price} (${rule.priceType})`);
    updateSheetPrice(rule.sheetSearch, price);
  }
}

function updateSheetPrice(searchText, newPrice) {
  try {
    const ss    = SpreadsheetApp.openById(STD_FOOD_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(STD_FOOD_SHEET_NAME);
    if (!sheet) { Logger.log(`Sheet "${STD_FOOD_SHEET_NAME}" not found`); return; }

    const data = sheet.getDataRange().getValues();
    const upper = searchText.toUpperCase();

    for (let r = 0; r < data.length; r++) {
      for (let c = 0; c < data[r].length; c++) {
        if (String(data[r][c]).toUpperCase().includes(upper)) {
          // Price is in the next non-empty cell to the right
          for (let pc = c + 1; pc < data[r].length; pc++) {
            const val = data[r][pc];
            if (typeof val === "number" && val > 0) {
              if (val !== newPrice) {
                Logger.log(`Updating "${searchText}": $${val} → $${newPrice} at row ${r+1}, col ${pc+1}`);
                sheet.getRange(r + 1, pc + 1).setValue(newPrice);
                SpreadsheetApp.flush();
              } else {
                Logger.log(`"${searchText}": price unchanged at $${newPrice}`);
              }
              return;
            }
          }
        }
      }
    }
    Logger.log(`"${searchText}": not found in sheet`);
  } catch (e) {
    Logger.log(`updateSheetPrice error: ${e}`);
  }
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

function stdGetOrCreateFolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parent.createFolder(name);
}

function stdGetOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function isPDF(attachment) {
  const mime = attachment.getContentType() || "";
  const name = attachment.getName() || "";
  return mime.includes("pdf") || name.toLowerCase().endsWith(".pdf");
}

function buildFilename(supplierName, date, originalName) {
  const dateStr  = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const baseName = originalName.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9 _\-]/g, "").trim();
  return `${dateStr} — ${supplierName} — ${baseName}.pdf`;
}

function fileExists(folder, filename) {
  return folder.getFilesByName(filename).hasNext();
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy/MM/dd");
}

// ─── TRIGGER SETUP ─────────────────────────────────────────────────────────
// Run once. Removes any existing savePDFsToDrive trigger before creating a new one.

function createSaveToDriveTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'savePDFsToDrive')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('savePDFsToDrive').timeBased().everyHours(1).create();
  Logger.log('Trigger created: savePDFsToDrive runs every hour.');
}