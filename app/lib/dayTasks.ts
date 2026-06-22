// Shared task-parsing logic used by /api/dashboard and /api/week-tasks.
// Both routes read the same day-of-week Notion pages and apply the same
// recurrence rules ([F], [F2], [D], [M], [MD:n], [CARRY], [YYYY-MM-DD]).
// Keep the rule semantics in one place so the next change only happens once.

const NOTION_API_KEY = process.env.NOTION_API_KEY;

export const DAY_PAGES: Record<number, string> = {
  0: '3403c99c0e8581fa80d7ef629e63aa9c',
  1: '3403c99c0e858139bd34e9f3873dc7ef',
  2: '3403c99c0e858133bb31f63559b18716',
  3: '3403c99c0e85814fab17e09b32693999',
  4: '3403c99c0e8581a39fd1e3587887a1e0',
  5: '3403c99c0e858192bfa7d94c8189fe3c',
  6: '3403c99c0e8581b3a01dc82031df8f09',
};

export const DATE_PREFIX_RE = /^\[(\d{4}-\d{2}-\d{2})\]\s*/;

// ISO week number (1–53). Used to alternate [F] / [F2] fortnightlies.
export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Format a Date as YYYY-MM-DD using UTC components (server is UTC on Vercel).
export function formatYMD(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Fire-and-forget delete of a stale Notion block (a dated task whose date has passed).
export function deleteBlock(blockId: string) {
  fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
  }).catch(() => {});
}

export type ParsedTask = {
  id: string;
  text: string;
  checked: boolean;
  isHeader?: boolean;
  isRecurring?: boolean;
  // Persistent task — injected by /api/dashboard's sticky-candidate scan, not
  // by this parser. Stays on the Daily To Do every day until ticked off, with
  // no expiry (unlike [CARRY]). See STICKY_PREFIX.
  isSticky?: boolean;
};

// [STICKY] or [STICKY:YYYY-MM-DD] text — persistent one-off task. Skipped here
// (handled by /api/dashboard's cross-page scan, same approach as [CARRY] but with
// no retention window: once ticked off it's recorded permanently in the checked-state
// JSON under "_sticky_done" and never resurfaces). The optional date is the day the
// task was added from — it "starts showing" from that date onward (today < date
// means not visible yet). Older [STICKY] blocks with no date show immediately, same
// as before.
export const STICKY_PREFIX = '[STICKY]';
export const STICKY_PREFIX_RE = /^\[STICKY(?::(\d{4}-\d{2}-\d{2}))?\]\s*/;

// Tasks whose text starts with "Review pricing" are margin-review follow-ups
// surfaced by the Coffee/Food Costings card (e.g. "Review pricing – Beef Sandwich
// (57.1%)"). Pin them with the same 📌 badge as [STICKY] tasks so they stand out
// in the Daily To Do until actioned — regardless of how they got onto the page
// (manual entry, [CARRY], or plain recurring).
const REVIEW_PRICING_RE = /^review pricing\b/i;
export function isReviewPricingTask(text: string): boolean {
  return REVIEW_PRICING_RE.test(text.trim());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = { id: string; type: string; [key: string]: any };

type ParseOpts = {
  // The date the list is being rendered for (today for dashboard, each of the
  // next 7 days for week-tasks). Read via getUTC* / getDate accessors.
  renderDate: Date;
  // YYYY-MM-DD for "today in Melbourne" — used to detect & delete past dated tasks.
  todayStr: string;
};

// Parse Notion blocks into the dashboard's task list. Honours recurrence prefixes
// and emits headers only when they have at least one task beneath them.
//
// Side effect: any [YYYY-MM-DD] task with a date in the past triggers a Notion
// delete (fire-and-forget). This matches the historical behaviour of both routes.
export function parseDayTaskBlocks(blocks: Block[], opts: ParseOpts): ParsedTask[] {
  const { renderDate, todayStr } = opts;
  const renderDateStr = formatYMD(renderDate);
  const weekNum = getISOWeek(renderDate);
  const isOddWeek = weekNum % 2 === 1;

  type RawItem = { type: 'header' | 'task'; id: string; text: string; isRecurring?: boolean; isSticky?: boolean };
  const rawItems: RawItem[] = [];

  const pushTask = (id: string, text: string, isRecurring: boolean) => {
    rawItems.push({ type: 'task', id, text, isRecurring, isSticky: isReviewPricingTask(text) || undefined });
  };

  for (const block of blocks) {
    if (block.type === 'heading_2' || block.type === 'heading_3') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = (block[block.type]?.rich_text || []).map((r: any) => r.plain_text).join('').trim();
      if (text) rawItems.push({ type: 'header', id: block.id, text });
      continue;
    }
    if (block.type !== 'bulleted_list_item' && block.type !== 'to_do') continue;
    const richTextSource = block.type === 'bulleted_list_item'
      ? block.bulleted_list_item?.rich_text
      : block.to_do?.rich_text;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (richTextSource || []).map((r: any) => r.plain_text).join('');
    if (!raw.trim()) continue;

    // [YYYY-MM-DD] — specific date. Auto-delete if past, show only on its date.
    const dateMatch = raw.match(DATE_PREFIX_RE);
    if (dateMatch) {
      const taskDate = dateMatch[1];
      if (taskDate < todayStr) { deleteBlock(block.id); continue; }
      if (taskDate === renderDateStr) {
        pushTask(block.id, raw.replace(DATE_PREFIX_RE, '').trim(), false);
      }
      continue;
    }
    // [F] — fortnightly on odd ISO weeks
    if (raw.startsWith('[F]')) {
      if (!isOddWeek) continue;
      pushTask(block.id, raw.replace('[F]', '').trim(), true);
      continue;
    }
    // [F2] — fortnightly on even ISO weeks (alternates with [F])
    if (raw.startsWith('[F2]')) {
      if (isOddWeek) continue;
      pushTask(block.id, raw.replace('[F2]', '').trim(), true);
      continue;
    }
    // [D] — daily, always shows. Legacy: 'Daily' was dropped from the add-task
    // picker 16 Jun 2026, but existing [D] blocks still parse and display.
    if (raw.startsWith('[D]')) {
      pushTask(block.id, raw.replace('[D]', '').trim(), true);
      continue;
    }
    // [MD:n] — monthly on calendar day n. Checked before [M] since "[MD:" also starts with "[M".
    const mdMatch = raw.match(/^\[MD:(\d{1,2})\]\s*/);
    if (mdMatch) {
      if (renderDate.getDate() !== Number(mdMatch[1])) continue;
      pushTask(block.id, raw.replace(/^\[MD:\d{1,2}\]\s*/, '').trim(), true);
      continue;
    }
    // [M] — monthly, shows in first 7 days of the month
    if (raw.startsWith('[M]')) {
      if (renderDate.getDate() > 7) continue;
      pushTask(block.id, raw.replace('[M]', '').trim(), true);
      continue;
    }
    // [CARRY] — handled separately by dashboard carry-over logic; skip here.
    if (raw.startsWith('[CARRY]')) continue;
    // [STICKY] / [STICKY:YYYY-MM-DD] — handled separately by dashboard sticky-task logic; skip here.
    if (STICKY_PREFIX_RE.test(raw)) continue;
    // Plain task with no prefix — always shows on its home day.
    pushTask(block.id, raw.trim(), true);
  }

  // Build final list — skip headers that have no tasks beneath them.
  const tasks: ParsedTask[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (item.type === 'header') {
      let hasTask = false;
      for (let j = i + 1; j < rawItems.length; j++) {
        if (rawItems[j].type === 'header') break;
        if (rawItems[j].type === 'task') { hasTask = true; break; }
      }
      if (hasTask) tasks.push({ id: `header-${item.id}`, text: item.text, checked: false, isHeader: true });
    } else {
      tasks.push({ id: item.id, text: item.text, checked: false, isRecurring: item.isRecurring, isSticky: item.isSticky });
    }
  }
  return tasks;
}

// ── Shared checked-state + [STICKY] helpers ──────────────────────────────────
// Used by /api/dashboard (today) and /api/week-tasks (next 7 days) so persistent
// tasks surface identically in both. Permanent-done key for stickies — see
// /api/dashboard for the full rationale (sorts above any date string, so it
// survives the date-keyed cleanup in /api/checked-state).
export const STICKY_DONE_KEY = '_sticky_done';

// Page holding the JSON checked-state code block.
const CHECKED_STATE_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';

async function notionGET(path: string): Promise<{ results?: Block[]; has_more?: boolean; next_cursor?: string }> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { Authorization: `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
    cache: 'no-store',
  });
  return res.json();
}

// The date-keyed checked-state map: { "YYYY-MM-DD": [blockId, ...], "_sticky_done": [...] }.
export async function getCheckedState(): Promise<Record<string, string[]>> {
  let allBlocks: Block[] = [];
  let cursor: string | undefined;
  do {
    const data = await notionGET(`/blocks/${CHECKED_STATE_PAGE_ID}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  const codeBlock = allBlocks.find(b => b.type === 'code' && b.code?.language === 'json');
  if (codeBlock) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (codeBlock.code?.rich_text || []).map((r: any) => r.plain_text).join('');
    try { return JSON.parse(text || '{}'); } catch { return {}; }
  }
  return {};
}

export type StickyCandidate = { id: string; text: string; header: string; startDate: string | null };

// Scan today + the past 6 day-pages (covers all 7 weekday pages) for [STICKY] /
// [STICKY:YYYY-MM-DD] blocks. Mirrors the dashboard's candidate scan so the week
// view counts the same persistent tasks. Done-filtering happens at the call site.
export async function fetchStickyCandidates(today: Date): Promise<StickyCandidate[]> {
  const pages = await Promise.all(
    Array.from({ length: 7 }, (_, i) => {
      const past = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      return notionGET(`/blocks/${DAY_PAGES[past.getDay()]}/children?page_size=100`);
    })
  );
  const sticky: StickyCandidate[] = [];
  const seen = new Set<string>();
  for (const data of pages) {
    let currentHeader = 'ADMIN';
    for (const block of (data.results || [])) {
      if (block.type === 'heading_2' || block.type === 'heading_3') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentHeader = (block[block.type]?.rich_text || []).map((r: any) => r.plain_text).join('').trim();
        continue;
      }
      let raw: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (block.type === 'bulleted_list_item') raw = (block.bulleted_list_item?.rich_text || []).map((r: any) => r.plain_text).join('');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else if (block.type === 'to_do') raw = (block.to_do?.rich_text || []).map((r: any) => r.plain_text).join('');
      else continue;
      if (seen.has(block.id)) continue;
      const m = raw.match(STICKY_PREFIX_RE);
      if (m) {
        seen.add(block.id);
        sticky.push({ id: block.id, text: raw.replace(STICKY_PREFIX_RE, '').trim(), header: currentHeader, startDate: m[1] || null });
      }
    }
  }
  return sticky;
}
