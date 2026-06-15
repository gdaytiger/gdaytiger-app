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

// [STICKY] text — persistent one-off task. Skipped here (handled by /api/dashboard's
// cross-page scan, same approach as [CARRY] but with no retention window: once ticked
// off it's recorded permanently in the checked-state JSON under "_sticky_done" and
// never resurfaces).
export const STICKY_PREFIX = '[STICKY]';

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

  type RawItem = { type: 'header' | 'task'; id: string; text: string; isRecurring?: boolean };
  const rawItems: RawItem[] = [];

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
        rawItems.push({ type: 'task', id: block.id, text: raw.replace(DATE_PREFIX_RE, '').trim(), isRecurring: false });
      }
      continue;
    }
    // [F] — fortnightly on odd ISO weeks
    if (raw.startsWith('[F]')) {
      if (!isOddWeek) continue;
      rawItems.push({ type: 'task', id: block.id, text: raw.replace('[F]', '').trim(), isRecurring: true });
      continue;
    }
    // [F2] — fortnightly on even ISO weeks (alternates with [F])
    if (raw.startsWith('[F2]')) {
      if (isOddWeek) continue;
      rawItems.push({ type: 'task', id: block.id, text: raw.replace('[F2]', '').trim(), isRecurring: true });
      continue;
    }
    // [D] — daily, always shows
    if (raw.startsWith('[D]')) {
      rawItems.push({ type: 'task', id: block.id, text: raw.replace('[D]', '').trim(), isRecurring: true });
      continue;
    }
    // [MD:n] — monthly on calendar day n. Checked before [M] since "[MD:" also starts with "[M".
    const mdMatch = raw.match(/^\[MD:(\d{1,2})\]\s*/);
    if (mdMatch) {
      if (renderDate.getDate() !== Number(mdMatch[1])) continue;
      rawItems.push({ type: 'task', id: block.id, text: raw.replace(/^\[MD:\d{1,2}\]\s*/, '').trim(), isRecurring: true });
      continue;
    }
    // [M] — monthly, shows in first 7 days of the month
    if (raw.startsWith('[M]')) {
      if (renderDate.getDate() > 7) continue;
      rawItems.push({ type: 'task', id: block.id, text: raw.replace('[M]', '').trim(), isRecurring: true });
      continue;
    }
    // [CARRY] — handled separately by dashboard carry-over logic; skip here.
    if (raw.startsWith('[CARRY]')) continue;
    // [STICKY] — handled separately by dashboard sticky-task logic; skip here.
    if (raw.startsWith(STICKY_PREFIX)) continue;
    // Plain task with no prefix — always shows on its home day.
    rawItems.push({ type: 'task', id: block.id, text: raw.trim(), isRecurring: true });
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
      tasks.push({ id: item.id, text: item.text, checked: false, isRecurring: item.isRecurring });
    }
  }
  return tasks;
}
