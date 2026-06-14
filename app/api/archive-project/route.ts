import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

const NOTION_API_KEY = process.env.NOTION_API_KEY;

// Moves a project page to Notion's trash (recoverable for 30 days). This is a
// real archive — the row leaves the Projects DB entirely, not just the widget.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { projectId } = await req.json();
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required.' }, { status: 400 });
  }
  const res = await fetch(`https://api.notion.com/v1/pages/${projectId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ archived: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('archive-project error:', err);
    return NextResponse.json({ error: err.message || 'Archive failed.' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
