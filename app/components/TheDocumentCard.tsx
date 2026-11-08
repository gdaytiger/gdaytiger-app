'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Pencil, Search, Trash2, IceCreamCone, Minus, Plus, Wheat, Milk, Package } from 'lucide-react';
import { glassTileStyle, glassButtonStyle, glassButtonActiveStyle, glassButtonPrimaryStyle } from '@/app/lib/theme';

// THE DOCUMENT — running stock tally between G'Day Tiger and Isola Di Capri.
// Shared by the owner dashboard (bottom sheet) and the Isola-only /document page.
// Two parts: THE DOCUMENT ($ tally of gelato / bread / milk, with Settle up) and
// CLEAN TRANSACTIONS (item-for-item IOUs: borrowed → reordered → squared).
// Self-contained — fetches /api/the-document.

type Venue = 'GDT' | 'ISOLA';
type Row = {
  id: string; section: 'Document' | 'Clean'; kind: 'Entry' | 'Settlement';
  item: string; from: Venue; category: string; qty: number; unitPrice: number; unit: string;
  date: string; status: 'Open' | 'Squared'; loggedBy: Venue | ''; note: string; created: string;
};
type CatItem = { name: string; price: number; unit: string };
type Data = {
  role: 'owner' | 'partner'; venue: Venue; document: Row[]; clean: Row[]; balance: number;
  fixedPrices: Record<string, CatItem | null>; catalogue: CatItem[];
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

// ── Editable history row. Priced lines: qty and note only; the price is always read-only ──
function EditRow({ row, onSave, onDelete, onCancel, priced }: {
  row: Row; priced: boolean; onSave: (patch: Partial<Row>) => void; onDelete: () => void; onCancel: () => void;
}) {
  const [item, setItem] = useState(row.item);
  const [qty, setQty] = useState(String(row.qty));
  const [from, setFrom] = useState<Venue>(row.from);
  const [date, setDate] = useState(row.date);
  const [note, setNote] = useState(row.note);
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div className="flex flex-col gap-2 p-3 rounded-2xl" style={{ ...glassTileStyle, border: '1.5px solid var(--color-brand-peach)' }}>
      {priced ? (
        <div className="text-sm font-semibold text-gray-800 uppercase truncate">
          {row.item} <span className="text-xs font-normal text-gray-400 tabular-nums">{money(row.unitPrice)}{row.unit ? ` / ${row.unit}` : ''}</span>
        </div>
      ) : (
        <>
          <input value={item} onChange={e => setItem(e.target.value.toUpperCase())} className={`${inputClass} uppercase`} style={input} aria-label="Item" />
          <FromToggle from={from} onChange={setFrom} verb="lent" />
        </>
      )}
      {(row.kind !== 'Settlement' || !priced) && (
        <div className="flex gap-2 flex-wrap">
          <input type="number" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} className={`${inputClass} w-20 text-center`} style={input} aria-label="Qty" />
          {!priced && <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputClass} style={input} aria-label="Date" />}
        </div>
      )}
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note" className={inputClass} style={input} aria-label="Note" />
      <div className="flex gap-2 items-center">
        <button type="button" style={BTN_PRIMARY} onClick={() => onSave(priced
          ? (row.kind === 'Settlement' ? { note } : { qty: Number(qty) || 0, note })
          : { item, qty: Number(qty) || 0, from, date, note })}>
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
function DocumentPart({ data, run, reload }: { data: Data; run: (fn: () => Promise<unknown>) => Promise<void>; reload: () => Promise<unknown> }) {
  // Counters = how many each venue has RECEIVED since the last Settle up (1 gelato under
  // G'Day → Isola gets $20). They AUTOSAVE: every change is written to Notion as a +/−
  // entry ~0.7s after the last tap, so the counter is always the live tally. Deltas (not
  // overwrites) keep both venues' phones from clobbering each other.
  const [unsaved, setUnsaved] = useState<Record<string, number>>({}); // `${item}|${venue}` → delta not yet in Notion
  const [saving, setSaving] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [milkPack, setMilkPack] = useState<'bottle' | 'crate'>('crate');
  const [item, setItem] = useState('');
  const [price, setPrice] = useState(''); // only for items that aren't in Supplier Prices
  const [category, setCategory] = useState('Other');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmSettle, setConfirmSettle] = useState(false);
  const [confirmLine, setConfirmLine] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [showLog, setShowLog] = useState(false);

  // Lines are priced from Supplier Prices, matched by the server (the API re-checks on save).
  // Only an item that isn't in Supplier Prices can be given a price, when it's added.
  const gelato = data.fixedPrices['GELATO'];
  const bread = data.fixedPrices['SOURDOUGH LOAF'];
  const milk = data.fixedPrices['MILK (2L)'];
  const catalogueItem = (name: string) => data.catalogue.find(c => c.price > 0 && c.name.trim().toUpperCase() === name.trim().toUpperCase());
  type Line = { key: string; item: string; category: string; price: number | null; unit: string; icon: React.ReactNode; sub?: React.ReactNode; per?: number; removable?: boolean; customPrice?: boolean };
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

  // This period = everything since the last settlement (counters reset to 0 on Settle up).
  const lastSettleIdx = data.document.findIndex(r => r.kind === 'Settlement');
  const current = lastSettleIdx === -1 ? data.document : data.document.slice(0, lastSettleIdx);
  const older = lastSettleIdx === -1 ? [] : data.document.slice(lastSettleIdx);
  const entries = current.filter(r => r.kind === 'Entry');

  // Any other item counted this period keeps its own removable line, at today's Supplier
  // Prices price, or the price it was first logged at if it isn't in Supplier Prices.
  const fixedItems = new Set(lines.map(l => l.item));
  for (const r of [...entries].reverse()) {
    if (fixedItems.has(r.item)) continue;
    fixedItems.add(r.item);
    const cat = catalogueItem(r.item);
    lines.push({ key: r.item, item: r.item, category: r.category || 'Other', price: cat?.price ?? (r.unitPrice > 0 ? r.unitPrice : null), unit: cat?.unit || r.unit, removable: true, icon: <Package size={14} strokeWidth={2.25} aria-hidden /> });
  }
  const typed = item.trim();
  if (typed && !fixedItems.has(typed)) {
    const cat = catalogueItem(typed);
    lines.push({ key: 'custom', item: typed, category, price: cat ? cat.price : (Number(price) > 0 ? Number(price) : null), unit: cat?.unit || '', customPrice: !cat, icon: <Package size={14} strokeWidth={2.25} aria-hidden /> });
  }

  const keyOf = (l: Line, v: Venue) => `${l.item}|${v}`;
  const savedQty = (l: Line, v: Venue) => entries.filter(r => r.item === l.item && r.from === other(v)).reduce((a, r) => a + r.qty, 0);
  const countOf = (l: Line, v: Venue) => Math.max(0, savedQty(l, v) + (unsaved[keyOf(l, v)] ?? 0));

  // ── Autosave plumbing ──
  const unsavedRef = useRef(unsaved);
  useEffect(() => { unsavedRef.current = unsaved; }, [unsaved]);
  const metaRef = useRef<Record<string, { l: Line; v: Venue }>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const inFlightRef = useRef<Record<string, boolean>>({});
  const body = (key: string, qty: number) => {
    const { l, v } = metaRef.current[key];
    return { section: 'Document', from: other(v), item: l.item, qty, unitPrice: l.price, unit: l.unit, category: l.category, note: qty < 0 ? 'counter adjusted down' : '' };
  };
  // Plain function (not useCallback) so the retry timer can call it; only touches refs + stable setters.
  async function flush(key: string): Promise<void> {
    if (inFlightRef.current[key]) { timersRef.current[key] = setTimeout(() => flush(key), 400); return; }
    const delta = unsavedRef.current[key] ?? 0;
    if (!delta) return;
    inFlightRef.current[key] = true;
    setSaving(n => n + 1);
    try {
      await api('POST', body(key, delta));
      await reload();
      setUnsaved(u => { const n = { ...u }; n[key] = (n[key] ?? 0) - delta; if (!n[key]) delete n[key]; return n; });
      setSaveError(null);
    } catch (e) {
      setSaveError(`Not saved — ${(e as Error).message}. Tap again to retry.`);
    } finally {
      inFlightRef.current[key] = false;
      setSaving(n => n - 1);
    }
  }
  // Leaving the page / unmounting mid-debounce: fire what's left with keepalive so nothing is lost.
  useEffect(() => {
    const sendNow = () => {
      for (const [key, delta] of Object.entries(unsavedRef.current)) {
        if (!delta || inFlightRef.current[key] || !metaRef.current[key]) continue;
        clearTimeout(timersRef.current[key]);
        fetch('/api/the-document', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(key, delta)) }).catch(() => {});
        unsavedRef.current = { ...unsavedRef.current, [key]: 0 };
      }
    };
    window.addEventListener('pagehide', sendNow);
    return () => { window.removeEventListener('pagehide', sendNow); sendNow(); };
  }, []);
  const setCount = (l: Line, v: Venue, n: number) => {
    if (l.price === null) return; // no price yet, so it can't be valued
    const d = n - countOf(l, v);
    if (!d) return;
    const key = keyOf(l, v);
    metaRef.current[key] = { l, v };
    setUnsaved(u => ({ ...u, [key]: (u[key] ?? 0) + d }));
    clearTimeout(timersRef.current[key]);
    timersRef.current[key] = setTimeout(() => flush(key), 700);
  };
  const pendingCount = Object.values(unsaved).filter(Boolean).length + saving;
  const deleteLine = (l: Line) => run(async () => {
    await api('POST', { action: 'deleteLine', item: l.item });
    setConfirmLine(null);
    if (l.item === typed) { setItem(''); setPrice(''); }
  });

  // Each venue's tab since the last settle-up (what it has received), incl. taps still saving.
  const unsavedValue = (v: Venue) => lines.reduce((a, l) => a + (unsaved[keyOf(l, v)] ?? 0) * (l.price || 0), 0);
  const tabOf = (v: Venue) => ({ value: entries.filter(r => r.from === other(v)).reduce((a, r) => a + r.qty * r.unitPrice, 0) + unsavedValue(v), items: 0 });
  const tabs = { GDT: tabOf('GDT'), ISOLA: tabOf('ISOLA') };

  const bal = data.balance;
  const debtor: Venue | null = Math.abs(bal) < 0.005 ? null : bal > 0 ? 'ISOLA' : 'GDT';
  // Taps still saving move the balance straight away (+ = Isola owes G'Day).
  const shown = Math.round((bal + unsavedValue('ISOLA') - unsavedValue('GDT')) * 100) / 100;
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
          <div style={label}>Running balance</div>
          {getter ? (
            <div className="text-lg font-bold text-gray-800 leading-tight mt-0.5 uppercase">
              {NAME[getter]} gets <span className="tabular-nums">{money(Math.abs(shown))}</span>
            </div>
          ) : (
            <div className="text-lg font-bold leading-tight mt-0.5" style={{ color: 'var(--color-success)' }}>ALL SQUARE</div>
          )}
        </div>
        {debtor && pendingCount === 0 && (
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
            <MiniCounter count={countOf(l, 'GDT')} onChange={n => setCount(l, 'GDT', n)} who={`G'Day: ${l.item}`} by={l.per ?? 1} />
            <div className="flex flex-col items-center gap-0.5 min-w-0 text-center">
              <div className="flex items-center justify-center gap-1.5 text-sm font-semibold text-gray-800 uppercase min-w-0 leading-tight max-w-full" style={{ fontFamily: '"stolzl", sans-serif' }}>
                <span style={{ color: 'var(--color-ink-muted)' }} className="shrink-0">{l.icon}</span>
                <span className="truncate">{l.key === 'milk' ? 'MILK' : l.item}</span>
                {/* Hidden while taps are saving, so an autosave can't bring a removed line back */}
                {l.removable && pendingCount === 0 && (
                  <button type="button" onClick={() => (confirmLine === l.item ? deleteLine(l) : setConfirmLine(l.item))} onBlur={() => setConfirmLine(null)}
                    aria-label={confirmLine === l.item ? `Confirm removing ${l.item}` : `Remove ${l.item}`} className="shrink-0 p-1 -m-1"
                    style={{ color: confirmLine === l.item ? 'var(--color-danger)' : 'var(--color-ink-muted)' }}>
                    <Trash2 size={13} strokeWidth={2.25} aria-hidden />
                  </button>
                )}
              </div>
              {l.sub}
              {l.customPrice ? (
                <input type="number" inputMode="decimal" step="0.01" min={0} value={price} onChange={e => setPrice(e.target.value)} className="text-xs px-2 py-0.5 rounded-lg w-20 text-center focus:outline-none text-gray-800" style={input} aria-label="Unit price" placeholder="$ EACH" />
              ) : confirmLine === l.item ? (
                <div className="text-[11px] leading-tight uppercase" style={{ color: 'var(--color-danger)' }}>Tap bin again to remove</div>
              ) : (
                <div className="text-[11px] leading-tight text-gray-400 tabular-nums uppercase">
                  {l.price !== null
                    ? (l.per && l.per > 1 ? `${money(l.price * l.per)} / crate (${l.per} bottles)` : `${money(l.price)}${l.unit ? ` / ${l.unit}` : ''}`)
                    : 'No price in Supplier Prices'}
                </div>
              )}
            </div>
            <MiniCounter count={countOf(l, 'ISOLA')} onChange={n => setCount(l, 'ISOLA', n)} who={`Isola: ${l.item}`} by={l.per ?? 1} />
          </div>
        ))}
        <ItemSearch catalogue={data.catalogue} value={item}
          onChange={v => { setItem(v.toUpperCase()); setPrice(''); setCategory(/^gelato$/i.test(v.trim()) ? 'Gelato' : guessCategory(v)); }}
          onPick={c => { setItem(c.name.toUpperCase()); setPrice(''); setCategory(guessCategory(c.name)); }} />
        {/* Silent when saving works — only a failed save shows a line */}
        {saveError && <div className="text-xs pt-1 uppercase" style={{ color: 'var(--color-danger)' }}>{saveError}</div>}
      </div>

      {/* History */}
      <div className="flex flex-col gap-2">
        {/* Every counter tap is its own +/− line, so the log stays tucked away — toggle open/closed */}
        {(current.length > 0 || older.length > 0) && (
          <button type="button" onClick={() => { setShowLog(v => !v); setShowOlder(false); }} className="self-center" style={showLog ? { ...glassButtonStyle, ...glassButtonActiveStyle } : glassButtonStyle}>
            {showLog ? 'HIDE LOG' : `SHOW LOG (${current.filter(r => r.kind === 'Entry').length})`}
          </button>
        )}
        {showLog && current.map(renderRow)}
        {showLog && older.length > 0 && (
          <button type="button" onClick={() => setShowOlder(v => !v)} className="self-center" style={glassButtonStyle}>
            {showOlder ? 'HIDE SETTLED HISTORY' : `SHOW SETTLED HISTORY (${older.filter(r => r.kind !== 'Settlement').length})`}
          </button>
        )}
        {showLog && showOlder && older.map(renderRow)}
      </div>
    </div>
  );
}

// ── Part 2: CLEAN TRANSACTIONS ──
// Same shape as Log Stock: one 62px tile per item, a counter each side = how many that venue
// has BORROWED and still owes back. AUTOSAVES as +/− lines (~0.7s after the last tap); tapping
// down to 0 = reordered/returned, and the server marks that item's lines Squared.
function CleanPart({ data, run, reload }: { data: Data; run: (fn: () => Promise<unknown>) => Promise<void>; reload: () => Promise<unknown> }) {
  const [item, setItem] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [unsaved, setUnsaved] = useState<Record<string, number>>({}); // `${item}|${venue}` → delta not yet in Notion
  const [saveError, setSaveError] = useState<string | null>(null);

  const open = data.clean.filter(r => r.status !== 'Squared');
  const keyOf = (name: string, v: Venue) => `${name}|${v}`;
  const savedQty = (name: string, v: Venue) => open.filter(r => r.item === name && r.from === other(v)).reduce((a, r) => a + r.qty, 0);
  const countOf = (name: string, v: Venue) => Math.max(0, savedQty(name, v) + (unsaved[keyOf(name, v)] ?? 0));

  // Tiles: every item still owed either way (oldest first), plus anything with unsaved taps, plus the search.
  const names: string[] = [];
  for (const r of [...open].reverse()) if (!names.includes(r.item)) names.push(r.item);
  for (const key of Object.keys(unsaved)) { const n = key.split('|')[0]; if (!names.includes(n)) names.push(n); }
  const typed = item.trim();
  if (typed && !names.includes(typed)) names.push(typed);
  const shownNames = names.filter(n => n === typed || countOf(n, 'GDT') > 0 || countOf(n, 'ISOLA') > 0 || unsaved[keyOf(n, 'GDT')] || unsaved[keyOf(n, 'ISOLA')]);

  // ── Autosave plumbing (mirrors Log Stock) ──
  const unsavedRef = useRef(unsaved);
  useEffect(() => { unsavedRef.current = unsaved; }, [unsaved]);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const inFlightRef = useRef<Record<string, boolean>>({});
  const body = (key: string, qty: number) => {
    const [name, v] = key.split('|') as [string, Venue];
    return { section: 'Clean', from: other(v), item: name, qty, note: qty < 0 ? 'reordered / returned' : '' };
  };
  // Plain function (not useCallback) so the retry timer can call it; only touches refs + stable setters.
  async function flush(key: string): Promise<void> {
    if (inFlightRef.current[key]) { timersRef.current[key] = setTimeout(() => flush(key), 400); return; }
    const delta = unsavedRef.current[key] ?? 0;
    if (!delta) return;
    inFlightRef.current[key] = true;
    try {
      await api('POST', body(key, delta));
      await reload();
      setUnsaved(u => { const n = { ...u }; n[key] = (n[key] ?? 0) - delta; if (!n[key]) delete n[key]; return n; });
      setSaveError(null);
    } catch (e) {
      setSaveError(`Not saved — ${(e as Error).message}. Tap again to retry.`);
    } finally {
      inFlightRef.current[key] = false;
    }
  }
  useEffect(() => {
    const sendNow = () => {
      for (const [key, delta] of Object.entries(unsavedRef.current)) {
        if (!delta || inFlightRef.current[key]) continue;
        clearTimeout(timersRef.current[key]);
        fetch('/api/the-document', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(key, delta)) }).catch(() => {});
        unsavedRef.current = { ...unsavedRef.current, [key]: 0 };
      }
    };
    window.addEventListener('pagehide', sendNow);
    return () => { window.removeEventListener('pagehide', sendNow); sendNow(); };
  }, []);
  const setCount = (name: string, v: Venue, n: number) => {
    const d = n - countOf(name, v);
    if (!d || !name) return;
    const key = keyOf(name, v);
    setUnsaved(u => ({ ...u, [key]: (u[key] ?? 0) + d }));
    clearTimeout(timersRef.current[key]);
    timersRef.current[key] = setTimeout(() => flush(key), 700);
  };

  const owes = (v: Venue) => shownNames.filter(n => countOf(n, v) > 0).length;
  const totalOpen = owes('GDT') + owes('ISOLA');
  const oweFoot = (v: Venue) => { const n = owes(v); return n ? <>OWES <span className="font-semibold" style={{ color: 'var(--color-ink-label)' }}>{n}</span></> : 'ALL SQUARE'; };

  const renderRow = (r: Row) => {
    if (editing === r.id) {
      return <EditRow key={r.id} row={r} priced={false} onCancel={() => setEditing(null)}
        onSave={patch => run(async () => { await api('PATCH', { id: r.id, ...patch }); setEditing(null); })}
        onDelete={() => run(async () => { await api('DELETE', { id: r.id }); setEditing(null); })} />;
    }
    const done = r.status === 'Squared';
    const back = r.qty < 0;
    return (
      <div key={r.id} onClick={() => setEditing(r.id)} role="button" className="group flex items-center gap-3 px-3 rounded-2xl cursor-pointer" style={{ ...glassTileStyle, minHeight: `${TILE_H}px`, opacity: done ? 0.6 : 1 }}>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold uppercase truncate text-gray-800">
            {back ? `${NAME[other(r.from)]} reordered ${Math.abs(r.qty)} × ${r.item}` : `${NAME[other(r.from)]} borrowed ${r.qty} × ${r.item}`}
          </div>
          <div className="text-xs text-gray-400 truncate">
            {shortDate(r.date)}{r.loggedBy ? ` · by ${r.loggedBy === 'GDT' ? "G'DT" : 'Isola'}` : ''}{done ? ' · squared' : ''}
          </div>
        </div>
        <Pencil size={13} strokeWidth={2.25} aria-hidden className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-ink-muted)' }} />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div style={box}>
        <div style={label}>Open</div>
        <div className="text-lg font-bold text-gray-800 leading-tight mt-0.5">
          {totalOpen === 0 ? <span style={{ color: 'var(--color-success)' }}>ALL SQUARE</span> : `${totalOpen} ITEM${totalOpen === 1 ? '' : 'S'} TO REORDER`}
        </div>
      </div>

      <div className="flex flex-col gap-2 p-3 rounded-2xl" style={glassTileStyle}>
        <div style={label}>Borrowed</div>
        <div className="grid gap-2 items-end text-center" style={{ gridTemplateColumns: '84px minmax(0,1fr) 84px' }}>
          {(['GDT', 'ISOLA'] as Venue[]).map((v, i) => (
            <div key={v} style={{ gridColumn: i === 0 ? 1 : 3 }} className="min-w-0">
              <div style={label} className="leading-tight">{NAME[v]}</div>
              <div className="text-xs text-gray-400 leading-tight mt-0.5">{oweFoot(v)}</div>
            </div>
          ))}
        </div>
        {shownNames.map(n => (
          <div key={n} className="grid gap-2 items-center rounded-2xl overflow-hidden" style={{ gridTemplateColumns: '84px minmax(0,1fr) 84px', background: 'rgba(255,255,255,0.55)', height: `${TILE_H}px` }}>
            <MiniCounter count={countOf(n, 'GDT')} onChange={c => setCount(n, 'GDT', c)} who={`G'Day borrowed: ${n}`} />
            <div className="flex items-center justify-center gap-1.5 text-sm font-semibold text-gray-800 uppercase min-w-0 leading-tight text-center" style={{ fontFamily: '"stolzl", sans-serif' }}>
              <Package size={14} strokeWidth={2.25} aria-hidden className="shrink-0" style={{ color: 'var(--color-ink-muted)' }} />
              <span className="line-clamp-2 break-words">{n}</span>
            </div>
            <MiniCounter count={countOf(n, 'ISOLA')} onChange={c => setCount(n, 'ISOLA', c)} who={`Isola borrowed: ${n}`} />
          </div>
        ))}
        <ItemSearch catalogue={data.catalogue} value={item} onChange={v => setItem(v.toUpperCase())} onPick={c => setItem(c.name.toUpperCase())} />
        {saveError && <div className="text-xs pt-1 uppercase" style={{ color: 'var(--color-danger)' }}>{saveError}</div>}
      </div>

      <div className="flex flex-col gap-2">
        {data.clean.length > 0 && (
          <button type="button" onClick={() => setShowLog(v => !v)} className="self-center" style={showLog ? { ...glassButtonStyle, ...glassButtonActiveStyle } : glassButtonStyle}>
            {showLog ? 'HIDE LOG' : `SHOW LOG (${data.clean.length})`}
          </button>
        )}
        {showLog && data.clean.map(renderRow)}
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
      {data && (tab === 'document' ? <DocumentPart data={data} run={run} reload={load} /> : <CleanPart data={data} run={run} reload={load} />)}
    </div>
  );
}
