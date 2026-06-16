import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

const NOTION_API_KEY = process.env.NOTION_API_KEY;

// Update the checked state of a shopping list to_do block directly in Notion.
// This ensures items stay checked between dashboard loads — unlike the date-keyed
// JSON checked-state used for daily tasks, the Notion to_do.checked flag persists
// indefinitely and is read directly by getShoppingTasks() in /api/dashboard.
export async function PATCH(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { blockId, checked } = await req.json();
  if (!blockId || typeof checked !== 'boolean') {
    return NextResponse.json({ error: 'Missing blockId or checked' }, { status: 400 });
  }

  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to_do: { checked } }),
  });

  const data = await res.json();
  if (data.object === 'error') {
    return NextResponse.json({ error: data.message }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
