import { NextRequest, NextResponse } from 'next/server';
import { notionFetch } from '@/app/lib/notion';
import { requireDocumentAccess, type Role } from '@/app/lib/auth';
import { after } from 'next/server';
import { DB_ID, type DocRow, type Venue, type Section, todayMelb, toRow, toProps, loadRows, balanceOf, createSettlement } from '@/app/lib/theDocument';
import { syncDocumentTask, onWidgetSettle } from '@/app/lib/documentTask';

// THE DOCUMENT — running stock tally between G'Day Tiger (GDT) and Isola Di Capri (ISOLA).
// One Notion DB holds everything, split by Section:
//   Document — priced lines (gelato / bread / milk / other). From = venue that supplied.
//              Kind=Settlement rows are payments that pull the balance back to zero.
//   Clean    — item-for-item IOUs, no dollars. From = venue that lent it. Open → Squared.
// Items in Supplier Prices are always priced from it (POST looks them up, PATCH can't change them).
// Only items that aren't in Supplier Prices can be given a price, and it stays editable per line.
// Both logins (owner + Isola) can log and edit here — see proxy.ts / auth.ts.
// Same page the Supplier Prices widget reads its ingredient_prices JSON block from.
const OS_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';

type CatItem = { name: string; price: number; unit: string };

// Standing Log Stock lines whose names differ from their Supplier Prices names.
const FIXED_LINES: Record<string, RegExp> = {
  GELATO: /gelato/i,
  'SOURDOUGH LOAF': /sourdough/i,
  'MILK (2L)': /sungold jersey|full cream/i,
};

const venueFor = (role: Role): Venue => (role === 'owner' ? 'GDT' : 'ISOLA');
// Keep this month's "SETTLE THE DOCUMENT" To Do task showing the live amount
// (runs after the response is sent, so autosave stays fast).
const resyncTask = () => after(() => syncDocumentTask().catch(e => console.error('document task sync failed', e)));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const txt = (p: any) => (p?.title || p?.rich_text || []).map((r: any) => r.plain_text).join('');

// Supplier Prices catalogue for the item search — name, price and unit ONLY
// (no supplier names, drift or history leave this route for the Isola login).
async function loadCatalogue(): Promise<CatItem[]> {
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

// The Supplier Prices entry that prices a line, or null if it has no usable price.
function findPrice(item: string, catalogue: CatItem[]): CatItem | null {
  const name = item.trim().toUpperCase();
  const priced = catalogue.filter(c => c.price > 0);
  const fixed = FIXED_LINES[name];
  return priced.find(c => (fixed ? fixed.test(c.name) : c.name.trim().toUpperCase() === name)) ?? null;
}

// A line's entries since the last settle-up (rows arrive newest first).
function periodEntries(rows: DocRow[], name: string): DocRow[] {
  const doc = rows.filter(r => r.section === 'Document');
  const lastSettle = doc.findIndex(r => r.kind === 'Settlement');
  const period = lastSettle === -1 ? doc : doc.slice(0, lastSettle);
  return period.filter(r => r.kind === 'Entry' && r.item === name);
}

export async function GET(req: NextRequest) {
  const role = requireDocumentAccess(req);
  if (role instanceof NextResponse) return role;
  try {
    const [rows, catalogue] = await Promise.all([loadRows(), loadCatalogue()]);
    return NextResponse.json({
      role,
      venue: venueFor(role),
      document: rows.filter(r => r.section === 'Document'),
      clean: rows.filter(r => r.section === 'Clean'),
      balance: balanceOf(rows),
      fixedPrices: Object.fromEntries(Object.keys(FIXED_LINES).map(item => [item, findPrice(item, catalogue)])),
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
      const settled = await createSettlement(venue, body.note || '');
      if (!settled) return NextResponse.json({ ok: true, settled: 0 });
      // Settling here ticks off this month's "SETTLE THE DOCUMENT" To Do task.
      after(() => onWidgetSettle(settled.id).catch(e => console.error('document task tick failed', e)));
      return NextResponse.json({ ok: true, settled: settled.amount });
    }

    // Remove an added line: archives its entries since the last settle-up (both venues).
    // Gelato, sourdough and milk always stay.
    if (body.action === 'deleteLine') {
      const name = String(body.item || '').trim().toUpperCase();
      if (!name) return NextResponse.json({ error: 'Item required' }, { status: 400 });
      if (FIXED_LINES[name]) return NextResponse.json({ error: `${name} can't be removed` }, { status: 400 });
      for (const r of periodEntries(await loadRows(), name)) {
        const res = await notionFetch(`/pages/${r.id}`, 'PATCH', { archived: true });
        if (!res.id) throw new Error(res.message || 'Notion delete failed');
      }
      resyncTask();
      return NextResponse.json({ ok: true });
    }

    // Reprice a line that isn't in Supplier Prices: updates all its entries since the last settle-up.
    if (body.action === 'setLinePrice') {
      const name = String(body.item || '').trim().toUpperCase();
      const price = Number(body.price);
      if (!name) return NextResponse.json({ error: 'Item required' }, { status: 400 });
      if (!(Number.isFinite(price) && price > 0)) return NextResponse.json({ error: `Enter a price for ${name}` }, { status: 400 });
      const catalogue = await loadCatalogue();
      if (!catalogue.length) return NextResponse.json({ error: 'Supplier Prices unavailable, try again' }, { status: 502 });
      if (FIXED_LINES[name] || findPrice(name, catalogue)) return NextResponse.json({ error: `${name} is priced from Supplier Prices` }, { status: 400 });
      for (const r of periodEntries(await loadRows(), name)) {
        const res = await notionFetch(`/pages/${r.id}`, 'PATCH', { properties: toProps({ unitPrice: price }) });
        if (!res.id) throw new Error(res.message || 'Notion update failed');
      }
      resyncTask();
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

    // Items in Supplier Prices take its price and ignore any the client sends. Only items
    // that aren't in it can carry a typed price; the standing lines never can.
    let unitPrice = 0;
    if (section === 'Document') {
      const name = String(body.item).trim().toUpperCase();
      const catalogue = await loadCatalogue();
      if (!catalogue.length) return NextResponse.json({ error: 'Supplier Prices unavailable, try again' }, { status: 502 });
      const match = findPrice(name, catalogue);
      if (match) {
        unitPrice = match.price;
      } else {
        if (FIXED_LINES[name]) return NextResponse.json({ error: `No price in Supplier Prices for ${name}` }, { status: 400 });
        // A line already in this period keeps its current price, so a stale phone can't mix prices.
        const existing = periodEntries(await loadRows(), name).find(r => r.unitPrice > 0);
        unitPrice = existing ? existing.unitPrice : Number(body.unitPrice);
        if (!(Number.isFinite(unitPrice) && unitPrice > 0)) return NextResponse.json({ error: `Enter a price for ${name}` }, { status: 400 });
      }
    }

    const page = await notionFetch('/pages', 'POST', {
      parent: { database_id: DB_ID },
      properties: toProps({
        section, kind: 'Entry', item: String(body.item), from,
        category: section === 'Document' ? (body.category || 'Other') : (body.category || ''),
        qty,
        unitPrice,
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
      if (openRows.reduce((a, r) => a + r.qty, 0) <= 0.001) { // decimals allowed — tolerate float dust
        await Promise.all(openRows.map(r => notionFetch(`/pages/${r.id}`, 'PATCH', { properties: toProps({ status: 'Squared' }) })));
      }
    }
    if (section === 'Document') resyncTask();
    return NextResponse.json({ ok: true, row: toRow(page) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

// Edit a row. Priced lines: qty and note only. Settlements: note only. Price is never editable.
export async function PATCH(req: NextRequest) {
  const role = requireDocumentAccess(req);
  if (role instanceof NextResponse) return role;
  const { id, ...fields } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const current = await notionFetch(`/pages/${id}`);
  if (!current.id) return NextResponse.json({ error: current.message || 'Row not found' }, { status: 502 });
  const row = toRow(current);
  const allowed: (keyof DocRow)[] = row.section === 'Clean'
    ? ['item', 'from', 'category', 'qty', 'unit', 'date', 'status', 'note']
    : row.kind === 'Settlement' ? ['note'] : ['qty', 'note'];
  const patch: Partial<DocRow> = {};
  for (const k of allowed) if (k in fields) (patch as Record<string, unknown>)[k] = fields[k];
  const page = await notionFetch(`/pages/${id}`, 'PATCH', { properties: toProps(patch) });
  if (!page.id) return NextResponse.json({ error: page.message || 'Notion update failed' }, { status: 502 });
  resyncTask();
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
  resyncTask();
  return NextResponse.json({ ok: true });
}
