import { NextRequest, NextResponse } from 'next/server';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// OS page that hosts the context (javascript) code block — same parent used by /api/task-context
const STATE_PARENT_ID = '3403c99c0e858113a941c2118b3cdef9';

const VALID_CATEGORIES = ['ORDER', 'ADMIN', 'STAFF', 'MAINTENANCE', 'MERCHANDISE', 'PERSONAL', 'COSTING'];

const VALID_RECURRENCE = ['once', 'daily', 'weekly', 'fortnightly', 'monthly'] as const;
type Recurrence = (typeof VALID_RECURRENCE)[number];

// ISO week number — used to pick the fortnightly slot ([F] = odd weeks, [F2] = even)
// so a fortnightly task lands on the same fortnight cadence as the day it was added.
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Write { [blockId]: text } into the JS context code block on the OS page.
// Mirrors /api/task-context POST so add-task can set context in one shot.
async function setContext(blockId: string, text: string): Promise<void> {
  const listRes = await fetch(
    `https://api.notion.com/v1/blocks/${STATE_PARENT_ID}/children?page_size=100`,
    {
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
      cache: 'no-store',
    }
  );
  const listData = await listRes.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let codeBlock = (listData.results || []).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (b: any) => b.type === 'code' && b.code?.language === 'javascript'
  );

  if (!codeBlock) {
    // Create the block if it doesn't exist yet
    const createRes = await fetch(
      `https://api.notion.com/v1/blocks/${STATE_PARENT_ID}/children`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
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
    codeBlock = createData.results?.[0];
    if (!codeBlock) return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingText = (codeBlock.code?.rich_text || []).map((r: any) => r.plain_text).join('');
  let context: Record<string, string> = {};
  try { context = JSON.parse(existingText || '{}'); } catch { context = {}; }
  context[blockId] = text.trim();

  await fetch(`https://api.notion.com/v1/blocks/${codeBlock.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: {
        rich_text: [{ type: 'text', text: { content: JSON.stringify(context) } }],
        language: 'javascript',
      },
    }),
  });
}

async function classifyCategory(text: string): Promise<string> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: `You are classifying a task for a busy café. Reply with exactly one category name and nothing else.

Categories:
ORDER — supplier orders, purchasing ingredients/stock, calling suppliers, anything to buy or reorder
ADMIN — banking, timesheets, invoices, paying bills, compliance, back-office paperwork
STAFF — rostering, HR, team tasks, staff-related actions
MAINTENANCE — equipment repairs, cleaning, facility upkeep, anything broken or needing fixing
MERCHANDISE — merch ordering, retail product stock
COSTING — price reviews, margin checks, recipe costing, pricing decisions
PERSONAL — personal tasks mixed into the work day

Task: "${text}"

Category:`,
        }],
      }),
    });
    const data = await res.json();
    const cat = data.content?.[0]?.text?.trim().toUpperCase();
    if (cat && VALID_CATEGORIES.includes(cat)) return cat;
  } catch { /* fall through */ }
  return 'ORDER';
}

// Day of week → Notion page ID (0 = Sunday)
const DAY_PAGES: Record<number, string> = {
  0: '3403c99c0e8581fa80d7ef629e63aa9c',
  1: '3403c99c0e858139bd34e9f3873dc7ef',
  2: '3403c99c0e858133bb31f63559b18716',
  3: '3403c99c0e85814fab17e09b32693999',
  4: '3403c99c0e8581a39fd1e3587887a1e0',
  5: '3403c99c0e858192bfa7d94c8189fe3c',
  6: '3403c99c0e8581b3a01dc82031df8f09',
};

async function getPageChildren(pageId: string): Promise<any[]> {
  const blocks: any[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
    });
    const data = await res.json();
    blocks.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

// Insert a single bulleted task block onto a page. If a category is supplied and a
// matching heading exists, insert after the last task in that section; otherwise
// append to the end of the page. Returns the new block id, or null on failure.
async function insertTaskBlock(pageId: string, content: string, category: string): Promise<{ blockId: string | null; error?: string }> {
  const newBlock = {
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [{ type: 'text', text: { content } }],
    },
  };

  if (category) {
    const children = await getPageChildren(pageId);

    const headingIndex = children.findIndex(block => {
      const isHeading = block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3';
      if (!isHeading) return false;
      const richText = block[block.type]?.rich_text ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const headingText = richText.map((t: any) => t.plain_text).join('').trim();
      return headingText.toUpperCase() === category.toUpperCase();
    });

    if (headingIndex !== -1) {
      let insertAfterId = children[headingIndex].id;
      for (let i = headingIndex + 1; i < children.length; i++) {
        const block = children[i];
        const isHeading = block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3';
        if (isHeading) break;
        insertAfterId = block.id;
      }

      const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ after: insertAfterId, children: [newBlock] }),
      });
      const data = await res.json();
      if (data.object === 'error') return { blockId: null, error: data.message };
      return { blockId: data.results?.[0]?.id ?? null };
    }
    // Heading not found on this page — fall through to append at end
  }

  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ children: [newBlock] }),
  });
  const data = await res.json();
  if (data.object === 'error') return { blockId: null, error: data.message };
  return { blockId: data.results?.[0]?.id ?? null };
}

// Build the stored text for a task given its recurrence mode.
//   once        → [YYYY-MM-DD] text   (date-stamped, auto-deletes after the day passes)
//   weekly      → text                (no prefix — shows every occurrence of its weekday)
//   fortnightly → [F]/[F2] text       (odd/even ISO week, matching the picked date's week)
//   daily       → [D] text            (written to all 7 day pages; always shows)
//   monthly     → [MD:n] text         (written to all 7 day pages; shows only when date-of-month = n)
function buildContent(recurrence: Recurrence, date: string, d: Date, text: string): string {
  const t = text.trim();
  switch (recurrence) {
    case 'weekly':
      return t;
    case 'fortnightly':
      return `${getISOWeek(d) % 2 === 1 ? '[F]' : '[F2]'} ${t}`;
    case 'daily':
      return `[D] ${t}`;
    case 'monthly':
      return `[MD:${d.getDate()}] ${t}`;
    case 'once':
    default:
      return `[${date}] ${t}`;
  }
}

export async function POST(req: NextRequest) {
  const { date, text, category: rawCategory, context, recurrence: rawRecurrence } = await req.json();

  if (!date || !text?.trim()) {
    return NextResponse.json({ error: 'Missing date or text' }, { status: 400 });
  }

  const recurrence: Recurrence = VALID_RECURRENCE.includes(rawRecurrence) ? rawRecurrence : 'once';

  // Auto-classify if no category provided — uses Claude Haiku to pick the right section.
  const category: string = rawCategory || await classifyCategory(text.trim());

  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(year, month - 1, day);

  const content = buildContent(recurrence, date, d, text);

  // Daily and monthly-by-date can land on any weekday, so they're written to all 7 day
  // pages. Every other mode lives on the single page for the picked weekday.
  const targetPages: string[] = (recurrence === 'daily' || recurrence === 'monthly')
    ? Object.values(DAY_PAGES)
    : [DAY_PAGES[d.getDay()]];

  if (targetPages.some(p => !p)) {
    return NextResponse.json({ error: 'No page for that day' }, { status: 400 });
  }

  const results = await Promise.all(targetPages.map(pageId => insertTaskBlock(pageId, content, category)));

  const firstError = results.find(r => r.error);
  if (firstError) {
    return NextResponse.json({ error: firstError.error }, { status: 400 });
  }

  const blockIds = results.map(r => r.blockId).filter((id): id is string => Boolean(id));

  // Attach the optional context note to every created block so it shows regardless
  // of which day-page instance the user is looking at.
  if (typeof context === 'string' && context.trim()) {
    await Promise.all(blockIds.map(id => setContext(id, context)));
  }

  return NextResponse.json({ success: true, blockId: blockIds[0] ?? null, blockIds });
}
