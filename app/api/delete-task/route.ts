import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

const NOTION_API_KEY = process.env.NOTION_API_KEY;

// Day of week → Notion page ID (0 = Sunday)
const DAY_PAGES: Record<number, string> = {
  0: '3403c99c0e8581fa80d7ef629e63aa9c',
  1: '3403c99c0e858139bd34e9f3873dc7ef',
  2: '3403c99c0e858133bb31f63559b18716',
  3: '3403c99c0e85814fab17e09b32693999',
  4: '3403c99c0e8581a39fd1e3587887a1e0',
  5: '3403c99c0e858192bfa7d94c8189fe3c',
  6: '3403c99c0e8581b3a01dc82031df8f09',
};

function notionDelete(blockId: string) {
  return fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blockText(block: any): string {
  if (block?.type === 'bulleted_list_item') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (block.bulleted_list_item?.rich_text || []).map((r: any) => r.plain_text).join('');
  }
  if (block?.type === 'to_do') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (block.to_do?.rich_text || []).map((r: any) => r.plain_text).join('');
  }
  return '';
}

export async function DELETE(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { blockId } = await req.json();

  if (!blockId) {
    return NextResponse.json({ error: 'Missing blockId' }, { status: 400 });
  }

  // Read the block first to see whether it's a multi-page recurring task ([D] or [MD:n]),
  // which is mirrored across all 7 day pages and must be swept everywhere.
  let raw = '';
  try {
    const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
      cache: 'no-store',
    });
    raw = blockText(await res.json()).trim();
  } catch { /* fall through to single delete */ }

  const isMultiPage = raw.startsWith('[D]') || /^\[MD:\d{1,2}\]/.test(raw);

  if (isMultiPage) {
    // Sweep all 7 day pages and delete every block with identical content.
    const pageIds = Object.values(DAY_PAGES);
    const matches: string[] = [];
    await Promise.all(pageIds.map(async (pageId) => {
      try {
        const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
          headers: {
            Authorization: `Bearer ${NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
          },
          cache: 'no-store',
        });
        const data = await res.json();
        for (const block of (data.results || [])) {
          if (blockText(block).trim() === raw) matches.push(block.id);
        }
      } catch { /* skip this page */ }
    }));

    // Always include the originally targeted block, in case it wasn't in a scanned page.
    if (!matches.includes(blockId)) matches.push(blockId);

    const results = await Promise.all(matches.map(id => notionDelete(id).then(r => r.ok).catch(() => false)));
    return NextResponse.json({ success: results.some(Boolean), deleted: results.filter(Boolean).length });
  }

  const res = await notionDelete(blockId);
  return NextResponse.json({ success: res.ok });
}
