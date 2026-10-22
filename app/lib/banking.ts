import { notionFetch } from './notion';
import { DAY_PAGES, shiftYMD } from './dayTasks';
import type { MorningSnapshot } from './morning';

// Monday: write last week's cash tally as child to_dos under the "DO THE BANKING"
// task on the Monday Notion day page. The dashboard shows them as subtasks.
// Idempotent — skips if this week's tally is already there (so ticks survive re-runs),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (kids.some((k: any) => textOf(k).includes(`(${label})`))) return 'skipped: already written';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await Promise.all(kids.map((k: any) => notionFetch(`/blocks/${k.id}`, 'DELETE')));

  const v = week.variance;
  const lines = [
    `Bank ${money(week.counted)} cash (${label})`,
    `Cash vs Square: ${signed(v)} ${Math.abs(v) < 1 ? '— balanced' : v > 0 ? 'over' : 'short'} (counted ${money(week.counted)}, Square ${money(week.square)})`,
    week.days.map(d => `${d.weekday} ${d.variance == null ? 'n/a' : signed(d.variance)}`).join(' · '),
  ];
  const missing = week.days.filter(d => d.counted == null).map(d => d.weekday);
  if (missing.length) lines.push(`Not cashed up: ${missing.join(', ')}`);

  await notionFetch(`/blocks/${task.id}/children`, 'PATCH', {
    children: lines.map(t => ({ type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: t } }], checked: false } })),
  });
  return `written: ${label}`;
}
