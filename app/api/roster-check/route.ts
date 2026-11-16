import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { melbNowDate } from '@/app/lib/melbTime';
import { SALES_NET_HISTORY } from '@/app/lib/salesHistory';

// ROSTER CHECK — forward-looking labour check, run BEFORE a roster is published.
//
// For a 7-day window (default: starting tomorrow) it pulls every rostered shift
// from Deputy and compares it with the same weekday-aligned days last year
// (date − 364): actual worked hours (Deputy timesheets) and net sales.
// Projected labour % = rostered hours × RATE ÷ last year's net sales.
//
// Basis matches the Weekly Flash scorecard: line staff only (Jono excluded),
// % of NET sales ex-GST, zone 35–38%. Cost is hours × RATE, not Deputy's Cost
// field — Deputy cost skips super/leave and runs well under payroll.
//
// Talks to Deputy and Notion directly. Deliberately NO self-calls to sibling
// API routes: server-side fetches carry no session cookie, so proxy.ts 401s
// them — that's what broke the old /api/staff-cost Labour tile.
//
// Query: ?start=YYYY-MM-DD (default tomorrow, Melbourne) &days=N (1–28, default 7)

const DEPUTY_ENDPOINT = process.env.DEPUTY_ENDPOINT;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';

const RATE = 39;                          // $/hr, line staff, incl 12% super ($38 validated at 9.5% SG)
const ZONE: [number, number] = [35, 38];  // same labour zone as Weekly Flash
const OWNER_EMPLOYEE_ID = 1;              // Jono — rostered in Deputy but not paid via timesheets
const LY_OFFSET_DAYS = 364;               // 52 weeks back keeps the weekday aligned
const PEAK_HOUR = 10;                     // 10–11am, busiest hour
const AFTER_HOUR = 13;                    // 1–2pm, where the afternoon leak shows

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const weekday = (s: string) => DAY_NAMES[new Date(s + 'T00:00:00Z').getUTCDay()];
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function verdict(p: number | null): 'below' | 'in' | 'above' | null {
  if (p == null) return null;
  if (p < ZONE[0]) return 'below';
  if (p > ZONE[1]) return 'above';
  return 'in';
}

// Local clock hour (decimal) from Deputy's "...T07:30:00+11:00" localized strings.
function localHour(s: unknown): number | null {
  if (typeof s !== 'string' || s.length < 16) return null;
  return Number(s.slice(11, 13)) + Number(s.slice(14, 16)) / 60;
}
const onAt = (start: number | null, end: number | null, hr: number) =>
  start != null && end != null && start <= hr && end > hr;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deputyQuery(resource: 'Roster' | 'Timesheet', start: string, end: string): Promise<any[]> {
  const token = process.env.DEPUTY_ACCESS_TOKEN!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  const PAGE = 500;
  for (let page = 0, offset = 0; page < 10; page++, offset += PAGE) {
    const res = await fetch(`${DEPUTY_ENDPOINT}/api/v1/resource/${resource}/QUERY`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search: { s1: { field: 'Date', type: 'ge', data: start }, s2: { field: 'Date', type: 'le', data: end } },
        sort: { Date: 'asc' }, max: PAGE, start: offset,
      }),
      cache: 'no-store',
    });
    const text = await res.text();
    if (!text) break;
    let batch: unknown;
    try { batch = JSON.parse(text); } catch { throw new Error(`Deputy ${resource} returned malformed JSON`); }
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

// Net sales per day from the rolling `sales_daily` Notion block (last ~180 days).
async function readSalesDaily(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let blocks: any[] = [];
    let cursor: string | undefined;
    do {
      const res = await fetch(
        `https://api.notion.com/v1/blocks/${NOTION_PAGE_ID}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`,
        { headers: { Authorization: `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' }, cache: 'no-store' },
      );
      const data = await res.json();
      blocks = blocks.concat(data.results || []);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textOf = (b: any) => (b.code?.rich_text || []).map((r: any) => r.plain_text).join('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const block = blocks.find((b: any) => b.type === 'code' && textOf(b).includes('"sales_daily"'));
    if (!block) return map;
    const payload = JSON.parse(textOf(block));
    for (const d of payload.days || []) if (d?.date && typeof d.net === 'number') map.set(d.date, d.net);
  } catch {
    // Fail soft — the seeded history still covers last summer.
  }
  return map;
}

type DayAcc = { hours: number; shifts: number; open: number; unpublished: number; atPeak: number; atAfter: number };
const emptyAcc = (): DayAcc => ({ hours: 0, shifts: 0, open: 0, unpublished: 0, atPeak: 0, atAfter: 0 });

type DayOut = {
  date: string; weekday: string;
  rostered: { hours: number; cost: number; shifts: number; open: number; unpublished: number; atPeak: number; atAfter: number };
  lastYear: { date: string; hours: number; cost: number; shifts: number; sales: number | null; pct: number | null; atPeak: number; atAfter: number };
  rosterPending: boolean;
  projectedPct: number | null;
  verdict: ReturnType<typeof verdict>;
};

export async function GET(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const days = Math.max(1, Math.min(28, Number(searchParams.get('days')) || 7));
    const startParam = searchParams.get('start');
    const start = startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam) ? startParam : addDays(fmt(melbNowDate()), 1);
    const end = addDays(start, days - 1);
    const lyStart = addDays(start, -LY_OFFSET_DAYS);
    const lyEnd = addDays(end, -LY_OFFSET_DAYS);

    const [rosters, timesheets, salesLive] = await Promise.all([
      deputyQuery('Roster', start, end),
      deputyQuery('Timesheet', lyStart, lyEnd),
      readSalesDaily(),
    ]);

    // ---- This year: rostered ----
    const ros = new Map<string, DayAcc>();
    for (const r of rosters) {
      if (Number(r.Employee) === OWNER_EMPLOYEE_ID) continue;
      const date = String(r.Date).slice(0, 10);
      const acc = ros.get(date) || emptyAcc();
      const hrs = Number(r.TotalTime) || 0;
      const s = localHour(r.StartTimeLocalized), e = localHour(r.EndTimeLocalized);
      acc.hours += hrs;
      acc.shifts += 1;
      if (r.Open === true || !Number(r.Employee)) acc.open += 1;
      if (r.Published === false) acc.unpublished += 1;
      if (onAt(s, e, PEAK_HOUR)) acc.atPeak += 1;
      if (onAt(s, e, AFTER_HOUR)) acc.atAfter += 1;
      ros.set(date, acc);
    }

    // ---- Last year: actual worked ----
    const ly = new Map<string, DayAcc>();
    for (const t of timesheets) {
      if (t.Discarded === true || t.IsLeave === true) continue;
      if (Number(t.Employee) === OWNER_EMPLOYEE_ID) continue;
      const date = String(t.Date).slice(0, 10);
      const acc = ly.get(date) || emptyAcc();
      const s = localHour(t.StartTimeLocalized), e = localHour(t.EndTimeLocalized);
      acc.hours += Number(t.TotalTime) || 0;
      acc.shifts += 1;
      if (onAt(s, e, PEAK_HOUR)) acc.atPeak += 1;
      if (onAt(s, e, AFTER_HOUR)) acc.atAfter += 1;
      ly.set(date, acc);
    }
    const lySales = (d: string) => salesLive.get(d) ?? SALES_NET_HISTORY[d] ?? null;

    // ---- Per day ----
    const out: DayOut[] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(start, i);
      const lyDate = addDays(date, -LY_OFFSET_DAYS);
      const r = ros.get(date) || emptyAcc();
      const l = ly.get(lyDate) || emptyAcc();
      const sales = lySales(lyDate);
      const cost = r.hours * RATE;
      const lyCost = l.hours * RATE;
      const projectedPct = r.hours > 0 && sales ? r1((cost / sales) * 100) : null;
      out.push({
        date, weekday: weekday(date),
        rostered: { hours: r1(r.hours), cost: r2(cost), shifts: r.shifts, open: r.open, unpublished: r.unpublished, atPeak: r.atPeak, atAfter: r.atAfter },
        lastYear: {
          date: lyDate, hours: r1(l.hours), cost: r2(lyCost), shifts: l.shifts, sales: sales != null ? r2(sales) : null,
          pct: l.hours > 0 && sales ? r1((lyCost / sales) * 100) : null, atPeak: l.atPeak, atAfter: l.atAfter,
        },
        rosterPending: r.shifts === 0,
        projectedPct,
        verdict: verdict(projectedPct),
      });
    }

    // ---- Totals: only days that are rostered AND have last-year sales ----
    const comparable = out.filter((d) => !d.rosterPending && d.lastYear.sales != null);
    const sum = (f: (d: DayOut) => number) => comparable.reduce((a, d) => a + f(d), 0);
    const tHours = sum((d) => d.rostered.hours);
    const tLyHours = sum((d) => d.lastYear.hours);
    const tSales = sum((d) => d.lastYear.sales || 0);
    const projectedPct = tSales > 0 ? r1(((tHours * RATE) / tSales) * 100) : null;
    const lyPct = tSales > 0 && tLyHours > 0 ? r1(((tLyHours * RATE) / tSales) * 100) : null;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      range: { start, end, lyStart, lyEnd },
      rate: RATE, zone: ZONE,
      totals: {
        hours: r1(tHours), cost: r2(tHours * RATE),
        lyHours: r1(tLyHours), lySales: r2(tSales),
        projectedPct, lyPct, verdict: verdict(projectedPct),
        hoursVsLy: r1(tHours - tLyHours),
        comparableDays: comparable.length,
        pendingDays: out.filter((d) => d.rosterPending).length,
        noSalesDays: out.filter((d) => !d.rosterPending && d.lastYear.sales == null).length,
        open: out.reduce((a, d) => a + d.rostered.open, 0),
        unpublished: out.reduce((a, d) => a + d.rostered.unpublished, 0),
      },
      days: out,
    });
  } catch (err) {
    console.error('roster-check error:', err);
    return NextResponse.json({ error: 'Failed to build roster check' }, { status: 200 });
  }
}
