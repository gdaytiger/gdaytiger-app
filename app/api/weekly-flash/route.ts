import { NextResponse } from 'next/server';
import { GROSS_MARGIN } from '../../lib/businessMetrics';

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY FLASH — the Monday-morning operational scorecard.
// Reads the `sales_daily` Notion block DIRECTLY (net/orders per day) — no
// intra-app self-fetch, which is unreliable on Vercel (server→own /api returns
// empty). Labour (Deputy) is pulled from /api/labour via the canonical
// VERCEL_URL, best-effort. Benchmarks each metric vs the ONA venue zones and
// returns the last completed week vs the week before.
//
// Labour % is on NET (ex-GST) sales, line-staff only (owner wage excluded) —
// the basis we standardised on. Gross margin comes from businessMetrics
// (monthly Xero). Mix + day-part are rendered from /api/flash-extras (fetched
// client-side, so unaffected by the self-fetch issue).
// ─────────────────────────────────────────────────────────────────────────────

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';
const ZONES = { grossMargin: [65, 75], labour: [34, 38] } as const;
const TZ_OFFSET_MS = 10 * 60 * 60 * 1000; // Australia/Melbourne (AEST)
const DEFAULT_RATE = 38;

type SalesDay = { date: string; weekday: string; gross: number; net: number; orders: number };

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

async function readSalesDaily(): Promise<SalesDay[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let blocks: any[] = [];
  let cursor: string | undefined;
  do {
    const data = await notionFetch(`/blocks/${NOTION_PAGE_ID}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    blocks = blocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const block = blocks.find((b: any) => b.type === 'code' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b.code?.rich_text || []).map((r: any) => r.plain_text).join('').includes('"sales_daily"'));
  if (!block) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (block.code?.rich_text || []).map((r: any) => r.plain_text).join('');
  try { return (JSON.parse(text).days || []) as SalesDay[]; } catch { return []; }
}

// Best-effort weekly line-staff labour cost from Deputy (/api/labour), keyed by
// Monday-of-week. Uses VERCEL_URL (canonical) — returns {} if unreachable.
async function readLabourByWeek(req: Request): Promise<Record<string, number>> {
  try {
    const vurl = process.env.VERCEL_URL;
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    const base = vurl ? `https://${vurl}` : host ? `https://${host}` : null;
    if (!base) return {};
    const res = await fetch(`${base}/api/labour?weeks=4&rate=${DEFAULT_RATE}`, { cache: 'no-store' });
    const data = await res.json();
    const out: Record<string, number> = {};
    for (const d of (data?.days || [])) {
      if (!d?.date || d?.cost == null) continue;
      const k = mondayOf(d.date);
      out[k] = (out[k] || 0) + d.cost;
    }
    return out;
  } catch { return {}; }
}

export async function GET(req: Request) {
  try {
    const [days, labourByWeek] = await Promise.all([readSalesDaily(), readLabourByWeek(req)]);

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
      const labour = labourByWeek[start] ?? null;
      const sorted = [...s.days].sort((a, b) => b.net - a.net);
      const best = sorted[0] || null, worst = sorted[sorted.length - 1] || null;
      return {
        start, end: addDays(start, 6),
        net: round2(s.net), orders: s.orders,
        avgSale: s.orders > 0 ? round2(s.net / s.orders) : null,
        labourCost: labour != null ? round2(labour) : null,
        labourPct: labour != null ? round2((labour / s.net) * 100) : null,
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
        labour: { value: feat?.labourPct ?? null, verdict: zoneVerdict(feat?.labourPct ?? null, ZONES.labour) },
        salesTrend: { value: salesWoW, verdict: salesWoW == null ? null : (salesWoW >= 0 ? 'up' : 'down') },
      },
      meta: { labourBasis: 'line-staff, ex-GST (owner wage excluded)', pending: '' },
    });
  } catch (err) {
    console.error('weekly-flash error:', err);
    return NextResponse.json({ ready: false, note: 'Failed to build weekly flash' }, { status: 200 });
  }
}
