import { NextRequest, NextResponse } from 'next/server';

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

export async function POST(req: NextRequest) {
  const { date, text } = await req.json();

  if (!date || !text?.trim()) {
    return NextResponse.json({ error: 'Missing date or text' }, { status: 400 });
  }

  // Get day of week from date string (Melbourne — treat as local date)
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const dayOfWeek = d.getDay();
  const pageId = DAY_PAGES[dayOfWeek];

  if (!pageId) {
    return NextResponse.json({ error: 'No page for that day' }, { status: 400 });
  }

  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      children: [
        {
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: text.trim() } }],
          },
        },
      ],
    }),
  });

  const data = await res.json();

  if (data.object === 'error') {
    return NextResponse.json({ error: data.message }, { status: 400 });
  }

  const newBlock = data.results?.[0];
  return NextResponse.json({ success: true, blockId: newBlock?.id });
}
