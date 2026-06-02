import { NextRequest, NextResponse } from 'next/server';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
// 🐯 TIGER OS Backlog — manual to-do list powering the Update widget.
// Tasks are pages in this DB; subtasks are child `to_do` blocks on each page
// (same shape as Projects, so /api/todos + /api/add-project-action are reused
// client-side for subtask toggle/add, and /api/archive-project for delete).
const BACKLOG_DB_ID = '657d36eb15e84269b85765e20096c6be';

const H = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

interface Subtask { id: string; text: string; checked: boolean; }
interface BacklogTask { id: string; name: string; done: boolean; order: number | null; subtasks: Subtask[]; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plain = (rt: any[]): string => (rt || []).map((t) => t.plain_text).join('').trim();

async function fetchSubtasks(pageId: string): Promise<Subtask[]> {
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { headers: H, cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.type === 'to_do')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => ({ id: b.id, text: plain(b.to_do.rich_text), checked: !!b.to_do.checked }));
}

export async function GET() {
  const res = await fetch(`https://api.notion.com/v1/databases/${BACKLOG_DB_ID}/query`, {
    method: 'POST', headers: H, cache: 'no-store',
    body: JSON.stringify({ page_size: 100 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('tigeros-tasks GET error:', err);
    return NextResponse.json({ tasks: [], error: err.message || 'Fetch failed' }, { status: 200 });
  }
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pages: any[] = data.results || [];

  const tasks: BacklogTask[] = await Promise.all(pages.map(async (p) => ({
    id: p.id,
    name: plain(p.properties?.Task?.title || []),
    done: !!p.properties?.Done?.checkbox,
    order: p.properties?.Order?.number ?? null,
    subtasks: await fetchSubtasks(p.id),
    _created: p.created_time as string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)));

  // Open tasks first; within each group by manual Order (nulls last) then creation.
  tasks.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ao = a.order ?? Infinity, bo = b.order ?? Infinity;
    if (ao !== bo) return ao - bo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((a as any)._created || '').localeCompare((b as any)._created || '');
  });

  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const { name, order } = await req.json();
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name required.' }, { status: 400 });
  }
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST', headers: H,
    body: JSON.stringify({
      parent: { database_id: BACKLOG_DB_ID },
      properties: {
        Task: { title: [{ type: 'text', text: { content: name.trim() } }] },
        Done: { checkbox: false },
        ...(typeof order === 'number' ? { Order: { number: order } } : {}),
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('tigeros-tasks POST error:', err);
    return NextResponse.json({ error: err.message || 'Create failed.' }, { status: 400 });
  }
  const page = await res.json();
  return NextResponse.json({ success: true, id: page.id });
}

export async function PATCH(req: NextRequest) {
  const { taskId, done } = await req.json();
  if (!taskId) return NextResponse.json({ error: 'taskId required.' }, { status: 400 });
  const res = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ properties: { Done: { checkbox: !!done } } }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('tigeros-tasks PATCH error:', err);
    return NextResponse.json({ error: err.message || 'Update failed.' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
