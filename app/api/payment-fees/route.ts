import { NextResponse } from 'next/server';

// Reads the `payment_fees` JSON code block from the TIGEROS Notion OS page.
// The block is written by Apps Script `runDailyPaymentFeeUpdate()` (daily
// ~1am) and `runPaymentFeeBackfillStep()` (apps-script/PaymentFeeTracker.js).
// Pattern mirrors /api/margin-review.

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';

type PaymentFeesPayload = {
  type: 'payment_fees';
  updated: string | null;
  daysCovered: number;
  totalCollected: number;
  totalFees: number;
  feePct: number | null;
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
    return text.includes('"payment_fees"');
  });

  const empty: PaymentFeesPayload = {
    type: 'payment_fees', updated: null, daysCovered: 0, totalCollected: 0, totalFees: 0, feePct: null,
  };

  if (!block) {
    return NextResponse.json(empty);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (block.code?.rich_text || []).map((r: any) => r.plain_text).join('');
  try {
    const data = JSON.parse(text) as PaymentFeesPayload;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(empty);
  }
}
