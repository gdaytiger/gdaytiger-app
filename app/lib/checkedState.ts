import { melbNowDate } from './melbTime';
import { chunkRichText } from './richTextChunks';

// Daily To Do checked-state — one JSON code block on the OS page, { "YYYY-MM-DD": [blockId…],
// "_sticky_done": [blockId…] }. Shared by /api/checked-state and THE DOCUMENT's monthly task.
const NOTION_API_KEY = process.env.NOTION_API_KEY;
// Use the main G'DAY TIGER OS page — guaranteed accessible by NOTION_API_KEY
const STATE_PARENT_ID = '3403c99c0e858113a941c2118b3cdef9';

const notionHeaders = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getStateBlock(): Promise<{ id: string; state: Record<string, string[]> }> {
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

async function updateStateBlock(blockId: string, state: Record<string, string[]>): Promise<boolean> {
  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: notionHeaders,
    body: JSON.stringify({
      code: {
        rich_text: chunkRichText(JSON.stringify(state)),
        language: 'json',
      },
    }),
  });
  if (!res.ok) console.error('checked-state: Notion write failed', res.status, await res.text());
  return res.ok;
}

export function cleanOldDates(state: Record<string, string[]>): Record<string, string[]> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const cutoff = new Date(melbNowDate().getTime() - 8 * 24 * 60 * 60 * 1000);
  const cutoffStr = `${cutoff.getUTCFullYear()}-${pad(cutoff.getUTCMonth() + 1)}-${pad(cutoff.getUTCDate())}`;
  return Object.fromEntries(Object.entries(state).filter(([k]) => k >= cutoffStr));
}

// Apply one toggle to a state object (mutates + returns it).
function applyToggle(state: Record<string, string[]>, date: string, ids: string[], checked: boolean) {
  if (checked) {
    state[date] = [...new Set([...(state[date] || []), ...ids])];
  } else {
    state[date] = (state[date] || []).filter((id: string) => !ids.includes(id));
    if (!state[date].length) delete state[date];
  }
  return state;
}

function isApplied(state: Record<string, string[]>, date: string, ids: string[], checked: boolean) {
  const have = new Set(state[date] || []);
  return ids.every(id => have.has(id) === checked);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const MAX_ATTEMPTS = 3;


export type SetCheckedResult = { success: boolean; error?: string; attempts?: number; verified?: boolean };

// Tick / untick task ids for a date key with a verify-and-retry loop (see the
// comment in /api/checked-state — Notion has no compare-and-swap).
export async function setChecked(date: string, ids: string[], checked: boolean): Promise<SetCheckedResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { id: stateBlockId, state } = await getStateBlock();
    if (!stateBlockId) return { success: false, error: 'No state block found' };
    if (attempt > 1 && isApplied(state, date, ids, checked)) {
      return { success: true, attempts: attempt - 1 };
    }

    const ok = await updateStateBlock(stateBlockId, cleanOldDates(applyToggle(state, date, ids, checked)));
    if (!ok) return { success: false, error: 'Notion write failed' };

    await sleep(500 + Math.floor(Math.random() * 400));
    const { state: after } = await getStateBlock();
    if (isApplied(after, date, ids, checked)) return { success: true, attempts: attempt };
    console.warn(`checked-state: write for ${date} clobbered by a concurrent write — retry ${attempt}/${MAX_ATTEMPTS}`);
  }
  return { success: true, verified: false, attempts: MAX_ATTEMPTS };
}
