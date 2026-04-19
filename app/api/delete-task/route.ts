import { NextRequest, NextResponse } from 'next/server';

const NOTION_API_KEY = process.env.NOTION_API_KEY;

export async function DELETE(req: NextRequest) {
  const { blockId } = await req.json();

  if (!blockId) {
    return NextResponse.json({ error: 'Missing blockId' }, { status: 400 });
  }

  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
  });

  return NextResponse.json({ success: res.ok });
}
