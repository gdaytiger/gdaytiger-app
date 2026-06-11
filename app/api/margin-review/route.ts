import { NextResponse } from 'next/server';

// Reads the `margin_review` JSON code block from the TIGEROS Notion OS page.
// The block is written weekly (Mondays 6am) by Apps Script
// `runWeeklyMarginReview()` (apps-script/MarginReview.js).
// Pattern mirrors /api/price-drift.

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';

type MarginReviewItem = {
  name: string;
  category: string;
  margin: number;
  sell: number;
  weeklyQty: number;
  weeklyGross: number;
  shortfall: number;
  severity: 'red' | 'amber';
};

type MarginReviewPayload = {
  type: 'margin_review';
  updated: string | null;
  weekStart?: string;
  weekEnd?: string;
  targetMargin?: number;
  items: MarginReviewItem[];
  totalShortfall?: number;
  greenCount?: number;
  unmatched?: { name: string; weeklyQty: number; weeklyGross: number }[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notionFetch(path: string): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
    cache: 'no-store',
  });
  return res.json();
}

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
    return text.includes('"margin_review"');
  });

  const empty: MarginReviewPayload = { type: 'margin_review', updated: null, items: [] };

  if (!block) {
    return NextResponse.json(empty);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (block.code?.rich_text || []).map((r: any) => r.plain_text).join('');
  try {
    const data = JSON.parse(text) as MarginReviewPayload;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(empty);
  }
}
