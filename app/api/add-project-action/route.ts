import { NextRequest, NextResponse } from 'next/server';
const NOTION_API_KEY = process.env.NOTION_API_KEY;
export async function POST(req: NextRequest) {
  const { projectId, text } = await req.json();
  await fetch(`https://api.notion.com/v1/blocks/${projectId}/children`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ children: [{ type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: text } }], checked: false } }] }),
  });
  return NextResponse.json({ success: true });
}
