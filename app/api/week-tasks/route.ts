import { NextResponse } from 'next/server';

const NOTION_API_KEY = process.env.NOTION_API_KEY;

const DAY_PAGES: Record<number, string> = {
  0: '3403c99c0e8581fa80d7ef629e63aa9c',
  1: '3403c99c0e858139bd34e9f3873dc7ef',
  2: '3403c99c0e858133bb31f63559b18716',
  3: '3403c99c0e85814fab17e09b32693999',
  4: '3403c99c0e8581a39fd1e3587887a1e0',
  5: '3403c99c0e858192bfa7d94c8189fe3c',
  6: '3403c99c0e8581b3a01dc82031df8f09',
};

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

const DATE_PREFIX_RE = /^\[(\d{4}-\d{2}-\d{2})\]\s*/;

function deleteBlock(blockId: string) {
  fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
  }).catch(() => {});
}

async function getTasksForDay(dateStr: string): Promise<{ id: string; text: string; checked: boolean }[]> {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const dayOfWeek = d.getDay();
  const pageId = DAY_PAGES[dayOfWeek];

  const weekNum = getISOWeek(d);
  const isOddWeek = weekNum % 2 === 1;

  const pad = (n: number) => String(n).padStart(2, '0');
  const melbNow = new Date(Date.now() + 10 * 60 * 60 * 1000);
  const todayStr = `${melbNow.getUTCFullYear()}-${pad(melbNow.getUTCMonth() + 1)}-${pad(melbNow.getUTCDate())}`;

  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
    cache: 'no-store',
  });
  const data = await res.json();

  const tasks = [];
  for (const block of (data.results || [])) {
    if (block.type !== 'bulleted_list_item') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (block.bulleted_list_item?.rich_text || []).map((r: any) => r.plain_text).join('');
    if (!raw.trim()) continue;

    // [YYYY-MM-DD] prefix = one-off task added via app
    const dateMatch = raw.match(DATE_PREFIX_RE);
    if (dateMatch) {
      const taskDate = dateMatch[1];
      if (taskDate < todayStr) {
        deleteBlock(block.id);
        continue;
      }
      if (taskDate === dateStr) {
        tasks.push({ id: block.id, text: raw.replace(DATE_PREFIX_RE, '').trim(), checked: false });
      }
      continue;
    }

    if (raw.startsWith('[F]')) {
      if (!isOddWeek) continue;
      tasks.push({ id: block.id, text: raw.replace('[F]', '').trim(), checked: false });
      continue;
    }
    if (raw.startsWith('[M]')) {
      if (d.getDate() > 7) continue;
      tasks.push({ id: block.id, text: raw.replace('[M]', '').trim(), checked: false });
      continue;
    }
    tasks.push({ id: block.id, text: raw.trim(), checked: false });
  }
  return tasks;
}

export async function GET() {
  const pad = (n: number) => String(n).padStart(2, '0');
  const melbNow = new Date(Date.now() + 10 * 60 * 60 * 1000);

  const dateStrs = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(melbNow.getTime() + i * 24 * 60 * 60 * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });

  const taskArrays = await Promise.all(dateStrs.map(getTasksForDay));

  const days: Record<string, { count: number; tasks: { id: string; text: string; checked: boolean }[] }> = {};
  dateStrs.forEach((dateStr, i) => {
    days[dateStr] = { count: taskArrays[i].length, tasks: taskArrays[i] };
  });

  return NextResponse.json({ days });
}
