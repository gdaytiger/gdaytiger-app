import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const STATE_PARENT_ID = '3403c99c0e858113a941c2118b3cdef9';

const notionHeaders = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

// Identified by type=code AND language=javascript (checked-state uses 'json')
async function getContextBlock(): Promise<{ id: string; context: Record<string, string> }> {
  const res = await fetch(
    `https://api.notion.com/v1/blocks/${STATE_PARENT_ID}/children?page_size=100`,
    { headers: notionHeaders, cache: 'no-store' }
  );
  const data = await res.json();

  const codeBlock = (data.results || []).find(
    (b: any) => b.type === 'code' && b.code?.language === 'javascript'
  );

  if (codeBlock) {
    const text = (codeBlock.code?.rich_text || []).map((r: any) => r.plain_text).join('');
    try {
      return { id: codeBlock.id, context: JSON.parse(text || '{}') };
    } catch {
      return { id: codeBlock.id, context: {} };
    }
  }

  // Create block if it doesn't exist yet
  const createRes = await fetch(
    `https://api.notion.com/v1/blocks/${STATE_PARENT_ID}/children`,
    {
      method: 'PATCH',
      headers: notionHeaders,
      body: JSON.stringify({
        children: [{
          type: 'code',
          code: {
            rich_text: [{ type: 'text', text: { content: '{}' } }],
            language: 'javascript',
          },
        }],
      }),
    }
  );
  const createData = await createRes.json();
  const newBlock = createData.results?.[0];
  if (newBlock) return { id: newBlock.id, context: {} };

  return { id: '', context: {} };
}

async function updateContextBlock(blockId: string, context: Record<string, string>) {
  await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: notionHeaders,
    body: JSON.stringify({
      code: {
        rich_text: [{ type: 'text', text: { content: JSON.stringify(context) } }],
        language: 'javascript',
      },
    }),
  });
}

export async function GET() {
  const { context } = await getContextBlock();
  return NextResponse.json({ context });
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { blockId, text } = await req.json();
  if (!blockId) return NextResponse.json({ error: 'Missing blockId' }, { status: 400 });

  const { id: contextBlockId, context } = await getContextBlock();
  if (!contextBlockId) return NextResponse.json({ success: false, error: 'No context block' });

  if (text?.trim()) {
    context[blockId] = text.trim();
  } else {
    delete context[blockId];
  }

  await updateContextBlock(contextBlockId, context);
  return NextResponse.json({ success: true });
}
