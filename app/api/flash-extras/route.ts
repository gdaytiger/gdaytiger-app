import { NextResponse } from 'next/server';

// Reads the `flash_extras` JSON code block from the TIGEROS Notion OS page —
// last-complete-week category mix + day-part, written by SalesDaily.gs
// (runFlashExtras). Pattern mirrors /api/sales-daily.

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';

type MixRow = { category: string; net: number };
type DayPartRow = { hour: number; net: number };
type FlashExtras = {
  type: 'flash_extras'; updated: string | null; tz: string;
  week_start: string; week_end: string; mix: MixRow[]; day_part: DayPartRow[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notionFetch(path: string): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { Authorization: `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
    cache: 'no-store',
  });
  return res.json();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allBlocks: any[] = [];
  let cursor: string | undefined;
  do {
    const url = `/blocks/${NOTION_PAGE_ID}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const data = await notionFetch(url);
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const block = allBlocks.find((b: any) => {
    if (b.type !== 'code') return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (b.code?.rich_text || []).map((r: any) => r.plain_text).join('');
    return text.includes('"flash_extras"');
  });

  const empty = { ready: false, updated: null, weekStart: null, weekEnd: null, mix: [], dayPart: [] };
  if (!block) return NextResponse.json(empty);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (block.code?.rich_text || []).map((r: any) => r.plain_text).join('');
  try {
    const p = JSON.parse(text) as FlashExtras;
    const mixTotal = (p.mix || []).reduce((s, r) => s + (r.net || 0), 0);
    const dpTotal = (p.day_part || []).reduce((s, r) => s + (r.net || 0), 0);
    return NextResponse.json({
      ready: (p.mix?.length || 0) > 0 || (p.day_part?.length || 0) > 0,
      updated: p.updated, weekStart: p.week_start, weekEnd: p.week_end,
      mix: (p.mix || []).map((r) => ({ category: r.category, net: round2(r.net), pct: mixTotal > 0 ? round2((r.net / mixTotal) * 100) : 0 })),
      dayPart: (p.day_part || []).map((r) => ({ hour: r.hour, net: round2(r.net), pct: dpTotal > 0 ? round2((r.net / dpTotal) * 100) : 0 })),
    });
  } catch {
    return NextResponse.json(empty);
  }
}
