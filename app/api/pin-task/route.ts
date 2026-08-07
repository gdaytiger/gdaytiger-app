import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { formatYMD } from '@/app/lib/dayTasks';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const PROJECTS_DB_ID = 'f7712afe4c7247d7b1690f2e1ecc1a0d';

// Convert an existing task block to a persistent [STICKY:date:projectId] task by
// rewriting its Notion block text. The date is today in Melbourne — "starts showing
// from today". The dashboard's cross-page scan (fetchCarryAndStickyCandidates) will
// surface it every day from that date onward until ticked off, same as any other
// [STICKY:date] block.
//
// Pinning also promotes the task to an "ongoing project" — a fresh page in the
// Projects DB whose child to_do checklist becomes the pinned row's expandable
// subtasks in Daily To Do. If project creation fails for any reason, the pin still
// goes ahead as a plain (non-expandable) [STICKY:date] task rather than blocking
// the pin action entirely.
//
// Accepts { blockId, text } where text is the display text (already stripped of
// any existing prefix by parseDayTaskBlocks on the client). The block is rewritten
// as a bulleted_list_item with content "[STICKY:YYYY-MM-DD:projectId] TEXT".
export async function PATCH(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { blockId, text } = await req.json();
  if (!blockId || !text?.trim()) {
    return NextResponse.json({ error: 'Missing blockId or text' }, { status: 400 });
  }

  const cleanText = text.trim();
  const headers = {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  let projectId: string | null = null;
  try {
    const projectRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parent: { database_id: PROJECTS_DB_ID },
        properties: {
          Name: { title: [{ text: { content: cleanText } }] },
          Status: { select: { name: 'In Progress' } },
        },
      }),
    });
    const project = await projectRes.json();
    if (project.object !== 'error') projectId = project.id;
  } catch {
    projectId = null;
  }

  // Melbourne time = UTC+10 (AEST). Using fixed offset matches dashboard/route.ts.
  const today = new Date(new Date().getTime() + 10 * 60 * 60 * 1000);
  const todayStr = formatYMD(today);
  const content = projectId
    ? `[STICKY:${todayStr}:${projectId}] ${cleanText}`
    : `[STICKY:${todayStr}] ${cleanText}`;

  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers,
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
  return NextResponse.json({ success: true, projectId });
}
