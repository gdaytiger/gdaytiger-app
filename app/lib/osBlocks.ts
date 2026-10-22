import { notionFetch } from './notion';

// Read/write a JSON code block on the TIGEROS Notion OS page, matched by the
// `"type": "<name>"` string inside it. Same storage pattern the Apps Script
// feeds use (sales_daily, flash_extras, morning_brief…).

const OS_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listOsBlocks(): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let all: any[] = [];
  let cursor: string | undefined;
  do {
    const data = await notionFetch(`/blocks/${OS_PAGE_ID}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    all = all.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return all;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const blockText = (b: any): string => (b.code?.rich_text || []).map((r: any) => r.plain_text).join('');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findBlock(blocks: any[], type: string) {
  const re = new RegExp(`"type"\\s*:\\s*"${type}"`);
  return blocks.find(b => b.type === 'code' && re.test(blockText(b)));
}

export async function readOsBlocks<T extends Record<string, unknown>>(types: string[]): Promise<Record<string, T | null>> {
  const blocks = await listOsBlocks();
  const out: Record<string, T | null> = {};
  for (const t of types) {
    const b = findBlock(blocks, t);
    try { out[t] = b ? JSON.parse(blockText(b)) : null; } catch { out[t] = null; }
  }
  return out;
}

export async function readOsBlock<T extends Record<string, unknown>>(type: string): Promise<T | null> {
  return (await readOsBlocks<T>([type]))[type];
}

export async function writeOsBlock(type: string, payload: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify({ ...payload, type });
  const chunks = [];
  for (let i = 0; i < json.length; i += 1900) chunks.push({ type: 'text', text: { content: json.slice(i, i + 1900) } });
  const block = { type: 'code', code: { language: 'json', rich_text: chunks } };
  const existing = findBlock(await listOsBlocks(), type);
  if (existing) await notionFetch(`/blocks/${existing.id}`, 'PATCH', block);
  else await notionFetch(`/blocks/${OS_PAGE_ID}/children`, 'PATCH', { children: [block] });
}
