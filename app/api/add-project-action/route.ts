import { NextRequest, NextResponse } from 'next/server';
const NOTION_API_KEY = process.env.NOTION_API_KEY;
export async function POST(req: NextRequest) {
  const { projectId, text, texts } = await req.json();
  // Accept either a single `text` or a batch `texts[]` (used by AI capture).
  const list: string[] = (Array.isArray(texts) ? texts : [text])
    .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t: string) => t.trim());
  if (!projectId || list.length === 0) {
    return NextResponse.json({ error: 'projectId and at least one action required.' }, { status: 400 });
  }
  await fetch(`https://api.notion.com/v1/blocks/${projectId}/children`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ children: list.map((t) => ({ type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: t } }], checked: false } })) }),
  });
  return NextResponse.json({ success: true });
}
