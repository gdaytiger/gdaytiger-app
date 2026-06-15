import { NextResponse } from 'next/server';

// Reads the `sales_daily` JSON code block from the TIGEROS Notion OS page.
// Written daily (~12:30am) + backfilled by Apps Script SalesDaily.gs, which
// polls Square Orders and buckets sales by Melbourne trading day.
// Pattern mirrors /api/payment-fees and /api/margin-review.
//
// Pair this with /api/labour (Deputy hours+cost per day) to compute
// staff cost % per day:  labour.cost ÷ sales.gross.

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';

type SalesDay = {
  date: string;
  weekday: string;
  gross: number; // incl GST, excl tips
  net: number;   // ex-GST (gross / 1.1)
  tax: number;
  tip: number;
  orders: number;
};

type SalesDailyPayload = {
  type: 'sales_daily';
  updated: string | null;
  tz: string;
  days: SalesDay[];
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
    return text.includes('"sales_daily"');
  });

  const empty: SalesDailyPayload = {
    type: 'sales_daily', updated: null, tz: 'Australia/Melbourne', days: [],
  };

  if (!block) {
    return NextResponse.json(empty);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (block.code?.rich_text || []).map((r: any) => r.plain_text).join('');
  try {
    const payload = JSON.parse(text) as SalesDailyPayload;
    return NextResponse.json(payload);
  } catch {
    // Block exists but the JSON is malformed (mid-write race) — fail soft.
    return NextResponse.json(empty);
  }
}
