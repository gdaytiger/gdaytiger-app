import { NextResponse } from 'next/server';
import { GROSS_MARGIN } from '../../lib/businessMetrics';

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY FLASH — the Monday-morning operational scorecard.
// Reads Notion code blocks DIRECTLY (no intra-app self-fetch, which returns
// empty on Vercel): `sales_daily` (net/orders per day) and `labour_weekly`.
// Benchmarks each metric vs benchmark zones and returns the last completed
// week vs the week before.
//
// LABOUR (standard basis, Oct 2026): `labour_weekly` is written nightly by
// apps-script/LabourWeekly.js from the PAYROLL wage sheet — wages + 12% super
// ÷ net sales ex-GST. Two figures: line-staff % (target ≤35%, watch to 38%)
// and total % incl owner wage (context only). Replaces the old Deputy
// self-fetch, which returned empty on Vercel and under-counted payroll 16–34%.
//
// Gross margin comes from businessMetrics (monthly Xero). Mix + day-part are
// rendered from /api/flash-extras (fetched client-side).
// ─────────────────────────────────────────────────────────────────────────────

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';
// Labour = [target max, watch max] for LINE-STAFF % (owner wage excluded).
// ≤35 on target · 35–38 watch · >38 over. Basis: ATO coffee-shop benchmark for
// turnover >$600k (27–35%, owner wages excluded) + common 30–35% café guidance,
// allowing ~1–2pts for award rises since the 2023–24 ATO data. Set Oct 2026.
const ZONES = { grossMargin: [65, 75], labour: [35, 38] } as const;
function labourVerdict(v: number | null) {
  if (v == null) return null;
  if (v <= ZONES.labour[0]) return 'in';
  if (v <= ZONES.labour[1]) return 'watch';
  return 'above';
}
const TZ_OFFSET_MS = 10 * 60 * 60 * 1000; // Australia/Melbourne (AEST)

type SalesDay = { date: string; weekday: string; gross: number; net: number; orders: number };
type LabourWeek = {
  label: string; start: string; end: string;
  wages: number; line_wages: number; owner_wages: number;
  line_cost: number; total_cost: number;
  gross_sales: number; net_sales: number;
  line_pct: number; total_pct: number;
};

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return fmt(d);
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}
function zoneVerdict(v: number | null, [lo, hi]: readonly [number, number]) {
  if (v == null) return null;
  if (v < lo) return 'below';
  if (v > hi) return 'above';
  return 'in';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notionFetch(path: string): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { Authorization: `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
    cache: 'no-store',
  });
  return res.json();
}

// Reads a JSON code block (identified by its "<key>" marker) from the OS page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readBlock(key: string): Promise<any | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let blocks: any[] = [];
  let cursor: string | undefined;
  do {
    const data = await notionFetch(`/blocks/${NOTION_PAGE_ID}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    blocks = blocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textOf = (b: any) => (b.code?.rich_text || []).map((r: any) => r.plain_text).join('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const block = blocks.find((b: any) => b.type === 'code' && textOf(b).includes(`"${key}"`));
  if (!block) return null;
  try { return JSON.parse(textOf(block)); } catch { return null; }
}

export async function GET() {
  try {
    const [salesBlock, labourBlock] = await Promise.all([readBlock('sales_daily'), readBlock('labour_weekly')]);
    const days: SalesDay[] = salesBlock?.days || [];
    const labourWeeks: LabourWeek[] = labourBlock?.weeks || [];
    const labourByStart = new Map(labourWeeks.map((w) => [w.start, w]));

    const wk = new Map<string, { net: number; orders: number; days: SalesDay[] }>();
    for (const d of days) {
      const k = mondayOf(d.date);
      const cur = wk.get(k) || { net: 0, orders: 0, days: [] };
      cur.net += d.net || 0; cur.orders += d.orders || 0; cur.days.push(d);
      wk.set(k, cur);
    }

    const today = fmt(new Date(Date.now() + TZ_OFFSET_MS));
    const thisMon = mondayOf(today);
    const featStart = addDays(thisMon, -7);
    const prevStart = addDays(thisMon, -14);

    function weekMetrics(start: string) {
      const s = wk.get(start);
      if (!s || s.net <= 0) return null;
      const lw = labourByStart.get(start) ?? null;
      const sorted = [...s.days].sort((a, b) => b.net - a.net);
      const best = sorted[0] || null, worst = sorted[sorted.length - 1] || null;
      return {
        start, end: addDays(start, 6),
        net: round2(s.net), orders: s.orders,
        avgSale: s.orders > 0 ? round2(s.net / s.orders) : null,
        // Payroll basis (wage sheet). Null until that week's pay run is entered.
        labourCost: lw ? lw.line_cost : null,
        labourPct: lw ? lw.line_pct : null,
        totalLabourCost: lw ? lw.total_cost : null,
        totalLabourPct: lw ? lw.total_pct : null,
        best: best ? { weekday: best.weekday, date: best.date, net: round2(best.net) } : null,
        worst: worst ? { weekday: worst.weekday, date: worst.date, net: round2(worst.net) } : null,
      };
    }

    const feat = weekMetrics(featStart);
    const prev = weekMetrics(prevStart);
    const salesWoW = feat && prev && prev.net > 0 ? round2(((feat.net - prev.net) / prev.net) * 100) : null;

    return NextResponse.json({
      ready: !!feat, generatedAt: new Date().toISOString(),
      week: feat, prevWeek: prev, salesWoW,
      grossMargin: { pct: GROSS_MARGIN.pct, month: GROSS_MARGIN.month, source: GROSS_MARGIN.source },
      zones: ZONES,
      scorecard: {
        grossMargin: { value: GROSS_MARGIN.pct, verdict: zoneVerdict(GROSS_MARGIN.pct, ZONES.grossMargin) },
        labour: { value: feat?.labourPct ?? null, verdict: labourVerdict(feat?.labourPct ?? null) },
        salesTrend: { value: salesWoW, verdict: salesWoW == null ? null : (salesWoW >= 0 ? 'up' : 'down') },
      },
      labourTotal: { value: feat?.totalLabourPct ?? null },
      meta: {
        labourBasis: 'payroll wages + 12% super ÷ net sales ex-GST',
        pending: feat && feat.labourPct == null ? 'Payroll for this week not in the wage sheet yet.' : '',
        labourUpdated: labourBlock?.updated ?? null,
      },
    });
  } catch (err) {
    console.error('weekly-flash error:', err);
    return NextResponse.json({ ready: false, note: 'Failed to build weekly flash' }, { status: 200 });
  }
}
