import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

const NOTION_API_KEY = process.env.NOTION_API_KEY;

// Reverse of /api/pin-task — strips the [STICKY...] prefix (with or without a
// linked projectId), rewriting the block back to a plain bulleted_list_item with
// just the display text. The task then behaves like any other plain entry on its
// day page (recurring weekly, no prefix) from the next load onward.
//
// Does NOT touch a linked Projects DB page — the client separately calls
// /api/archive-project (POST { projectId }) when unpinning a task that had one,
// so the checklist is archived (recoverable, 30-day Notion trash) rather than
// silently orphaned with no UI path back to it.
//
// Accepts { blockId, text } where text is the already-prefix-stripped display
// text (the app never sends the client a raw [STICKY...] prefix to begin with).
export async function PATCH(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { blockId, text } = await req.json();
  if (!blockId || !text?.trim()) {
    return NextResponse.json({ error: 'Missing blockId or text' }, { status: 400 });
  }

  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: text.trim() } }],
      },
    }),
  });

  const data = await res.json();
  if (data.object === 'error') {
    return NextResponse.json({ error: data.message }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
