import { NextRequest, NextResponse } from 'next/server';
const NOTION_API_KEY = process.env.NOTION_API_KEY;
export async function PATCH(req: NextRequest) {
  const { projectId, status } = await req.json();
  await fetch(`https://api.notion.com/v1/pages/${projectId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { Status: { select: { name: status } } } }),
  });
  return NextResponse.json({ success: true });
}
