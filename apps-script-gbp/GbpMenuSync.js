// ═══════════════════════════════════════════════════════════════════════════════
//  GbpMenuSync.gs — keep prices on the Google menu in step with Square
//
//  Only PRICES on items that are ALREADY on the Google menu are touched. Nothing
//  is added, removed, renamed or re-described. Items are matched to Square by
//  name (case/punctuation-insensitive); add an alias below if names differ.
//
//  MENU_SYNC_MODE (Script Property):
//    'preview' (default) — works out the changes, writes them to the
//                          `google_menu_sync` block for TIGER OS, changes nothing.
//    'live'              — also pushes the new prices to Google.
//  Review the preview in TIGER OS first, then flip to 'live'.
// ═══════════════════════════════════════════════════════════════════════════════

// Google menu name → Square item name (optionally "Square item|Variation").
// Fill in when a Google item shows under "Not matched" in TIGER OS.
var GBP_MENU_ALIASES = {
  'small black coffee': 'TA Black',
  'large black coffee': 'LG Black',
  'small white coffee': 'TA White',
  'large white coffee': 'LG White',
  'small batch brew': 'TA Batch Brew',
  'large batch brew': 'LG Batch Brew',
  'chicken schnitta': 'Schnitta',
  'salami autogrill panino': 'Autogrill|Salami',
  'house made banana bread': 'Banana Bread',
  'passionfruit matcha milkshake': 'Milkshake|Passionfruit Matcha',
};

function syncGoogleMenuPricesTrigger() {
  syncGoogleMenuPrices(gbpProp_('MENU_SYNC_MODE') === 'live');
}

function syncGoogleMenuPrices(apply) {
  var loc = gbpLocation_();
  var report = { updated: new Date().toISOString(), mode: apply ? 'live' : 'preview', changes: [], unmatched: [], error: null };
  try {
    var fm = gbpFetch_(GBP_V4 + loc + '/foodMenus');
    var idx = gbpSquarePriceIndex_();

    (fm.menus || []).forEach(function (menu) {
      (menu.sections || []).forEach(function (section) {
        (section.items || []).forEach(function (item) {
          var itemName = gbpLabel_(item.labels);
          var opts = item.options || [];
          if (opts.length) {
            opts.forEach(function (opt) {
              var optName = gbpLabel_(opt.labels);
              var cents = gbpLookupCents_(idx, itemName, optName);
              gbpApplyPrice_(report, itemName + ' — ' + optName, opt.attributes, cents);
            });
          } else {
            gbpApplyPrice_(report, itemName, item.attributes, gbpLookupCents_(idx, itemName, null));
          }
        });
      });
    });

    if (apply && report.changes.length) {
      gbpFetch_(GBP_V4 + loc + '/foodMenus?updateMask=menus', 'patch', { menus: fm.menus });
      report.applied = true;
    }
  } catch (err) {
    report.error = String((err && err.message) || err);
  }
  gbpWriteOsBlock_('google_menu_sync', report);
  return { ok: !report.error, report: report };
}

// Mutates attrs.price in place when Square differs; records the change.
function gbpApplyPrice_(report, label, attrs, cents) {
  if (cents == null) { report.unmatched.push(label); return; }
  attrs = attrs || {};
  var cur = attrs.price;
  var curCents = cur ? Math.round(Number(cur.units || 0) * 100 + Number(cur.nanos || 0) / 1e7) : null;
  if (curCents === cents) return;
  report.changes.push({ item: label, from: curCents == null ? null : curCents / 100, to: cents / 100 });
  attrs.price = { currencyCode: 'AUD', units: String(Math.floor(cents / 100)), nanos: (cents % 100) * 1e7 };
}

// norm(item name) → { norm(variation name) → cents, _default → cents }
function gbpSquarePriceIndex_() {
  var idx = {};
  gbpSquareItems_().forEach(function (it) {
    var vars = {};
    var priced = it.variations.filter(function (v) { return v.cents != null; });
    priced.forEach(function (v) { vars[gbpNorm_(v.name)] = v.cents; });
    var regular = priced.filter(function (v) { return /^(regular|small|standard)$/i.test(v.name); })[0];
    if (priced.length) vars._default = (regular || priced[0]).cents;
    idx[gbpNorm_(it.name)] = vars;
  });
  return idx;
}

function gbpLookupCents_(idx, itemName, optName) {
  var alias = GBP_MENU_ALIASES[gbpNorm_(itemName)];
  var sqItem = gbpNorm_(itemName), sqVar = optName ? gbpNorm_(optName) : null;
  if (alias) {
    var parts = alias.split('|');
    sqItem = gbpNorm_(parts[0]);
    if (parts[1]) sqVar = gbpNorm_(parts[1]);
  }
  var vars = idx[sqItem];
  if (!vars) return null;
  if (sqVar) return vars[sqVar] != null ? vars[sqVar] : null;
  return vars._default != null ? vars._default : null;
}
