import { NextRequest, NextResponse } from 'next/server';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
// Use the main G'DAY TIGER OS page — guaranteed accessible by NOTION_API_KEY
const STATE_PARENT_ID = '3403c99c0e858113a941c2118b3cdef9';

const notionHeaders = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStateBlock(): Promise<{ id: string; state: Record<string, string[]> }> {
  const res = await fetch(
    `https://api.notion.com/v1/blocks/${STATE_PARENT_ID}/children?page_size=100`,
    { headers: notionHeaders, cache: 'no-store' }
  );
  const data = await res.json();

  // Identify our block by: type=code AND language=json
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const codeBlock = (data.results || []).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b: any) => b.type === 'code' && b.code?.language === 'json'
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

  // No block yet — create one
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
            language: 'json',
          },
        }],
      }),
    }
  );
  const createData = await createRes.json();
  const newBlock = createData.results?.[0];
  if (newBlock) return { id: newBlock.id, state: {} };

  console.error('checked-state: failed to create block', JSON.stringify(createData));
  return { id: '', state: {} };
}

async function updateStateBlock(blockId: string, state: Record<string, string[]>) {
  await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: notionHeaders,
    body: JSON.stringify({
      code: {
        rich_text: [{ type: 'text', text: { content: JSON.stringify(state) } }],
        language: 'json',
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
  const { state } = await getStateBlock();
  return NextResponse.json({ state: cleanOldDates(state) });
}

export async function POST(req: NextRequest) {
  const { blockId, date, checked } = await req.json();
  const { id: stateBlockId, state } = await getStateBlock();
  if (!stateBlockId) return NextResponse.json({ success: false, error: 'No state block found' });

  if (checked) {
    state[date] = [...new Set([...(state[date] || []), blockId])];
  } else {
    state[date] = (state[date] || []).filter((id: string) => id !== blockId);
    if (!state[date].length) delete state[date];
  }

  await updateStateBlock(stateBlockId, cleanOldDates(state));
  return NextResponse.json({ success: true });
}
