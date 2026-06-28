import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
// Same G'DAY TIGER OS page used by checked-state — guaranteed accessible by NOTION_API_KEY.
const STATE_PARENT_ID = '3403c99c0e858113a941c2118b3cdef9';
// The manual task-order map lives in its own code block. checked-state finds the
// first code block with language 'json', so we tag this one 'yaml' (we still store
// JSON text inside) to keep the two stores from colliding on the same page.
const ORDER_LANG = 'yaml';

const notionHeaders = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

async function getOrderBlock(): Promise<{ id: string; state: Record<string, string[]> }> {
  const res = await fetch(
    `https://api.notion.com/v1/blocks/${STATE_PARENT_ID}/children?page_size=100`,
    { headers: notionHeaders, cache: 'no-store' }
  );
  const data = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const codeBlock = (data.results || []).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b: any) => b.type === 'code' && b.code?.language === ORDER_LANG
  );

  if (codeBlock) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (codeBlock.code?.rich_text || []).map((r: any) => r.plain_text).join('');
    try {
      return { id: codeBlock.id, state: JSON.parse(text || '{}') };
    } catch {
      return { id: codeBlock.id, state: {} };
    }
  }

  // No block yet — create one.
  const createRes = await fetch(
    `https://api.notion.com/v1/blocks/${STATE_PARENT_ID}/children`,
    {
      method: 'PATCH',
      headers: notionHeaders,
      body: JSON.stringify({
        children: [{
          type: 'code',
          code: {
            rich_text: [{ type: 'text', text: { content: '{}' } }],
            language: ORDER_LANG,
          },
        }],
      }),
    }
  );
  const createData = await createRes.json();
  const newBlock = createData.results?.[0];
  if (newBlock) return { id: newBlock.id, state: {} };

  console.error('task-order: failed to create block', JSON.stringify(createData));
  return { id: '', state: {} };
}

async function updateOrderBlock(blockId: string, state: Record<string, string[]>) {
  await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: notionHeaders,
    body: JSON.stringify({
      code: {
        rich_text: [{ type: 'text', text: { content: JSON.stringify(state) } }],
        language: ORDER_LANG,
      },
    }),
  });
}

function cleanOldDates(state: Record<string, string[]>): Record<string, string[]> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const cutoff = new Date(Date.now() + 10 * 60 * 60 * 1000 - 8 * 24 * 60 * 60 * 1000);
  const cutoffStr = `${cutoff.getUTCFullYear()}-${pad(cutoff.getUTCMonth() + 1)}-${pad(cutoff.getUTCDate())}`;
  return Object.fromEntries(Object.entries(state).filter(([k]) => k >= cutoffStr));
}

export async function GET() {
  const { state } = await getOrderBlock();
  return NextResponse.json({ order: cleanOldDates(state) });
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { date, ids } = await req.json();
  if (!date || !Array.isArray(ids)) {
    return NextResponse.json({ success: false, error: 'date and ids[] required' });
  }
  const { id: orderBlockId, state } = await getOrderBlock();
  if (!orderBlockId) return NextResponse.json({ success: false, error: 'No order block found' });

  state[date] = ids;
  await updateOrderBlock(orderBlockId, cleanOldDates(state));
  return NextResponse.json({ success: true });
}
