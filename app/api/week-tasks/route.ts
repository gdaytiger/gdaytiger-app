import { NextResponse } from 'next/server';
import {
  DAY_PAGES,
  parseDayTaskBlocks,
  formatYMD,
  ParsedTask,
  getCheckedState,
  fetchStickyCandidates,
  STICKY_DONE_KEY,
} from '@/app/lib/dayTasks';

const NOTION_API_KEY = process.env.NOTION_API_KEY;

async function getTasksForDay(dateStr: string, todayStr: string): Promise<ParsedTask[]> {
  const [year, month, day] = dateStr.split('-').map(Number);
  const renderDate = new Date(year, month - 1, day);
  const pageId = DAY_PAGES[renderDate.getDay()];

  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
    cache: 'no-store',
  });
  const data = await res.json();
  return parseDayTaskBlocks(data.results || [], { renderDate, todayStr });
}

export async function GET() {
  const melbNow = new Date(Date.now() + 10 * 60 * 60 * 1000);
  const todayStr = formatYMD(melbNow);

  const dateStrs = Array.from({ length: 7 }, (_, i) =>
    formatYMD(new Date(melbNow.getTime() + i * 24 * 60 * 60 * 1000))
  );

  // Day tasks, checked-state and [STICKY] candidates are independent — fetch together.
  const [taskArrays, checkedState, stickyCandidates] = await Promise.all([
    Promise.all(dateStrs.map(d => getTasksForDay(d, todayStr))),
    getCheckedState(),
    fetchStickyCandidates(melbNow),
  ]);

  // Persistent tasks that haven't been permanently ticked off. They appear on the
  // Daily To Do every day until done, so they belong in every day's list (and count).
  const stickyDone = new Set(checkedState[STICKY_DONE_KEY] || []);
  const activeStickies = stickyCandidates.filter(c => !stickyDone.has(c.id));

  const days: Record<string, { count: number; tasks: ParsedTask[] }> = {};
  dateStrs.forEach((dateStr, i) => {
    const tasks = taskArrays[i];
    const checkedForDay = new Set(checkedState[dateStr] || []);
    const movedForDay = new Set(checkedState[`${dateStr}:moved`] || []);

    // Inject active stickies that have started showing by this date and weren't
    // moved away from it. Placed under their original header, mirroring the dashboard.
    for (const s of activeStickies) {
      if (s.startDate && s.startDate > dateStr) continue;
      if (movedForDay.has(s.id)) continue;
      const stickyTask: ParsedTask = { id: s.id, text: s.text, checked: false, isRecurring: false, isSticky: true };
      const headerIdx = tasks.findIndex(t => t.isHeader && t.text === s.header);
      if (headerIdx !== -1) tasks.splice(headerIdx + 1, 0, stickyTask);
      else tasks.unshift({ id: `header-sticky-${s.header}`, text: s.header, checked: false, isHeader: true }, stickyTask);
    }

    // Count = unchecked, non-header tasks not moved away from this day. The client
    // re-derives this from enriched state, but keep the server value consistent.
    const count = tasks.filter(
      t => !t.id.startsWith('header-') && !checkedForDay.has(t.id) && !movedForDay.has(t.id)
    ).length;
    days[dateStr] = { count, tasks };
  });

  return NextResponse.json(
    { days },
    { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' } }
  );
}
