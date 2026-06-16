import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { formatYMD } from '@/app/lib/dayTasks';

const NOTION_API_KEY = process.env.NOTION_API_KEY;

// Convert an existing task block to a persistent [STICKY:date] task by rewriting
// its Notion block text. The date is today in Melbourne — "starts showing from
// today". The dashboard's cross-page scan (fetchCarryAndStickyCandidates) will
// surface it every day from that date onward until ticked off, same as any other
// [STICKY:date] block.
//
// Accepts { blockId, text } where text is the display text (already stripped of
// any existing prefix by parseDayTaskBlocks on the client). The block is rewritten
// as a bulleted_list_item with content "[STICKY:YYYY-MM-DD] TEXT".
export async function PATCH(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { blockId, text } = await req.json();
  if (!blockId || !text?.trim()) {
    return NextResponse.json({ error: 'Missing blockId or text' }, { status: 400 });
  }

  // Melbourne time = UTC+10 (AEST). Using fixed offset matches dashboard/route.ts.
  const today = new Date(new Date().getTime() + 10 * 60 * 60 * 1000);
  const todayStr = formatYMD(today);
  const content = `[STICKY:${todayStr}] ${text.trim()}`;

  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content } }],
      },
    }),
  });

  const data = await res.json();
  if (data.object === 'error') {
    return NextResponse.json({ error: data.message }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
