import { notionFetch } from './notion';
import { readOsBlock, writeOsBlock } from './osBlocks';
import { DAY_PAGES } from './dayTasks';
import { loadRows, balanceOf, createSettlement } from './theDocument';
import { setChecked } from './checkedState';

// THE DOCUMENT — monthly "settle up" task in the Daily To Do (Nov 2026).
//
// On the 1st (first dashboard load in days 1–7 of a month) a persistent ADMIN task is
// written: "[STICKY:YYYY-MM-01] SETTLE THE DOCUMENT — ISOLA DI CAPRI GETS $80.00".
// It's a normal [STICKY] task, so it shows every day until ticked off.
//   • Its text tracks the live balance (re-synced after every THE DOCUMENT write).
//   • Ticking it settles up (writes the Settlement row); unticking undoes that settlement.
//   • Settling up in the widget ticks it off; deleting that settlement from the log unticks it.
// Link state lives in the `document_task` OS block.

type TaskState = {
  month: string;              // YYYY-MM the task belongs to
  date: string;               // YYYY-MM-01 (the [STICKY:date] start)
  blockId: string | null;     // Notion block of the task (null = month started all square)
  settlementId: string | null; // Settlement row that closed it ('square' = ticked with nothing owed)
};
const KEY = 'document_task';
const TITLE = 'SETTLE THE DOCUMENT';
const STICKY_DONE = '_sticky_done';

const money = (n: number) => `$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// + = Isola owes G'Day Tiger → G'Day gets paid; − = G'Day owes Isola → Isola gets paid.
const amountText = (bal: number) => (Math.abs(bal) < 0.005 ? 'ALL SQUARE' : `${bal > 0 ? "G'DAY TIGER" : 'ISOLA DI CAPRI'} GETS ${money(bal)}`);
const taskContent = (date: string, bal: number) => `[STICKY:${date}] ${TITLE} — ${amountText(bal)}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const blockText = (b: any): string => (b?.[b?.type]?.rich_text || []).map((r: any) => r.plain_text).join('');
const rt = (s: string) => [{ type: 'text', text: { content: s } }];

async function readState(): Promise<TaskState | null> {
  const s = await readOsBlock<TaskState & { type: string }>(KEY);
  return s?.month ? { month: s.month, date: s.date, blockId: s.blockId ?? null, settlementId: s.settlementId ?? null } : null;
}
const writeState = (s: TaskState) => writeOsBlock(KEY, s);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pageChildren(pageId: string): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let all: any[] = [];
  let cursor: string | undefined;
  do {
    const d = await notionFetch(`/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    all = all.concat(d.results || []);
    cursor = d.has_more ? d.next_cursor : undefined;
  } while (cursor);
  return all;
}

// Write the task under the day page's ADMIN heading (end of that section), else append.
// Reuses an existing block for the same month if one is already there (no duplicates).
async function upsertTaskBlock(date: string, content: string): Promise<string | null> {
  const pageId = DAY_PAGES[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const kids = await pageChildren(pageId);
  const existing = kids.find(b => blockText(b).startsWith(`[STICKY:${date}] ${TITLE}`));
  if (existing) {
    await notionFetch(`/blocks/${existing.id}`, 'PATCH', { [existing.type]: { rich_text: rt(content) } });
    return existing.id;
  }
  const block = { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(content) } };
  const isHeading = (b: { type: string }) => /^heading_[123]$/.test(b.type);
  const h = kids.findIndex(b => isHeading(b) && blockText(b).trim().toUpperCase() === 'ADMIN');
  let after: string | undefined;
  if (h !== -1) {
    after = kids[h].id;
    for (let i = h + 1; i < kids.length && !isHeading(kids[i]); i++) after = kids[i].id;
  }
  const res = await notionFetch(`/blocks/${pageId}/children`, 'PATCH', after ? { after, children: [block] } : { children: [block] });
  return res.results?.[0]?.id ?? null;
}

async function setTaskText(blockId: string, content: string) {
  const b = await notionFetch(`/blocks/${blockId}`);
  if (!b?.id || b.archived || b.in_trash) return;
  if (blockText(b) !== content) await notionFetch(`/blocks/${blockId}`, 'PATCH', { [b.type]: { rich_text: rt(content) } });
}

// Dashboard (owner) — make sure this month's task exists. Cheap no-op after day 7
// or once this month's task is recorded.
export async function ensureMonthlyDocumentTask(todayYmd: string): Promise<void> {
  if (Number(todayYmd.slice(8, 10)) > 7) return;
  const month = todayYmd.slice(0, 7);
  const prev = await readState();
  if (prev?.month === month) return;
  const date = `${month}-01`;
  const bal = balanceOf(await loadRows());

  // Last month's task still open → retire it; this month's task carries the full balance.
  if (prev?.blockId && !prev.settlementId) await notionFetch(`/blocks/${prev.blockId}`, 'DELETE').catch(() => {});

  if (Math.abs(bal) < 0.005) {
    await writeState({ month, date, blockId: null, settlementId: null });
    return;
  }
  // Claim the month before writing the block so a second dashboard load doesn't race us.
  await writeState({ month, date, blockId: null, settlementId: null });
  const blockId = await upsertTaskBlock(date, taskContent(date, bal));
  await writeState({ month, date, blockId, settlementId: null });
}

// After any THE DOCUMENT write: keep the open task's amount live, and if its linked
// settlement was deleted from the log, untick it again.
export async function syncDocumentTask(): Promise<void> {
  const st = await readState();
  if (!st?.blockId) return;
  const rows = await loadRows();
  if (st.settlementId && st.settlementId !== 'square' && !rows.some(r => r.id === st.settlementId)) {
    await setChecked(STICKY_DONE, [st.blockId], false);
    st.settlementId = null;
    await writeState(st);
  }
  if (!st.settlementId) await setTaskText(st.blockId, taskContent(st.date, balanceOf(rows)));
}

// Settle up pressed in the widget → tick this month's task off.
export async function onWidgetSettle(settlementId: string): Promise<void> {
  const st = await readState();
  if (!st?.blockId || st.settlementId) return;
  await setChecked(STICKY_DONE, [st.blockId], true);
  await writeState({ ...st, settlementId });
}

// Task ticked / unticked in the To Do → settle up / undo that settlement.
export async function onTaskToggled(ids: string[], checked: boolean): Promise<void> {
  const st = await readState();
  if (!st?.blockId || !ids.includes(st.blockId)) return;
  if (checked && !st.settlementId) {
    const s = await createSettlement('GDT', 'Ticked off in To Do');
    await writeState({ ...st, settlementId: s?.id ?? 'square' });
  } else if (!checked && st.settlementId) {
    if (st.settlementId !== 'square') await notionFetch(`/pages/${st.settlementId}`, 'PATCH', { archived: true }).catch(() => {});
    await writeState({ ...st, settlementId: null });
    await setTaskText(st.blockId, taskContent(st.date, balanceOf(await loadRows())));
  }
}
