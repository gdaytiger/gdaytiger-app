import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

const NOTION_API_KEY = process.env.NOTION_API_KEY;

// Day of week -> Notion page ID (0 = Sunday). [D] / [MD:n] tasks are mirrored
// across every day page, so a rename must sweep all of them (same approach as
// /api/delete-task) to keep the copies identical.
const DAY_PAGES: Record<number, string> = {
  0: '3403c99c0e8581fa80d7ef629e63aa9c',
  1: '3403c99c0e858139bd34e9f3873dc7ef',
  2: '3403c99c0e858133bb31f63559b18716',
  3: '3403c99c0e85814fab17e09b32693999',
  4: '3403c99c0e8581a39fd1e3587887a1e0',
  5: '3403c99c0e858192bfa7d94c8189fe3c',
  6: '3403c99c0e8581b3a01dc82031df8f09',
};

const notionHeaders = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

// Leading recurrence / pin marker that the client never sees (the dashboard
// strips it before display). It must be preserved on write, or the task loses
// its recurrence / pin behaviour. Order matters: F2 before F, MD before M, and
// the dated / STICKY variants before the bare ones.
const PREFIX_RE = /^(\[(?:F2|F|D|MD:\d{1,2}|M|CARRY|\d{4}-\d{2}-\d{2}|STICKY(?::\d{4}-\d{2}-\d{2})?(?::[0-9a-fA-F-]{32,36})?)\]\s*)/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blockType(block: any): 'to_do' | 'bulleted_list_item' | null {
  if (block?.type === 'to_do') return 'to_do';
  if (block?.type === 'bulleted_list_item') return 'bulleted_list_item';
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blockText(block: any): string {
  const t = blockType(block);
  if (!t) return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (block[t]?.rich_text || []).map((r: any) => r.plain_text).join('');
}

async function getBlock(blockId: string) {
  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    headers: notionHeaders, cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

// Write a single plain-text run to the block, keeping its type (to_do keeps its
// checked flag — Notion merges the fields we omit).
async function writeBlockText(blockId: string, type: 'to_do' | 'bulleted_list_item', content: string): Promise<boolean> {
  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH', headers: notionHeaders,
    body: JSON.stringify({ [type]: { rich_text: [{ type: 'text', text: { content } }] } }),
  });
  return res.ok;
}

export async function PATCH(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;

  const { blockId, text } = await req.json();
  if (!blockId || blockId.startsWith('header-')) {
    return NextResponse.json({ error: 'blockId required.' }, { status: 400 });
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'text required.' }, { status: 400 });
  }
  const newText = text.trim();

  const block = await getBlock(blockId);
  const type = blockType(block);
  if (!block || !type) {
    return NextResponse.json({ error: 'Task block not found.' }, { status: 404 });
  }

  const raw = blockText(block);
  const prefixMatch = raw.match(PREFIX_RE);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const newRaw = prefix + newText;

  // [D] / [MD:n] recurring tasks are copied onto every day page. Rename every
  // copy whose current content matches, so the mirror stays in sync.
  const isMultiPage = raw.trimStart().startsWith('[D]') || /^\s*\[MD:\d{1,2}\]/.test(raw);
  if (isMultiPage) {
    const target = raw.trim();
    const edits: { id: string; type: 'to_do' | 'bulleted_list_item' }[] = [];
    await Promise.all(Object.values(DAY_PAGES).map(async (pageId) => {
      try {
        const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
          headers: notionHeaders, cache: 'no-store',
        });
        const data = await res.json();
        for (const b of (data.results || [])) {
          const bt = blockType(b);
          if (bt && blockText(b).trim() === target) edits.push({ id: b.id, type: bt });
        }
      } catch { /* skip this page */ }
    }));
    if (!edits.some(e => e.id === blockId)) edits.push({ id: blockId, type });

    const results = await Promise.all(edits.map(e => writeBlockText(e.id, e.type, newRaw).catch(() => false)));
    return NextResponse.json({ success: results.some(Boolean), updated: results.filter(Boolean).length });
  }

  const ok = await writeBlockText(blockId, type, newRaw);
  if (!ok) return NextResponse.json({ error: 'Update failed.' }, { status: 400 });
  return NextResponse.json({ success: true });
}
