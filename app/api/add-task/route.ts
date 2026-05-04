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

async function getPageChildren(pageId: string): Promise<any[]> {
  const blocks: any[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
    });
    const data = await res.json();
    blocks.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

export async function POST(req: NextRequest) {
  const { date, text, category } = await req.json();

  if (!date || !text?.trim()) {
    return NextResponse.json({ error: 'Missing date or text' }, { status: 400 });
  }

  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const dayOfWeek = d.getDay();
  const pageId = DAY_PAGES[dayOfWeek];

  if (!pageId) {
    return NextResponse.json({ error: 'No page for that day' }, { status: 400 });
  }

  // Prefix with date so the cleanup logic can auto-delete after the day passes
  const content = `[${date}] ${text.trim()}`;

  const newBlock = {
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content } }],
    },
  };

  // If a category is provided, find the matching heading and insert after
  // the last task in that section rather than appending to the page end
  if (category) {
    const children = await getPageChildren(pageId);

    // Find the index of the matching heading
    const headingIndex = children.findIndex(block => {
      const isHeading = block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3';
      if (!isHeading) return false;
      const richText = block[block.type]?.rich_text ?? [];
      const headingText = richText.map((t: any) => t.plain_text).join('').trim();
      return headingText.toUpperCase() === category.toUpperCase();
    });

    if (headingIndex !== -1) {
      // Find the last non-heading block in this section (before next heading or end)
      let insertAfterId = children[headingIndex].id;
      for (let i = headingIndex + 1; i < children.length; i++) {
        const block = children[i];
        const isHeading = block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3';
        if (isHeading) break;
        insertAfterId = block.id;
      }

      const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ after: insertAfterId, children: [newBlock] }),
      });

      const data = await res.json();
      if (data.object === 'error') {
        return NextResponse.json({ error: data.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, blockId: data.results?.[0]?.id });
    }
    // Heading not found on target page — fall through to append at end
  }

  // Default: append to end of page
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ children: [newBlock] }),
  });

  const data = await res.json();
  if (data.object === 'error') {
    return NextResponse.json({ error: data.message }, { status: 400 });
  }
  return NextResponse.json({ success: true, blockId: data.results?.[0]?.id });
}
