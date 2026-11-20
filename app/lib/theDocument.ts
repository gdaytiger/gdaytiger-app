import { notionFetch } from './notion';
import { melbNowDate } from './melbTime';

// THE DOCUMENT — shared Notion access, used by /api/the-document and the monthly
// "settle up" To Do task (app/lib/documentTask.ts).
export const DB_ID = '997ef2daa9974f34a12e1256065f3e7c';

export type Venue = 'GDT' | 'ISOLA';
export type Section = 'Document' | 'Clean';

export type DocRow = {
  id: string;
  section: Section;
  kind: 'Entry' | 'Settlement';
  item: string;
  from: Venue;
  category: string;
  qty: number;
  unitPrice: number;
  unit: string;
  date: string;
  status: 'Open' | 'Squared';
  loggedBy: Venue | '';
  note: string;
  created: string;
};

export const todayMelb = () => melbNowDate().toISOString().slice(0, 10);
export const round2 = (n: number) => Math.round(n * 100) / 100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txt = (p: any) => (p?.title || p?.rich_text || []).map((r: any) => r.plain_text).join('');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sel = (p: any) => p?.select?.name || '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toRow(page: any): DocRow {
  const p = page.properties || {};
  return {
    id: page.id,
    section: (sel(p['Section']) || 'Document') as Section,
    kind: (sel(p['Kind']) || 'Entry') as DocRow['kind'],
    item: txt(p['Item']),
    from: (sel(p['From']) || 'GDT') as Venue,
    category: sel(p['Category']),
    qty: p['Qty']?.number ?? 0,
    unitPrice: p['Unit Price']?.number ?? 0,
    unit: txt(p['Unit']),
    date: p['Date']?.date?.start || page.created_time?.slice(0, 10) || '',
    status: (sel(p['Status']) || 'Open') as DocRow['status'],
    loggedBy: sel(p['Logged By']) as Venue | '',
    note: txt(p['Note']),
    created: page.created_time || '',
  };
}

const rt = (s: string) => [{ type: 'text', text: { content: s.slice(0, 2000) } }];

// Build Notion properties from a partial row (only keys present are written).
export function toProps(f: Partial<DocRow>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: Record<string, any> = {};
  if (f.item !== undefined) props['Item'] = { title: rt(f.item.trim().toUpperCase()) };
  if (f.section) props['Section'] = { select: { name: f.section } };
  if (f.kind) props['Kind'] = { select: { name: f.kind } };
  if (f.from) props['From'] = { select: { name: f.from } };
  if (f.category !== undefined) props['Category'] = f.category ? { select: { name: f.category } } : { select: null };
  if (f.qty !== undefined) props['Qty'] = { number: Number(f.qty) || 0 };
  if (f.unitPrice !== undefined) props['Unit Price'] = { number: round2(Number(f.unitPrice) || 0) };
  if (f.unit !== undefined) props['Unit'] = { rich_text: rt(f.unit) };
  if (f.date) props['Date'] = { date: { start: f.date } };
  if (f.status) props['Status'] = { select: { name: f.status } };
  if (f.loggedBy) props['Logged By'] = { select: { name: f.loggedBy } };
  if (f.note !== undefined) props['Note'] = { rich_text: rt(f.note) };
  return props;
}

export async function loadRows(): Promise<DocRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pages: any[] = [];
  let cursor: string | undefined;
  do {
    const data = await notionFetch(`/databases/${DB_ID}/query`, 'POST', {
      page_size: 100,
      sorts: [{ property: 'Date', direction: 'descending' }, { timestamp: 'created_time', direction: 'descending' }],
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (!data.results) throw new Error(data.message || 'Notion query failed');
    pages = pages.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages.map(toRow);
}

// Net balance, + = Isola owes G'Day Tiger, − = G'Day Tiger owes Isola.
export function balanceOf(rows: DocRow[]): number {
  return round2(rows
    .filter(r => r.section === 'Document')
    .reduce((s, r) => s + (r.from === 'GDT' ? 1 : -1) * r.qty * r.unitPrice, 0));
}


// Record a settle-up: the venue that owed pays the whole current balance. Returns the
// new Settlement row's id and amount, or null when already square.
export async function createSettlement(loggedBy: Venue, note = ''): Promise<{ id: string; amount: number } | null> {
  const bal = balanceOf(await loadRows());
  if (Math.abs(bal) < 0.005) return null;
  const page = await notionFetch('/pages', 'POST', {
    parent: { database_id: DB_ID },
    properties: toProps({
      section: 'Document', kind: 'Settlement', item: 'SETTLED UP',
      from: bal > 0 ? 'ISOLA' : 'GDT', // the venue that owed pays it back
      qty: 1, unitPrice: Math.abs(bal), unit: '', date: todayMelb(), loggedBy, note,
    }),
  });
  if (!page.id) throw new Error(page.message || 'Notion create failed');
  return { id: page.id, amount: Math.abs(bal) };
}

// Clean Transactions still owed: one per item per borrowing venue with a positive open count
// (lines are +/− deltas, so sum them). Same number as the widget's "N ITEMS TO REORDER".
export function cleanOpenCount(rows: DocRow[]): number {
  const sums = new Map<string, number>();
  for (const r of rows) {
    if (r.section !== 'Clean' || r.status === 'Squared') continue;
    const k = `${r.item}|${r.from}`;
    sums.set(k, (sums.get(k) ?? 0) + r.qty);
  }
  return [...sums.values()].filter(v => v > 0.001).length;
}

// Dashboard: open Clean rows only (filtered in Notion, so it stays quick as history grows).
export async function loadCleanOpenCount(): Promise<number> {
  const data = await notionFetch(`/databases/${DB_ID}/query`, 'POST', {
    page_size: 100,
    filter: { and: [
      { property: 'Section', select: { equals: 'Clean' } },
      { property: 'Status', select: { does_not_equal: 'Squared' } },
    ] },
  });
  if (!data.results) return 0;
  return cleanOpenCount(data.results.map(toRow));
}
