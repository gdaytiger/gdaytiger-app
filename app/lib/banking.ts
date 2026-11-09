import { notionFetch } from './notion';
import { DAY_PAGES, shiftYMD } from './dayTasks';
import { readOsBlock, writeOsBlock } from './osBlocks';
import type { MorningSnapshot } from './morning';

// CASH DIFFERENCE (CD) LEDGER — Nov 2026.
// Each completed Mon–Sun week's cash variance (counted CASH SALES on the staff
// cash-up sheet − cash Square recorded, counted days only) is stored in the
// `cash_ledger` OS block. Weekly Flash reads it for the "CD" row: last week +
// calendar-year running total. Replaces the old "Cash vs Square" subtask that
// was written under Monday's DO THE BANKING task.
//
// Writers: this file (Monday, from the push + dashboard) and Apps Script
// MorningBrief.js (nightly upsert + one-off backfillCashLedger for the year).
// Both merge by week — neither overwrites the other's weeks wholesale.

export type CashLedgerWeek = { square: number; counted: number; variance: number; n: number; days: [string, number][] };
export type CashLedger = { type?: string; updated?: string; weeks: Record<string, CashLedgerWeek> };

type CashWeek = NonNullable<NonNullable<MorningSnapshot['cash']>['week']>;
const r2 = (n: number) => Math.round(n * 100) / 100;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const textOf = (b: any) => (b[b.type]?.rich_text || []).map((r: any) => r.plain_text).join('');
const KEEP_WEEKS = 70; // current calendar year + a little of last

export async function recordCashWeek(week: CashWeek): Promise<string> {
  if (!week.complete || !week.daysCounted) return 'skipped: week not complete';
  const entry: CashLedgerWeek = {
    square: r2(week.square), counted: r2(week.counted), variance: r2(week.variance), n: week.daysCounted,
    days: week.days.filter(d => d.variance != null).map(d => [d.date, r2(d.variance as number)]),
  };
  // Null means absent OR a failed Notion read (readOsBlock can't tell which), so
  // never create the ledger from here — a blip would replace the year with one
  // week. Apps Script creates it (its read throws on failure).
  const cur = await readOsBlock<CashLedger>('cash_ledger');
  const prev = cur?.weeks?.[week.weekStart];
  let msg = cur ? 'unchanged' : 'skipped: cash_ledger not readable';
  if (cur && (!prev || prev.variance !== entry.variance || prev.n !== entry.n)) {
    const weeks = { ...(cur.weeks || {}), [week.weekStart]: entry };
    const keep = Object.keys(weeks).sort().slice(-KEEP_WEEKS);
    await writeOsBlock('cash_ledger', { updated: new Date().toISOString(), weeks: Object.fromEntries(keep.map(k => [k, weeks[k]])) });
    msg = `recorded ${week.weekStart}`;
  }
  await clearBankingSubtask().catch(() => {});
  return msg;
}

// One-off cleanup: remove any old "Cash vs Square" line under DO THE BANKING.
async function clearBankingSubtask() {
  const page = await notionFetch(`/blocks/${DAY_PAGES[1]}/children?page_size=100`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const task = (page.results || []).find((x: any) => /do the banking/i.test(textOf(x)));
  if (!task?.has_children) return;
  const kids = (await notionFetch(`/blocks/${task.id}/children?page_size=50`)).results || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await Promise.all(kids.filter((k: any) => /^cash vs square/i.test(textOf(k))).map((k: any) => notionFetch(`/blocks/${k.id}`, 'DELETE')));
}

// Monday safety net, called from /api/dashboard: build last week's figures
// straight from the Apps Script `morning_brief` block (no dependency on the
// push) and record them. Only acts when the brief's week ended yesterday.
export async function ensureCashLedger(todayYmd: string): Promise<string> {
  type CashDay = { date: string; weekday: string; square: number; counted: number | null };
  const brief = await readOsBlock<{ cashWeek?: { weekStart: string; sheetFound: boolean; complete: boolean; days: CashDay[] } }>('morning_brief');
  const cw = brief?.cashWeek;
  if (!cw?.complete || cw.weekStart !== shiftYMD(todayYmd, -7)) return 'skipped: no completed week for today';
  const days = cw.days.map(d => ({ ...d, variance: d.counted == null ? null : r2(d.counted - d.square) }));
  const counted = days.filter(d => d.counted != null);
  const square = r2(counted.reduce((a, d) => a + d.square, 0));
  const total = r2(counted.reduce((a, d) => a + (d.counted as number), 0));
  return recordCashWeek({ weekStart: cw.weekStart, complete: true, sheetFound: cw.sheetFound, square, counted: total, variance: r2(total - square), daysCounted: counted.length, days });
}
