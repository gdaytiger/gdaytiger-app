import { NextResponse } from 'next/server';

// Merges /api/labour (Deputy hours+cost per day) with /api/sales-daily (Square
// sales per day) into the single metric that matters: STAFF COST % per day/week
// = labour cost ÷ gross sales. Feeds the dashboard "Labour" card.
//
// Labour cost is hours × rate (default $38) which ≈ actual wage cost EXCLUDING
// Jonathan (he doesn't clock into Deputy) — validated to within ~2% of the
// "Gross Staff Cost less Jono" wage sheet. Sales `gross` = incl GST, excl tips.
//
// Self-calls the two sibling routes on the same host so there's one source of
// truth for each feed (no duplicated Deputy/Square logic).

const DEFAULT_RATE = 38;
const TARGET_PCT = 35; // healthy staff-cost % (incl-area, ex-Jono)
const TZ_OFFSET_MS = 10 * 60 * 60 * 1000; // Australia/Melbourne (AEST)

type LabourDay = { date: string; weekday: string; hours: number; cost: number };
type SalesDay = { date: string; gross: number; net: number };

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// Monday-of-week key for a YYYY-MM-DD date (weeks run Mon–Sun).
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return fmt(d);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (cost: number, sales: number) => (sales > 0 ? round2((cost / sales) * 100) : null);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const weeks = Math.max(1, Math.min(52, Number(searchParams.get('weeks')) || 12));
    const rate = Number(searchParams.get('rate')) || DEFAULT_RATE;

    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    if (!host) return NextResponse.json({ error: 'no host', meta: { salesReady: false } });
    const base = `${proto}://${host}`;

    const [labourRes, salesRes] = await Promise.all([
      fetch(`${base}/api/labour?weeks=${weeks}&rate=${rate}`, { cache: 'no-store' }),
      fetch(`${base}/api/sales-daily`, { cache: 'no-store' }),
    ]);
    const labour = await labourRes.json();
    const sales = await salesRes.json();

    const labourDays: LabourDay[] = labour?.days || [];
    const salesDays: SalesDay[] = sales?.days || [];
    const salesMap = new Map<string, SalesDay>(salesDays.map((s) => [s.date, s]));
    const salesReady = salesDays.length > 0;

    // ---- Per-day merge (only days we have labour for) ----
    const daily = labourDays.map((l) => {
      const s = salesMap.get(l.date);
      const sale = s ? s.gross : null;
      return {
        date: l.date,
        weekday: l.weekday,
        hours: round2(l.hours),
        labourCost: round2(l.cost),
        sales: sale,
        staffPct: sale != null ? pct(l.cost, sale) : null,
      };
    });

    // ---- Weekly rollups (Mon–Sun) ----
    const wk = new Map<string, { sales: number; cost: number; hours: number; hasSales: boolean }>();
    for (const d of daily) {
      const k = mondayOf(d.date);
      const cur = wk.get(k) || { sales: 0, cost: 0, hours: 0, hasSales: false };
      cur.cost += d.labourCost;
      cur.hours += d.hours;
      if (d.sales != null) { cur.sales += d.sales; cur.hasSales = true; }
      wk.set(k, cur);
    }
    const weeklies = [...wk.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([start, v]) => {
        const end = new Date(start + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 6);
        return {
          start, end: fmt(end),
          hours: round2(v.hours),
          labourCost: round2(v.cost),
          sales: v.hasSales ? round2(v.sales) : null,
          staffPct: v.hasSales ? pct(v.cost, v.sales) : null,
        };
      });

    // ---- This week / last week headline ----
    const today = new Date(Date.now() + TZ_OFFSET_MS);
    const thisMon = mondayOf(fmt(today));
    const thisWeek = weeklies.find((w) => w.start === thisMon) || null;
    const idx = weeklies.findIndex((w) => w.start === thisMon);
    const lastWeek = idx > 0 ? weeklies[idx - 1] : (weeklies.length ? weeklies[weeklies.length - (thisWeek ? 2 : 1)] || null : null);

    // ---- Roster shape: avg hours by weekday (labour-only, always available) ----
    const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const byDow = new Map<string, number[]>();
    for (const d of daily) {
      const arr = byDow.get(d.weekday) || []; arr.push(d.hours); byDow.set(d.weekday, arr);
    }
    const rosterShape = order.map((w) => {
      const arr = byDow.get(w) || [];
      return { weekday: w, avgHours: arr.length ? round2(arr.reduce((a, b) => a + b, 0) / arr.length) : 0 };
    });

    // ---- Recent 14 days that have sales (for the bars) ----
    const recent = daily.filter((d) => d.sales != null).slice(-14);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      rate, target: TARGET_PCT,
      thisWeek, lastWeek,
      recent,
      weeks: weeklies.slice(-12),
      rosterShape,
      meta: {
        salesReady,
        labourDays: labourDays.length,
        salesDays: salesDays.length,
        note: salesReady ? 'Live' : 'Square sales backfill still running — roster shape shown; staff cost % fills in once sales land.',
      },
    });
  } catch (err) {
    console.error('staff-cost merge error:', err);
    return NextResponse.json({ error: 'Failed to build staff cost', meta: { salesReady: false } }, { status: 200 });
  }
}
