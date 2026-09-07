// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS METRICS — maintained figures that aren't in a live app feed.
//
// Gross margin comes from the MONTHLY Xero P&L. Weekly gross margin is
// deliberately NOT computed: COGS is invoice-driven and lumpy (a big Seven Seeds
// order lands one week, none the next), so a weekly figure would bounce around
// and mislead. The monthly Xero number is the honest one — refreshed each month
// by the P&L review (which pulls Xero directly). Update `pct` + `month` when the
// new month's P&L is finalised.
// ─────────────────────────────────────────────────────────────────────────────
export const GROSS_MARGIN = {
  pct: 78,              // Xero P&L, gross profit ÷ income (ex-GST)
  month: 'Aug 2026',
  source: 'Xero P&L, monthly',
};
