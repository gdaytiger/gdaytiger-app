import { NextRequest, NextResponse } from 'next/server';
import { notionFetch } from '@/app/lib/notion';
import { requireDocumentAccess, type Role } from '@/app/lib/auth';
import { melbNowDate } from '@/app/lib/melbTime';

// THE DOCUMENT — running stock tally between G'Day Tiger (GDT) and Isola Di Capri (ISOLA).
// One Notion DB holds everything, split by Section:
//   Document — priced lines (gelato / bread / milk / other). From = venue that supplied.
//              Kind=Settlement rows are payments that pull the balance back to zero.
//   Clean    — item-for-item IOUs, no dollars. From = venue that lent it. Open → Squared.
//   Setting  — single GELATO row holding the fixed per-tub price.
// Both logins (owner + Isola) have full edit here — see proxy.ts / auth.ts.
const DB_ID = '997ef2daa9974f34a12e1256065f3e7c';
// Same page the Supplier Prices widget reads its ingredient_prices JSON block from.
const OS_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';

type Venue = 'GDT' | 'ISOLA';
type Section = 'Document' | 'Clean' | 'Setting';

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

const venueFor = (role: Role): Venue => (role === 'owner' ? 'GDT' : 'ISOLA');
const todayMelb = () => melbNowDate().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txt = (p: any) => (p?.title || p?.rich_text || []).map((r: any) => r.plain_text).join('');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sel = (p: any) => p?.select?.name || '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(page: any): DocRow {
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
function toProps(f: Partial<DocRow>) {
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

async function loadRows(): Promise<DocRow[]> {
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
function balanceOf(rows: DocRow[]): number {
  return round2(rows
    .filter(r => r.section === 'Document')
    .reduce((s, r) => s + (r.from === 'GDT' ? 1 : -1) * r.qty * r.unitPrice, 0));
}

// Supplier Prices catalogue for the item search — name, price and unit ONLY
// (no supplier names, drift or history leave this route for the Isola login).
async function loadCatalogue(): Promise<{ name: string; price: number; unit: string }[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let blocks: any[] = [];
    let cursor: string | undefined;
    do {
      const data = await notionFetch(`/blocks/${OS_PAGE_ID}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
      blocks = blocks.concat(data.results || []);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const block = blocks.find((b: any) => b.type === 'code' && txt(b.code).includes('"ingredient_prices"'));
    if (!block) return [];
    const data = JSON.parse(txt(block.code));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.ingredients || []).map((i: any) => ({ name: String(i.name), price: Number(i.price) || 0, unit: String(i.unit || '') }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const role = requireDocumentAccess(req);
  if (role instanceof NextResponse) return role;
  try {
    const [rows, catalogue] = await Promise.all([loadRows(), loadCatalogue()]);
    const setting = rows.find(r => r.section === 'Setting' && r.item === 'GELATO');
    return NextResponse.json({
      role,
      venue: venueFor(role),
      document: rows.filter(r => r.section === 'Document'),
      clean: rows.filter(r => r.section === 'Clean'),
      balance: balanceOf(rows),
      gelato: setting ? { id: setting.id, price: setting.unitPrice, unit: setting.unit } : null,
      catalogue,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const role = requireDocumentAccess(req);
  if (role instanceof NextResponse) return role;
  const venue = venueFor(role);
  const body = await req.json();

  try {
    // Settle up — server recomputes the live balance so two phones can't double-settle stale numbers.
    if (body.action === 'settle') {
      const bal = balanceOf(await loadRows());
      if (Math.abs(bal) < 0.005) return NextResponse.json({ ok: true, settled: 0 });
      const page = await notionFetch('/pages', 'POST', {
        parent: { database_id: DB_ID },
        properties: toProps({
          section: 'Document', kind: 'Settlement', item: 'SETTLED UP',
          from: bal > 0 ? 'ISOLA' : 'GDT', // the venue that owed pays it back
          qty: 1, unitPrice: Math.abs(bal), unit: '', date: todayMelb(), loggedBy: venue,
          note: body.note || '',
        }),
      });
      if (!page.id) throw new Error(page.message || 'Notion create failed');
      return NextResponse.json({ ok: true, settled: Math.abs(bal) });
    }

    // Fixed gelato price per tub — upsert the single Setting row.
    if (body.action === 'setGelato') {
      const rows = await loadRows();
      const existing = rows.find(r => r.section === 'Setting' && r.item === 'GELATO');
      const props = toProps({ section: 'Setting', item: 'GELATO', qty: 1, unitPrice: Number(body.price) || 0, unit: String(body.unit || 'tub'), loggedBy: venue });
      const res = existing
        ? await notionFetch(`/pages/${existing.id}`, 'PATCH', { properties: props })
        : await notionFetch('/pages', 'POST', { parent: { database_id: DB_ID }, properties: props });
      if (!res.id) throw new Error(res.message || 'Notion write failed');
      return NextResponse.json({ ok: true });
    }

    const section: Section = body.section === 'Clean' ? 'Clean' : 'Document';
    const from: Venue = body.from === 'ISOLA' ? 'ISOLA' : 'GDT';
    if (!String(body.item || '').trim()) return NextResponse.json({ error: 'Item required' }, { status: 400 });
    const qty = Number(body.qty);
    // Both sections' counters autosave as +/− deltas (a counter tapped down logs a negative line).
    if (!(Number.isFinite(qty) && qty !== 0)) {
      return NextResponse.json({ error: 'Qty must not be 0' }, { status: 400 });
    }

    const page = await notionFetch('/pages', 'POST', {
      parent: { database_id: DB_ID },
      properties: toProps({
        section, kind: 'Entry', item: String(body.item), from,
        category: section === 'Document' ? (body.category || 'Other') : (body.category || ''),
        qty,
        unitPrice: section === 'Document' ? Number(body.unitPrice) || 0 : 0,
        unit: String(body.unit || ''),
        date: body.date || todayMelb(),
        status: section === 'Clean' ? 'Open' : undefined,
        loggedBy: venue,
        note: String(body.note || ''),
      }),
    });
    if (!page.id) throw new Error(page.message || 'Notion create failed');

    // Clean Transactions: once an item's open count for that lender is back to 0,
    // mark all its open lines Squared so it drops off the counters.
    if (section === 'Clean' && qty < 0) {
      const name = String(body.item).trim().toUpperCase();
      const openRows = (await loadRows()).filter(r => r.section === 'Clean' && r.status !== 'Squared' && r.item === name && r.from === from);
      if (openRows.reduce((a, r) => a + r.qty, 0) <= 0) {
        await Promise.all(openRows.map(r => notionFetch(`/pages/${r.id}`, 'PATCH', { properties: toProps({ status: 'Squared' }) })));
      }
    }
    return NextResponse.json({ ok: true, row: toRow(page) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

// Edit any field on a row (both logins have full edit).
export async function PATCH(req: NextRequest) {
  const role = requireDocumentAccess(req);
  if (role instanceof NextResponse) return role;
  const { id, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const allowed: (keyof DocRow)[] = ['item', 'from', 'category', 'qty', 'unitPrice', 'unit', 'date', 'status', 'note'];
  const patch: Partial<DocRow> = {};
  for (const k of allowed) if (k in fields) (patch as Record<string, unknown>)[k] = fields[k];
  const page = await notionFetch(`/pages/${id}`, 'PATCH', { properties: toProps(patch) });
  if (!page.id) return NextResponse.json({ error: page.message || 'Notion update failed' }, { status: 502 });
  return NextResponse.json({ ok: true, row: toRow(page) });
}

// Delete = archive in Notion (recoverable from Notion's trash).
export async function DELETE(req: NextRequest) {
  const role = requireDocumentAccess(req);
  if (role instanceof NextResponse) return role;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const page = await notionFetch(`/pages/${id}`, 'PATCH', { archived: true });
  if (!page.id) return NextResponse.json({ error: page.message || 'Notion delete failed' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
