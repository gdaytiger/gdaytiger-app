import { NextResponse } from 'next/server';
import { DAY_PAGES, parseDayTaskBlocks, formatYMD, ParsedTask } from '@/app/lib/dayTasks';

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

  const taskArrays = await Promise.all(dateStrs.map(d => getTasksForDay(d, todayStr)));

  // Persistent [STICKY] tasks are intentionally NOT injected here — they live only
  // on the current day (rolling forward until ticked), so they're counted via the
  // dashboard's daily list, not pre-populated across future days.
  const days: Record<string, { count: number; tasks: ParsedTask[] }> = {};
  dateStrs.forEach((dateStr, i) => {
    const tasks = taskArrays[i];
    const count = tasks.filter(t => !t.id.startsWith('header-')).length;
    days[dateStr] = { count, tasks };
  });

  return NextResponse.json(
    { days },
    { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' } }
  );
}
