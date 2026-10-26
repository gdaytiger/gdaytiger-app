import { notionFetch } from './notion';
import { DAY_PAGES, shiftYMD } from './dayTasks';
import type { MorningSnapshot } from './morning';

// Monday: write last week's cash tally as child to_dos under the "DO THE BANKING"
// task on the Monday Notion day page. The dashboard shows them as subtasks.
// One line: "Cash vs Square: +$181.30 over (counted $2,015.70, Square $1,834.40)".
// Idempotent — skips if that exact line is already there (so a tick survives re-runs),
// otherwise replaces last week's.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return { d, m: MONTHS[m - 1] }; };
const money = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const textOf = (b: any) => (b[b.type]?.rich_text || []).map((r: any) => r.plain_text).join('');

export async function writeBankingTally(week: NonNullable<NonNullable<MorningSnapshot['cash']>['week']>): Promise<string> {
  if (!week.complete || !week.daysCounted) return 'skipped: week not complete';
  const a = dm(week.weekStart), b = dm(shiftYMD(week.weekStart, 6));
  const label = a.m === b.m ? `${a.d}–${b.d} ${b.m}` : `${a.d} ${a.m}–${b.d} ${b.m}`;

  const page = await notionFetch(`/blocks/${DAY_PAGES[1]}/children?page_size=100`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const task = (page.results || []).find((x: any) => /do the banking/i.test(textOf(x)));
  if (!task) return 'skipped: no DO THE BANKING task on Monday page';

  const kids = (await notionFetch(`/blocks/${task.id}/children?page_size=50`)).results || [];
  const v = week.variance;
  const line = `Cash vs Square: ${signed(v)} ${Math.abs(v) < 1 ? 'balanced' : v > 0 ? 'over' : 'short'} (counted ${money(week.counted)}, Square ${money(week.square)})`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (kids.some((k: any) => textOf(k) === line)) return `skipped: already written (${label})`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await Promise.all(kids.map((k: any) => notionFetch(`/blocks/${k.id}`, 'DELETE')));

  const lines = [line];

  await notionFetch(`/blocks/${task.id}/children`, 'PATCH', {
    children: lines.map(t => ({ type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: t } }], checked: false } })),
  });
  return `written: ${label}`;
}

// Monday safety net, called from /api/dashboard: build last week's tally straight
// from the Apps Script `morning_brief` block (no dependency on the 5am push cron)
// and write it if it isn't there yet. Only acts when the brief's week is the
// Mon–Sun that ended yesterday.
export async function ensureBankingTally(todayYmd: string): Promise<string> {
  const { readOsBlock } = await import('./osBlocks');
  type CashDay = { date: string; weekday: string; square: number; counted: number | null };
  const brief = await readOsBlock<{ cashWeek?: { weekStart: string; sheetFound: boolean; complete: boolean; days: CashDay[] } }>('morning_brief');
  const cw = brief?.cashWeek;
  if (!cw?.complete || cw.weekStart !== shiftYMD(todayYmd, -7)) return 'skipped: no completed week for today';
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const days = cw.days.map(d => ({ ...d, variance: d.counted == null ? null : r2(d.counted - d.square) }));
  const counted = days.filter(d => d.counted != null);
  const square = r2(counted.reduce((a, d) => a + d.square, 0));
  const total = r2(counted.reduce((a, d) => a + (d.counted as number), 0));
  return writeBankingTally({ weekStart: cw.weekStart, complete: true, sheetFound: cw.sheetFound, square, counted: total, variance: r2(total - square), daysCounted: counted.length, days });
}
