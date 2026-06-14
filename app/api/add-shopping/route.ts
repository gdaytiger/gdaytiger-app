import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const SHOPPING_PAGE_ID = '3683c99c0e8581c7b19cc2eec6b27b47';

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { text } = await req.json();
  if (!text?.trim()) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  const res = await fetch(`https://api.notion.com/v1/blocks/${SHOPPING_PAGE_ID}/children`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      children: [{
        type: 'to_do',
        to_do: {
          checked: false,
          rich_text: [{ type: 'text', text: { content: text.trim() } }],
        },
      }],
    }),
  });

  const data = await res.json();
  if (data.object === 'error') {
    return NextResponse.json({ error: data.message }, { status: 400 });
  }
  return NextResponse.json({ success: true, blockId: data.results?.[0]?.id });
}
