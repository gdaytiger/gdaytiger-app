import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

const NOTION_API_KEY = process.env.NOTION_API_KEY;

// Rewrite a shopping item's text — used to adjust its quantity (e.g. "basil ×2").
export async function PATCH(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { blockId, text } = await req.json();
  if (!blockId || !text?.trim()) {
    return NextResponse.json({ error: 'Missing blockId or text' }, { status: 400 });
  }

  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to_do: {
        rich_text: [{ type: 'text', text: { content: text.trim() } }],
      },
    }),
  });

  const data = await res.json();
  if (data.object === 'error') {
    return NextResponse.json({ error: data.message }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
