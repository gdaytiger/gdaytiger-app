import { NextResponse } from 'next/server';

// Reads the `price_drift_warnings` JSON code block from the TIGEROS Notion OS page.
// The block is written weekly by Apps Script `syncDriftToNotion()`
// (apps-script/ScanSuppliers.js). Pattern mirrors /api/ingredient-prices.

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';

type DriftWarning = {
  cell: string;
  label: string;
  daysStale: number | null;
  refreshDays: number;
  severity: 'yellow' | 'amber' | 'red';
  ingredientKey: string | null;
  neverSeen: boolean;
};

type DriftPayload = {
  type: 'price_drift_warnings';
  updated: string | null;
  warnings: DriftWarning[];
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

  // Find the price_drift_warnings JSON block.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const block = allBlocks.find((b: any) => {
    if (b.type !== 'code') return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (b.code?.rich_text || []).map((r: any) => r.plain_text).join('');
    return text.includes('"price_drift_warnings"');
  });

  const empty: DriftPayload = { type: 'price_drift_warnings', updated: null, warnings: [] };

  if (!block) {
    return NextResponse.json(empty);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (block.code?.rich_text || []).map((r: any) => r.plain_text).join('');
  try {
    const data = JSON.parse(text) as DriftPayload;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(empty);
  }
}
