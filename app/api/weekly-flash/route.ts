import { NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY FLASH — the Monday-morning operational scorecard.
// Composes existing feeds (no new Square/Xero access needed):
//   • /api/sales-daily  → net (ex-GST) sales + orders per day
//   • /api/staff-cost   → line-staff labour cost per week (Deputy, ex-Jono)
// Benchmarks each metric against the ONA venue zones and returns a featured
// (last completed) week vs the week before.
//
// Labour % is computed on NET (ex-GST) sales — the basis we standardised on
// (GST-inclusive flatters the ratio ~10%). Line-staff only: Jonathan's owner
// wage is excluded (he doesn't clock into Deputy), matching the benchmark.
//
// Gross margin is a maintained run-rate constant from Xero (weekly COGS is
// lumpy — invoices don't land evenly). Update GROSS_MARGIN_PCT when the Xero
// figure moves. Sales mix + day-part are a fast-follow (need a SalesDaily.js
// Apps Script feed extension — the app holds no Square token).
// ─────────────────────────────────────────────────────────────────────────────

const GROSS_MARGIN_PCT = 78;          // Xero, Aug 2026 run-rate (COGS 21.8%)
const GROSS_MARGIN_SOURCE = 'Xero Aug 2026 run-rate';
const ZONES = {
  grossMargin: [65, 75],
  labour: [34, 38],
} as const;
const TZ_OFFSET_MS = 10 * 60 * 60 * 1000; // Australia/Melbourne (AEST)

type SalesDay = { date: string; weekday: string; gross: number; net: number; orders: number };

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return fmt(d);
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}
// verdict vs a [low, high] zone: 'in' within, 'below'/'above' outside.
function zoneVerdict(v: number | null, [lo, hi]: readonly [number, number]) {
  if (v == null) return null;
  if (v < lo) return 'below';
  if (v > hi) return 'above';
  return 'in';
}

export async function GET(req: Request) {
  try {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    if (!host) return NextResponse.json({ ready: false, note: 'no host' });
    const base = `${proto}://${host}`;

    const [salesRes, staffRes] = await Promise.all([
      fetch(`${base}/api/sales-daily`, { cache: 'no-store' }),
      fetch(`${base}/api/staff-cost`, { cache: 'no-store' }),
    ]);
    const sales = await salesRes.json();
    const staff = await staffRes.json();

    const days: SalesDay[] = sales?.days || [];
    // labour cost per week, keyed by Monday-of-week start
    const labourByWeek = new Map<string, number>();
    for (const w of (staff?.weeks || [])) {
      if (w?.start != null && w?.labourCost != null) labourByWeek.set(w.start, w.labourCost);
    }

    // Weekly rollup of sales (net ex-GST + orders) from daily data.
    const wk = new Map<string, { net: number; orders: number; days: SalesDay[] }>();
    for (const d of days) {
      const k = mondayOf(d.date);
      const cur = wk.get(k) || { net: 0, orders: 0, days: [] };
      cur.net += d.net || 0;
      cur.orders += d.orders || 0;
      cur.days.push(d);
      wk.set(k, cur);
    }

    const today = fmt(new Date(Date.now() + TZ_OFFSET_MS));
    const thisMon = mondayOf(today);
    const featStart = addDays(thisMon, -7);   // last completed week
    const prevStart = addDays(thisMon, -14);

    function weekMetrics(start: string) {
      const s = wk.get(start);
      if (!s || s.net <= 0) return null;
      const labour = labourByWeek.get(start) ?? null;
      const labourPct = labour != null ? round2((labour / s.net) * 100) : null;
      const sortedDays = [...s.days].sort((a, b) => b.net - a.net);
      const best = sortedDays[0] || null;
      const worst = sortedDays[sortedDays.length - 1] || null;
      return {
        start, end: addDays(start, 6),
        net: round2(s.net),
        orders: s.orders,
        avgSale: s.orders > 0 ? round2(s.net / s.orders) : null,
        labourCost: labour,
        labourPct,
        best: best ? { weekday: best.weekday, date: best.date, net: round2(best.net) } : null,
        worst: worst ? { weekday: worst.weekday, date: worst.date, net: round2(worst.net) } : null,
      };
    }

    const feat = weekMetrics(featStart);
    const prev = weekMetrics(prevStart);
    const salesWoW = feat && prev && prev.net > 0 ? round2(((feat.net - prev.net) / prev.net) * 100) : null;

    return NextResponse.json({
      ready: !!feat,
      generatedAt: new Date().toISOString(),
      week: feat,
      prevWeek: prev,
      salesWoW,
      grossMargin: { pct: GROSS_MARGIN_PCT, source: GROSS_MARGIN_SOURCE },
      zones: ZONES,
      scorecard: {
        grossMargin: { value: GROSS_MARGIN_PCT, verdict: zoneVerdict(GROSS_MARGIN_PCT, ZONES.grossMargin) },
        labour: { value: feat?.labourPct ?? null, verdict: zoneVerdict(feat?.labourPct ?? null, ZONES.labour) },
        salesTrend: { value: salesWoW, verdict: salesWoW == null ? null : (salesWoW >= 0 ? 'up' : 'down') },
      },
      meta: {
        labourBasis: 'line-staff, ex-GST (owner wage excluded)',
        salesReady: (staff?.meta?.salesReady ?? false),
        pending: 'Sales mix + day-part land with the SalesDaily Apps Script feed extension.',
      },
    });
  } catch (err) {
    console.error('weekly-flash error:', err);
    return NextResponse.json({ ready: false, note: 'Failed to build weekly flash' }, { status: 200 });
  }
}
