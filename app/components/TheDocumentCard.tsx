'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Pencil, Search, Trash2, X, IceCreamCone, Minus, Plus, Wheat, Milk, Package } from 'lucide-react';
import { glassTileStyle, glassButtonStyle, glassButtonActiveStyle, glassButtonPrimaryStyle } from '@/app/lib/theme';

// THE DOCUMENT — running stock tally between G'Day Tiger and Isola Di Capri.
// Shared by the owner dashboard (bottom sheet) and the Isola-only /document page.
// Two parts: THE DOCUMENT ($ tally of gelato / bread / milk, with Settle up) and
// CLEAN TRANSACTIONS (item-for-item IOUs: borrowed → reordered → squared).
// Self-contained — fetches /api/the-document.

type Venue = 'GDT' | 'ISOLA';
type Row = {
  id: string; section: 'Document' | 'Clean' | 'Setting'; kind: 'Entry' | 'Settlement';
  item: string; from: Venue; category: string; qty: number; unitPrice: number; unit: string;
  date: string; status: 'Open' | 'Squared'; loggedBy: Venue | ''; note: string; created: string;
};
type CatItem = { name: string; price: number; unit: string };
type Data = {
  role: 'owner' | 'partner'; venue: Venue; document: Row[]; clean: Row[]; balance: number;
  gelato: { id: string; price: number; unit: string } | null; catalogue: CatItem[];
};

const NAME: Record<Venue, string> = { GDT: "G'DAY TIGER", ISOLA: 'ISOLA DI CAPRI' };
const other = (v: Venue): Venue => (v === 'GDT' ? 'ISOLA' : 'GDT');
const money = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
};
const guessCategory = (name: string) =>
  /gelato/i.test(name) ? 'Gelato'
  : /bread|loaf|sourdough|ciabatta|roll|bun|croissant|dench|white 1600/i.test(name) ? 'Bread'
  : /milk|cream|oat|soy|almond|sungold|lowfat|skim/i.test(name) ? 'Milk'
  : 'Other';

const label: React.CSSProperties = { fontFamily: '"stolzl", sans-serif', fontWeight: 700, fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-ink-label)' };
const box: React.CSSProperties = { background: 'rgba(255,255,255,0.55)', borderRadius: '16px', padding: '12px 14px' };
const input: React.CSSProperties = { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)' };
const inputClass = 'text-sm px-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-gray-800';
const chip = (on: boolean): React.CSSProperties => (on ? { ...glassButtonStyle, ...glassButtonActiveStyle } : glassButtonStyle);
const BTN_PRIMARY: React.CSSProperties = { ...glassButtonStyle, ...glassButtonPrimaryStyle };
const TILE_H = 62;

async function api(method: string, body?: object) {
  const res = await fetch('/api/the-document', {
    method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ── Item picker: search the Supplier Prices catalogue, or type a custom item ──
function ItemSearch({ catalogue, value, onChange, onPick }: {
  catalogue: CatItem[]; value: string; onChange: (v: string) => void; onPick: (c: CatItem) => void;
}) {
  const [focused, setFocused] = useState(false);
  const q = value.trim().toLowerCase();
  const hits = useMemo(() => (q.length < 2 ? [] : catalogue.filter(c => c.name.toLowerCase().includes(q)).slice(0, 6)), [catalogue, q]);
  return (
    <div className="relative flex-1 min-w-0">
      <div className="flex items-center gap-2 rounded-xl px-3" style={input}>
        <Search size={14} strokeWidth={2.25} aria-hidden style={{ color: 'var(--color-ink-muted)', flexShrink: 0 }} />
        <input value={value} onChange={e => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="SEARCH ITEM" className="w-full bg-transparent text-sm py-2 uppercase focus:outline-none text-gray-800" />
      </div>
      {focused && hits.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.97)', border: '1px solid rgba(0,0,0,0.08)', boxShadow: 'var(--glass-shadow)' }}>
          {hits.map(h => (
            <button key={h.name} type="button" onMouseDown={e => { e.preventDefault(); onPick(h); setFocused(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-orange-50">
              <span className="flex-1 min-w-0 truncate font-semibold text-gray-800 uppercase">{h.name}</span>
              <span className="tabular-nums text-gray-500 shrink-0">{money(h.price)}{h.unit ? ` / ${h.unit}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FromToggle({ from, onChange, verb }: { from: Venue; onChange: (v: Venue) => void; verb: 'supplied' | 'lent' }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {(['GDT', 'ISOLA'] as Venue[]).map(v => (
        <button key={v} type="button" onClick={() => onChange(v)} style={chip(from === v)}>
          {NAME[v]} <ArrowRight size={12} strokeWidth={2.5} aria-hidden /> {NAME[other(v)]}
        </button>
      ))}
      <span className="sr-only">Venue that {verb} the item</span>
    </div>
  );
}

const tabFoot = (value: number, items: number) => (
  <>TAB <span className="font-semibold tabular-nums" style={{ color: 'var(--color-ink-label)' }}>{money(value)}</span>
    {items > 0 && <div>{items} item{items === 1 ? '' : 's'}</div>}</>
);

// Venue column in Log Stock: name, − n + counter (how many that venue RECEIVED), and its current tab.
function VenueCounter({ venue, count, onChange, foot }: {
  venue: Venue; count: number; onChange: (n: number) => void; foot: React.ReactNode;
}) {
  const on = count > 0;
  const step: React.CSSProperties = { ...glassButtonStyle, padding: 0, width: '31px', justifyContent: 'center', flexShrink: 0 };
  return (
    <div className="flex flex-col items-center gap-2 p-2 rounded-2xl text-center min-w-0"
      style={{ background: on ? 'rgba(251,205,173,0.12)' : 'rgba(255,255,255,0.55)', border: `1px solid ${on ? 'var(--color-brand-peach)' : 'transparent'}` }}>
      <div style={{ ...label, color: 'var(--color-ink-label)' }} className="leading-tight">{NAME[venue]}</div>
      <input type="number" inputMode="numeric" min={0} value={count || ''} placeholder="0"
        onChange={e => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="w-full text-center text-2xl font-bold tabular-nums bg-transparent focus:outline-none text-gray-800 leading-none" aria-label={`Qty to ${NAME[venue]}`} />
      <div className="flex items-center justify-center gap-1.5">
        <button type="button" style={step} onClick={() => onChange(Math.max(0, count - 1))} aria-label={`One less to ${NAME[venue]}`} disabled={!on} className="disabled:opacity-40">
          <Minus size={13} strokeWidth={2.5} aria-hidden />
        </button>
        <button type="button" style={step} onClick={() => onChange(count + 1)} aria-label={`One more to ${NAME[venue]}`}>
          <Plus size={13} strokeWidth={2.5} aria-hidden />
        </button>
      </div>
      <div className="text-xs text-gray-400 leading-tight">{foot}</div>
    </div>
  );
}

// Compact − n + used on each Log Stock line.
// `by` = how much each +/− tap moves the count (milk in crate mode = 9 bottles a tap).
function MiniCounter({ count, onChange, who, by = 1 }: { count: number; onChange: (n: number) => void; who: string; by?: number }) {
  const on = count > 0;
  const step: React.CSSProperties = { ...glassButtonStyle, padding: 0, width: '24px', height: '24px', justifyContent: 'center', flexShrink: 0 };
  return (
    <div className="flex items-center justify-center gap-0.5 rounded-xl py-1 w-[84px]"
      style={{ background: on ? 'rgba(251,205,173,0.12)' : 'transparent', border: `1px solid ${on ? 'var(--color-brand-peach)' : 'transparent'}` }}>
      <button type="button" style={step} onClick={() => onChange(Math.max(0, count - by))} aria-label={`${by === 1 ? 'One' : by} less to ${who}`} disabled={!on} className="disabled:opacity-40">
        <Minus size={12} strokeWidth={2.5} aria-hidden />
      </button>
      <input type="number" inputMode="numeric" min={0} value={count || ''} placeholder="0"
        onChange={e => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="w-7 text-center text-base font-bold tabular-nums bg-transparent focus:outline-none text-gray-800 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" aria-label={`Qty to ${who}`} />
      <button type="button" style={step} onClick={() => onChange(count + by)} aria-label={`${by === 1 ? 'One' : by} more to ${who}`}>
        <Plus size={12} strokeWidth={2.5} aria-hidden />
      </button>
    </div>
  );
}

// ── Editable history row (both logins have full edit) ──
function EditRow({ row, onSave, onDelete, onCancel, priced }: {
  row: Row; priced: boolean; onSave: (patch: Partial<Row>) => void; onDelete: () => void; onCancel: () => void;
}) {
  const [item, setItem] = useState(row.item);
  const [qty, setQty] = useState(String(row.qty));
  const [price, setPrice] = useState(String(row.unitPrice));
  const [from, setFrom] = useState<Venue>(row.from);
  const [date, setDate] = useState(row.date);
  const [note, setNote] = useState(row.note);
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div className="flex flex-col gap-2 p-3 rounded-2xl" style={{ ...glassTileStyle, border: '1.5px solid var(--color-brand-peach)' }}>
      <input value={item} onChange={e => setItem(e.target.value.toUpperCase())} className={`${inputClass} uppercase`} style={input} aria-label="Item" />
      {row.kind !== 'Settlement' && <FromToggle from={from} onChange={setFrom} verb={priced ? 'supplied' : 'lent'} />}
      <div className="flex gap-2 flex-wrap">
        <input type="number" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} className={`${inputClass} w-20 text-center`} style={input} aria-label="Qty" />
        {priced && <input type="number" inputMode="decimal" step="0.01" value={price} onChange={e => setPrice(e.target.value)} className={`${inputClass} w-24 text-center`} style={input} aria-label="Unit price" />}
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass} style={input} aria-label="Date" />
      </div>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note" className={inputClass} style={input} aria-label="Note" />
      <div className="flex gap-2 items-center">
        <button type="button" style={BTN_PRIMARY} onClick={() => onSave({ item, qty: Number(qty) || 0, unitPrice: Number(price) || 0, from, date, note })}>
          <Check size={13} strokeWidth={2.5} aria-hidden /> SAVE
        </button>
        <button type="button" style={glassButtonStyle} onClick={onCancel}>CANCEL</button>
        <button type="button" className="ml-auto" style={{ ...glassButtonStyle, color: confirmDel ? 'var(--color-danger)' : 'var(--color-ink-label)' }}
          onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))}>
          <Trash2 size={13} strokeWidth={2.25} aria-hidden /> {confirmDel ? 'TAP AGAIN' : 'DELETE'}
        </button>
      </div>
    </div>
  );
}

// ── Part 1: THE DOCUMENT ──
function DocumentPart({ data, run }: { data: Data; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  // Counters per line = how many each venue RECEIVED (1 gelato under G'Day → G'Day owes, Isola gets $20).
  type Counts = Record<string, Record<Venue, number>>;
  const [counts, setCounts] = useState<Counts>({});
  const [milkPack, setMilkPack] = useState<'bottle' | 'crate'>('bottle');
  const [item, setItem] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('Other');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmSettle, setConfirmSettle] = useState(false);
  const [gelatoEdit, setGelatoEdit] = useState(false);
  const [gPrice, setGPrice] = useState(String(data.gelato?.price ?? ''));
  const [gUnit, setGUnit] = useState(data.gelato?.unit || '6L tub');
  const [showOlder, setShowOlder] = useState(false);

  // Fixed lines priced from Supplier Prices (gelato falls back to the manual price until it syncs).
  const find = (re: RegExp) => data.catalogue.find(c => re.test(c.name));
  const gelatoCat = find(/gelato/i);
  const gelato = gelatoCat ? { price: gelatoCat.price, unit: gelatoCat.unit } : data.gelato;
  const bread = find(/sourdough/i);
  const milk = find(/sungold jersey|full cream/i);
  type Line = { key: string; item: string; category: string; price: number | null; unit: string; icon: React.ReactNode; sub?: React.ReactNode; per?: number };
  const lines: Line[] = [
    { key: 'gelato', item: 'GELATO', category: 'Gelato', price: gelato?.price ?? null, unit: gelato?.unit || 'tub', icon: <IceCreamCone size={14} strokeWidth={2.25} aria-hidden /> },
    { key: 'bread', item: 'SOURDOUGH LOAF', category: 'Bread', price: bread?.price ?? null, unit: 'loaf', icon: <Wheat size={14} strokeWidth={2.25} aria-hidden /> },
    {
      key: 'milk', category: 'Milk',
      // The counter always counts BOTTLES; in crate mode each tap adds 9.
      item: 'MILK (2L)', price: milk?.price ?? null, unit: 'bottle', per: milkPack === 'crate' ? 9 : 1,
      icon: <Milk size={14} strokeWidth={2.25} aria-hidden />,
      sub: (
        <div className="flex gap-1 justify-center flex-wrap">
          {(['crate', 'bottle'] as const).map(k => (
            <button key={k} type="button" onClick={() => setMilkPack(k)} style={{ ...chip(milkPack === k), height: '20px', padding: '0 8px', fontSize: '9px' }}>
              {k === 'crate' ? 'CRATE (9)' : 'BOTTLE (1)'}
            </button>
          ))}
        </div>
      ),
    },
  ];
  if (item.trim()) lines.push({ key: 'custom', item: item.trim(), category, price: price === '' ? null : Number(price) || 0, unit, icon: <Package size={14} strokeWidth={2.25} aria-hidden /> });

  const countOf = (k: string, v: Venue) => counts[k]?.[v] ?? 0;
  const setCount = (k: string, v: Venue, n: number) => setCounts(c => ({ ...c, [k]: { ...(c[k] ?? { GDT: 0, ISOLA: 0 }), [v]: n } }));
  // Counts are in the line's unit (milk = bottles), so qty = count. `per` only sets the tap step.
  const pending = lines.flatMap(l => (['GDT', 'ISOLA'] as Venue[])
    .filter(v => countOf(l.key, v) > 0 && l.price !== null)
    .map(v => ({ l, v, qty: countOf(l.key, v) })));
  const pendingTotal = (v: Venue) => pending.filter(p => p.v === v).reduce((a, p) => a + p.qty * (p.l.price || 0), 0);
  const reset = () => { setCounts({}); setItem(''); setPrice(''); setUnit(''); setCategory('Other'); setMilkPack('bottle'); };
  const addAll = async () => {
    for (const { l, v, qty } of pending) {
      await api('POST', { section: 'Document', from: other(v), item: l.item, qty, unitPrice: l.price, unit: l.unit, category: l.category });
    }
    reset();
  };

  // History since the last settlement up top; anything older tucked away.
  const lastSettleIdx = data.document.findIndex(r => r.kind === 'Settlement');
  const current = lastSettleIdx === -1 ? data.document : data.document.slice(0, lastSettleIdx);
  const older = lastSettleIdx === -1 ? [] : data.document.slice(lastSettleIdx);
  // Each venue's tab since the last settle-up: what it has received.
  const tabOf = (v: Venue) => current.filter(r => r.kind === 'Entry' && r.from === other(v))
    .reduce((a, r) => ({ value: a.value + r.qty * r.unitPrice, items: a.items + r.qty }), { value: 0, items: 0 });
  const tabs = { GDT: tabOf('GDT'), ISOLA: tabOf('ISOLA') };

  const bal = data.balance;
  const debtor: Venue | null = Math.abs(bal) < 0.005 ? null : bal > 0 ? 'ISOLA' : 'GDT';
  // What's counted but not yet added moves the balance live (+ = Isola owes G'Day).
  const pendingDelta = pendingTotal('ISOLA') - pendingTotal('GDT');
  const shown = Math.round((bal + pendingDelta) * 100) / 100;
  const getter: Venue | null = Math.abs(shown) < 0.005 ? null : shown > 0 ? 'GDT' : 'ISOLA';

  const renderRow = (r: Row) => {
    if (editing === r.id) {
      return <EditRow key={r.id} row={r} priced onCancel={() => setEditing(null)}
        onSave={patch => run(async () => { await api('PATCH', { id: r.id, ...patch }); setEditing(null); })}
        onDelete={() => run(async () => { await api('DELETE', { id: r.id }); setEditing(null); })} />;
    }
    if (r.kind === 'Settlement') {
      return (
        <div key={r.id} onClick={() => setEditing(r.id)} className="flex items-center gap-2 px-3 py-2 cursor-pointer">
          <div className="flex-1 h-px" style={{ background: 'rgba(0,0,0,0.08)' }} />
          <span style={{ ...label, color: 'var(--color-success)' }}>SETTLED {money(r.unitPrice)} · {shortDate(r.date)}</span>
          <div className="flex-1 h-px" style={{ background: 'rgba(0,0,0,0.08)' }} />
        </div>
      );
    }
    const value = r.qty * r.unitPrice;
    return (
      <div key={r.id} onClick={() => setEditing(r.id)} role="button" className="group flex items-center gap-3 px-3 rounded-2xl cursor-pointer" style={{ ...glassTileStyle, minHeight: `${TILE_H}px` }}>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-800 uppercase truncate">{r.qty} × {r.item}</div>
          <div className="text-xs text-gray-400 truncate">
            {shortDate(r.date)} · {NAME[r.from]} → {NAME[other(r.from)]} · {money(r.unitPrice)}{r.unit ? `/${r.unit}` : ''}{r.loggedBy ? ` · by ${r.loggedBy === 'GDT' ? "G'DT" : 'Isola'}` : ''}{r.note ? ` · ${r.note}` : ''}
          </div>
        </div>
        <span className="text-sm font-bold tabular-nums shrink-0" style={{ color: 'var(--color-ink-label)' }}>{money(value)}</span>
        <Pencil size={13} strokeWidth={2.25} aria-hidden className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-ink-muted)' }} />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Balance */}
      <div style={box} className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div style={label}>Running balance{pending.length > 0 && <span style={{ color: 'var(--color-ink-muted)' }}> · after ADD</span>}</div>
          {getter ? (
            <div className="text-lg font-bold text-gray-800 leading-tight mt-0.5 uppercase">
              {NAME[getter]} gets <span className="tabular-nums">{money(Math.abs(shown))}</span>
            </div>
          ) : (
            <div className="text-lg font-bold leading-tight mt-0.5" style={{ color: 'var(--color-success)' }}>ALL SQUARE</div>
          )}
        </div>
        {debtor && pending.length === 0 && (
          <button type="button" style={confirmSettle ? BTN_PRIMARY : glassButtonStyle}
            onClick={() => (confirmSettle ? run(async () => { await api('POST', { action: 'settle' }); setConfirmSettle(false); }) : setConfirmSettle(true))}
            onBlur={() => setConfirmSettle(false)}>
            <Check size={13} strokeWidth={2.5} aria-hidden /> {confirmSettle ? `CONFIRM ${money(Math.abs(bal))} PAID` : 'SETTLE UP'}
          </button>
        )}
      </div>

      {/* Add */}
      <div className="flex flex-col gap-2 p-3 rounded-2xl" style={glassTileStyle}>
        <div style={label}>Log stock</div>
        {/* Header: who received it, and each venue's tab since the last settle-up */}
        <div className="grid gap-2 items-end text-center" style={{ gridTemplateColumns: '84px minmax(0,1fr) 84px' }}>
          {(['GDT', 'ISOLA'] as Venue[]).map((v, i) => (
            <div key={v} style={{ gridColumn: i === 0 ? 1 : 3 }} className="min-w-0">
              <div style={label} className="leading-tight">{NAME[v]}</div>
              <div className="text-xs text-gray-400 leading-tight mt-0.5">{tabFoot(tabs[v].value, 0)}</div>
            </div>
          ))}
        </div>
        {lines.map(l => (
          <div key={l.key} className="grid gap-2 items-center rounded-2xl overflow-hidden" style={{ gridTemplateColumns: '84px minmax(0,1fr) 84px', background: 'rgba(255,255,255,0.55)', height: `${TILE_H}px` }}>
            <MiniCounter count={countOf(l.key, 'GDT')} onChange={n => setCount(l.key, 'GDT', n)} who={`G'Day: ${l.item}`} by={l.per ?? 1} />
            <div className="flex flex-col items-center gap-0.5 min-w-0 text-center">
              <div className="flex items-center justify-center gap-1.5 text-sm font-semibold text-gray-800 uppercase min-w-0 leading-tight max-w-full" style={{ fontFamily: '"stolzl", sans-serif' }}>
                <span style={{ color: 'var(--color-ink-muted)' }} className="shrink-0">{l.icon}</span>
                <span className="truncate">{l.key === 'milk' ? 'MILK' : l.item}</span>
              </div>
              {l.sub}
              {l.key === 'custom' ? (
                <div className="flex gap-1 items-center justify-center">
                  <input type="number" inputMode="decimal" step="0.01" min={0} value={price} onChange={e => setPrice(e.target.value)} className="text-xs px-2 py-0.5 rounded-lg w-20 text-center focus:outline-none text-gray-800" style={input} aria-label="Unit price" placeholder="$ EACH" />
                  {unit && <span className="text-[11px] text-gray-400 truncate uppercase">/ {unit}</span>}
                </div>
              ) : (
                <div className="text-[11px] leading-tight text-gray-400 tabular-nums uppercase">
                  {l.price !== null ? (l.per && l.per > 1 ? `${money(l.price * l.per)} / crate (${l.per} bottles)` : `${money(l.price)} / ${l.unit}`) : (l.key === 'gelato'
                    ? <button type="button" onClick={() => setGelatoEdit(true)} className="underline">Set price</button>
                    : 'No price in Supplier Prices')}
                </div>
              )}
            </div>
            <MiniCounter count={countOf(l.key, 'ISOLA')} onChange={n => setCount(l.key, 'ISOLA', n)} who={`Isola: ${l.item}`} by={l.per ?? 1} />
          </div>
        ))}
        <ItemSearch catalogue={data.catalogue} value={item}
          onChange={v => { setItem(v.toUpperCase()); setCategory(/^gelato$/i.test(v.trim()) ? 'Gelato' : guessCategory(v)); }}
          onPick={c => { setItem(c.name.toUpperCase()); setPrice(String(c.price)); setUnit(c.unit); setCategory(guessCategory(c.name)); }} />
        {/* Manual gelato price — only until gelato comes through Supplier Prices */}
        {!gelatoCat && gelatoEdit && (
          <div className="flex gap-2 items-center flex-wrap">
            <span style={label}>Gelato</span>
            <input type="number" inputMode="decimal" step="0.01" value={gPrice} onChange={e => setGPrice(e.target.value)} placeholder="$ per tub" className={`${inputClass} w-24 text-center`} style={input} aria-label="Gelato price" />
            <span className="text-gray-400 text-sm">per</span>
            <input value={gUnit} onChange={e => setGUnit(e.target.value)} className={`${inputClass} w-28`} style={input} aria-label="Gelato unit" />
            <button type="button" style={BTN_PRIMARY} disabled={!(Number(gPrice) > 0)} className="disabled:opacity-40"
              onClick={() => run(async () => { await api('POST', { action: 'setGelato', price: Number(gPrice), unit: gUnit }); setGelatoEdit(false); })}>SAVE</button>
            <button type="button" onClick={() => setGelatoEdit(false)} aria-label="Cancel" className="text-gray-400"><X size={16} strokeWidth={2.25} aria-hidden /></button>
          </div>
        )}
        <div className="flex gap-2 items-center pt-1">
          <span className="text-xs text-gray-400 tabular-nums min-w-0">
            {pending.length === 0 ? 'Tap + under whoever received it' : (['GDT', 'ISOLA'] as Venue[]).filter(v => pending.some(p => p.v === v))
              .map(v => `${v === 'GDT' ? 'Isola' : "G'Day"} gets ${money(pendingTotal(v))}`).join(' · ')}
          </span>
          <button type="button" disabled={pending.length === 0} className="ml-auto disabled:opacity-40" style={BTN_PRIMARY} onClick={() => run(addAll)}>
            ADD{pending.length > 1 ? ` ${pending.length}` : ''}
          </button>
        </div>
      </div>

      {/* History */}
      <div className="flex flex-col gap-2">
        {current.length === 0 && older.length === 0 && <p className="text-sm text-gray-400 px-1">Nothing logged yet.</p>}
        {current.map(renderRow)}
        {older.length > 0 && (
          showOlder ? older.map(renderRow) : (
            <button type="button" onClick={() => setShowOlder(true)} className="self-center" style={glassButtonStyle}>SHOW SETTLED HISTORY ({older.filter(r => r.kind !== 'Settlement').length})</button>
          )
        )}
      </div>
    </div>
  );
}

// ── Part 2: CLEAN TRANSACTIONS ──
function CleanPart({ data, run }: { data: Data; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  // Counters = how many each venue BORROWED (G'Day borrows milk from Isola → G'Day's counter).
  const [got, setGot] = useState<Record<Venue, number>>({ GDT: 0, ISOLA: 0 });
  const [item, setItem] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [showSquared, setShowSquared] = useState(false);

  const open = data.clean.filter(r => r.status !== 'Squared');
  const squared = data.clean.filter(r => r.status === 'Squared');
  const canAdd = item.trim() && (got.GDT > 0 || got.ISOLA > 0);
  const owes = (v: Venue) => open.filter(r => r.from === other(v)).length;
  const addAll = async () => {
    for (const v of ['GDT', 'ISOLA'] as Venue[]) {
      if (got[v] > 0) await api('POST', { section: 'Clean', from: other(v), item, qty: got[v], note });
    }
    setItem(''); setGot({ GDT: 0, ISOLA: 0 }); setNote('');
  };
  const oweFoot = (v: Venue) => { const n = owes(v); return n ? <>OWES <span className="font-semibold" style={{ color: 'var(--color-ink-label)' }}>{n}</span> open</> : 'ALL SQUARE'; };

  const renderRow = (r: Row) => {
    if (editing === r.id) {
      return <EditRow key={r.id} row={r} priced={false} onCancel={() => setEditing(null)}
        onSave={patch => run(async () => { await api('PATCH', { id: r.id, ...patch }); setEditing(null); })}
        onDelete={() => run(async () => { await api('DELETE', { id: r.id }); setEditing(null); })} />;
    }
    const done = r.status === 'Squared';
    return (
      <div key={r.id} className="flex items-center gap-3 px-3 rounded-2xl" style={{ ...glassTileStyle, minHeight: `${TILE_H}px`, opacity: done ? 0.6 : 1 }}>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditing(r.id)} role="button">
          <div className={`text-sm font-semibold uppercase truncate ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
            {NAME[other(r.from)]} owes {NAME[r.from]} {r.qty} × {r.item}
          </div>
          <div className="text-xs text-gray-400 truncate">
            Borrowed {shortDate(r.date)}{r.loggedBy ? ` · by ${r.loggedBy === 'GDT' ? "G'DT" : 'Isola'}` : ''}{r.note ? ` · ${r.note}` : ''}
          </div>
        </div>
        <button type="button" style={done ? glassButtonStyle : BTN_PRIMARY}
          onClick={() => run(() => api('PATCH', { id: r.id, status: done ? 'Open' : 'Squared' }))}>
          {done ? 'REOPEN' : <><Check size={13} strokeWidth={2.5} aria-hidden /> SQUARED</>}
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div style={box}>
        <div style={label}>Open</div>
        <div className="text-lg font-bold text-gray-800 leading-tight mt-0.5">
          {open.length === 0 ? <span style={{ color: 'var(--color-success)' }}>ALL SQUARE</span> : `${open.length} item${open.length === 1 ? '' : 's'} to reorder`}
        </div>
      </div>

      <div className="flex flex-col gap-2 p-3 rounded-2xl" style={glassTileStyle}>
        <div style={label}>Borrowed</div>
        <div className="grid gap-2 items-stretch" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr) minmax(0,1fr)' }}>
          <VenueCounter venue="GDT" count={got.GDT} onChange={n => setGot(g => ({ ...g, GDT: n }))} foot={oweFoot('GDT')} />
          <div className="flex flex-col gap-2 justify-center min-w-0 [&>*]:flex-none">
            <ItemSearch catalogue={data.catalogue} value={item} onChange={v => setItem(v.toUpperCase())} onPick={c => setItem(c.name.toUpperCase())} />
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={`${inputClass} w-full min-w-0`} style={input} aria-label="Note" />
          </div>
          <VenueCounter venue="ISOLA" count={got.ISOLA} onChange={n => setGot(g => ({ ...g, ISOLA: n }))} foot={oweFoot('ISOLA')} />
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-gray-400 tabular-nums">
            {got.GDT > 0 && `G'Day borrows ${got.GDT}`}{got.GDT > 0 && got.ISOLA > 0 && ' · '}{got.ISOLA > 0 && `Isola borrows ${got.ISOLA}`}
          </span>
          <button type="button" disabled={!canAdd} className="ml-auto disabled:opacity-40" style={BTN_PRIMARY} onClick={() => run(addAll)}>
            ADD
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {open.map(renderRow)}
        {squared.length > 0 && (
          showSquared ? squared.map(renderRow) : (
            <button type="button" onClick={() => setShowSquared(true)} className="self-center" style={glassButtonStyle}>SHOW SQUARED ({squared.length})</button>
          )
        )}
      </div>
    </div>
  );
}

export default function TheDocumentCard({ active = true, onBalance }: { active?: boolean; onBalance?: (balance: number, openClean: number) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<'document' | 'clean'>('document');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref so an inline onBalance from the parent doesn't re-trigger the load effect.
  const onBalanceRef = useRef(onBalance);
  useEffect(() => { onBalanceRef.current = onBalance; }, [onBalance]);

  const load = useCallback(() => api('GET')
    .then((d: Data) => {
      setData(d);
      setError(null);
      onBalanceRef.current?.(d.balance, d.clean.filter(r => r.status !== 'Squared').length);
    })
    .catch((e: Error) => setError(e.message)), []);

  // Reload every time the widget is opened so both venues see the latest tally.
  useEffect(() => {
    if (!active) return;
    api('GET')
      .then((d: Data) => {
        setData(d);
        setError(null);
        onBalanceRef.current?.(d.balance, d.clean.filter(r => r.status !== 'Squared').length);
      })
      .catch((e: Error) => setError(e.message));
  }, [active]);

  // Run a write, then reload so both venues always see Notion's truth.
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [busy, load]);

  const openClean = data?.clean.filter(r => r.status !== 'Squared').length ?? 0;

  return (
    <div className="flex flex-col gap-4" style={{ opacity: busy ? 0.7 : 1, transition: 'opacity 150ms' }}>
      <div className="flex items-stretch gap-2" role="tablist" aria-label="The Document">
        {([
          { key: 'document', label: 'THE DOCUMENT', count: data && Math.abs(data.balance) >= 0.005 ? money(Math.abs(data.balance)) : undefined },
          { key: 'clean', label: 'CLEAN TRANSACTIONS', count: openClean || undefined },
        ] as const).map(({ key, label: l, count }) => {
          const selected = tab === key;
          return (
            <button key={key} role="tab" aria-selected={selected} onClick={() => setTab(key)}
              className="flex-1 basis-0 min-w-0 rounded-2xl flex items-center justify-center gap-2 px-2 text-sm font-semibold"
              style={{ ...glassTileStyle, height: `${TILE_H}px`, color: 'var(--color-ink-label)', fontFamily: '"stolzl", sans-serif', letterSpacing: '0.04em',
                ...(selected ? { background: 'rgba(251,205,173,0.12)', border: '1px solid var(--color-brand-peach)', boxShadow: 'var(--glass-shadow)' } : {}) }}>
              <span className="truncate">{l}</span>
              {count !== undefined && <span className="text-xs text-gray-400 tabular-nums">{count}</span>}
            </button>
          );
        })}
      </div>

      {error && <p className="text-xs px-1" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {!data && !error && <p className="text-sm text-gray-400 px-1">Loading…</p>}
      {data && (tab === 'document' ? <DocumentPart data={data} run={run} /> : <CleanPart data={data} run={run} />)}
    </div>
  );
}
