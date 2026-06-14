import { NextResponse } from 'next/server';
import { notionFetch } from '@/app/lib/notion';

const NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allBlocks: any[] = [];
  let cursor: string | undefined;
  do {
    const url = `/blocks/${NOTION_PAGE_ID}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const data = await notionFetch(url);
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // Find the ingredient_prices JSON block
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const block = allBlocks.find((b: any) => {
    if (b.type !== 'code') return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (b.code?.rich_text || []).map((r: any) => r.plain_text).join('');
    return text.includes('"ingredient_prices"');
  });

  if (!block) {
    return NextResponse.json({ type: 'ingredient_prices', updated: null, ingredients: [] });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (block.code?.rich_text || []).map((r: any) => r.plain_text).join('');
  try {
    const data = JSON.parse(text);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ type: 'ingredient_prices', updated: null, ingredients: [] });
  }
}
