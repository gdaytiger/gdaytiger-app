import { NextRequest, NextResponse } from 'next/server';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const STATE_PAGE_ID = '3473c99c0e85819eb3d0f1b31164ebd9';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStateBlock(): Promise<{ id: string; state: Record<string, string[]> }> {
  const res = await fetch(`https://api.notion.com/v1/blocks/${STATE_PAGE_ID}/children?page_size=10`, {
    headers: { Authorization: `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
    cache: 'no-store',
  });
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const codeBlock = (data.results || []).find((b: any) => b.type === 'code');
  if (!codeBlock) return { id: '', state: {} };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (codeBlock.code?.rich_text || []).map((r: any) => r.plain_text).join('');
  try { return { id: codeBlock.id, state: JSON.parse(text || '{}') }; }
  catch { return { id: codeBlock.id, state: {} }; }
}

async function updateStateBlock(blockId: string, state: Record<string, string[]>) {
  await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: { rich_text: [{ type: 'text', text: { content: JSON.stringify(state) } }], language: 'json' } }),
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
