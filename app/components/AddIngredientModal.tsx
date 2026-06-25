'use client';

import { useEffect, useState } from 'react';

type Match = {
  supplier: string;
  file: string;
  date: string;
  line: string;
  prices: number[];
  suggestedPrice: number;
  suggestedUnit?: string;
};

type SearchResponse = { ok: boolean; error?: string; matches?: Match[]; count?: number; note?: string };
type AddResponse = { ok: boolean; error?: string; name?: string; supplier?: string; synced?: boolean };

// Title-case a raw query for the default ingredient name.
function titleCase(s: string) {
  return s.trim().replace(/\b\w/g, c => c.toUpperCase());
}

// Keep only the most recent invoice per supplier. Matches arrive newest-first
// from the API, so the first time we see a supplier is its latest invoice.
function newestPerSupplier(ms: Match[]) {
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const m of ms) {
    const key = m.supplier.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

// Category columns per costing sheet (must match the sheet headers).
const CATEGORIES: Record<'food' | 'coffee', string[]> = {
  food: ['Bread', 'Meats', 'Cheese', 'Vegetables', 'Sauces', 'Made in House', 'Extras', 'Packaging', 'Pantry'],
  coffee: ['Coffee', 'Milk', 'Extras', 'Packaging', 'Made in House'],
};

export default function AddIngredientModal({
  open,
  onClose,
  onSuccess,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  // Optional starting values, e.g. from a "NEW SKU" row on the dashboard.
  prefill?: { query?: string; supplier?: string; price?: number; sig?: string };
}) {
  const [query, setQuery] = useState(prefill?.query ?? '');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [note, setNote] = useState<string | null>(null);

  // Confirm-form fields
  const [name, setName] = useState(prefill?.query ? titleCase(prefill.query) : '');
  const [price, setPrice] = useState(prefill?.price != null ? String(prefill.price) : '');
  const [unit, setUnit] = useState('');
  const [supplier, setSupplier] = useState(prefill?.supplier ?? '');
  const [type, setType] = useState<'food' | 'coffee'>('food');
  const [category, setCategory] = useState('');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AddResponse | null>(null);

  // No reset effect needed: the parent mounts this modal only while open, so
  // each open starts from these initial state values.

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true); setSearched(false); setSearchError(null); setMatches([]); setNote(null); setSelectedIdx(null);
    if (!name) setName(titleCase(q));
    try {
      const res = await fetch('/api/find-ingredient-price', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }),
      });
      const raw = await res.text();
      let data: SearchResponse;
      try {
        data = JSON.parse(raw);
      } catch {
        // Non-JSON (e.g. a gateway timeout page) — show a readable message.
        setSearchError(res.status === 504 || /timeout/i.test(raw)
          ? 'The search timed out. If this is the first run, build the invoice cache (see notes), then try again.'
          : `Unexpected response (HTTP ${res.status}).`);
        return;
      }
      if (!res.ok || !data.ok) { setSearchError(data.error || `HTTP ${res.status}`); }
      else {
        // One card per supplier — the most recent invoice from each.
        const ms = newestPerSupplier(data.matches || []);
        setMatches(ms);
        setNote(data.note || null);
        // Auto-fill from the newest match so cost + weight + supplier populate
        // with no click. User can switch supplier (if several) or edit the price.
        if (ms.length > 0) {
          const m0 = ms[0];
          setSelectedIdx(0);
          setSupplier(m0.supplier);
          setPrice(String(m0.suggestedPrice));
          if (m0.suggestedUnit) setUnit(m0.suggestedUnit);
        }
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false); setSearched(true);
    }
  };

  // When opened from a "NEW SKU" row, the description is prefilled — kick off the
  // invoice search automatically so the matches/confirm form appear straight away.
  useEffect(() => {
    // Intentional one-shot kickoff on mount; the modal is remounted per-open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (prefill?.query) runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickMatch = (idx: number, chosenPrice?: number) => {
    const m = matches[idx];
    setSelectedIdx(idx);
    setSupplier(m.supplier);
    setPrice(String(chosenPrice ?? m.suggestedPrice));
    if (m.suggestedUnit) setUnit(m.suggestedUnit);
    if (!name) setName(titleCase(query));
  };

  const canSubmit = name.trim().length >= 2 && Number(price) > 0 && !!category && !submitting;

  const submit = async () => {
    setSubmitting(true); setError(null);
    try {
      const res = await fetch('/api/add-ingredient', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          price: Number(price),
          unit: unit.trim() || 'unit',
          supplier: supplier.trim() || 'Other',
          type,
          category,
          sig: prefill?.sig ?? '',
        }),
      });
      const data: AddResponse = await res.json();
      if (!res.ok || !data.ok) { setError(data.error || `HTTP ${res.status}`); }
      else { setDone(data); onSuccess?.(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const inputCls = 'w-full text-sm px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300 transition-all';
  const inputStyle = { background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.1)' } as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
        style={{ border: '1px solid rgba(0,0,0,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
          <div>
            <h2 className="text-base font-bold text-gray-800">Add Supplier Ingredient</h2>
            <p className="text-xs text-gray-500 mt-0.5">Type what you bought — we&rsquo;ll find a price in your recent invoices.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none" aria-label="Close">×</button>
        </div>

        {done ? (
          <div className="p-6 text-center">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-sm font-semibold text-gray-800">Added &ldquo;{done.name}&rdquo;{done.supplier ? ` (${done.supplier})` : ''}.</p>
            <p className="text-xs text-gray-500 mt-1">
              {done.synced ? 'It now appears in Supplier Prices.' : 'It will appear after the next price sync (~30 min).'}
            </p>
            <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-brand-peach)', color: '#333' }}>Done</button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Step 1 — search */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Item</label>
              <div className="flex gap-2 mt-1">
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
                  placeholder="e.g. Bacon"
                  autoFocus
                  className={inputCls}
                  style={inputStyle}
                />
                <button
                  onClick={runSearch}
                  disabled={query.trim().length < 2 || searching}
                  className="shrink-0 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors"
                  style={{ background: 'var(--color-brand-peach)', color: '#333' }}
                >{searching ? 'Searching…' : 'Find price'}</button>
              </div>
            </div>

            {searchError && <p className="text-xs text-red-600">{searchError}</p>}

            {/* Step 2 — matches */}
            {searched && !searchError && (
              matches.length === 0 ? (
                <p className="text-xs text-gray-500 italic">
                  {note
                    ? 'Invoice cache is still being built — try again shortly, or add it manually below.'
                    : <>No invoice match for &ldquo;{query.trim()}&rdquo; in recent invoices. You can still add it manually below.</>}
                </p>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    {matches.length === 1 ? 'Most recent invoice' : 'Most recent invoice — pick a supplier'}
                  </label>
                  {matches.map((m, idx) => (
                    <div
                      key={idx}
                      onClick={() => pickMatch(idx)}
                      title={m.line}
                      className={`rounded-lg px-3 py-2 transition-colors ${matches.length > 1 ? 'cursor-pointer' : ''}`}
                      style={{
                        background: selectedIdx === idx ? 'rgba(251,205,173,0.35)' : 'rgba(0,0,0,0.03)',
                        border: selectedIdx === idx ? '1px solid var(--color-brand-peach)' : '1px solid rgba(0,0,0,0.08)',
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-gray-700 uppercase">{m.supplier}</span>
                        <span className="text-[10px] text-gray-400">{m.date}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 mt-0.5">
                        <span className="text-xs text-gray-600 truncate">{titleCase(query.trim())}</span>
                        <span className="text-sm font-bold shrink-0" style={{ color: 'var(--color-brand-bark-soft)', fontVariantNumeric: 'tabular-nums' }}>
                          ${m.suggestedPrice.toFixed(2)}{m.suggestedUnit ? ` /${m.suggestedUnit}` : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-400 leading-snug">Price auto-detected from the invoice. Adjust it below if the line read wrong.</p>
                </div>
              )
            )}

            {/* Step 3 — confirm fields (shown once searched, even with no matches) */}
            {searched && !searchError && (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Name</label>
                    <input value={name} onChange={e => setName(e.target.value)} className={`${inputCls} mt-1`} style={inputStyle} />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Price ($)</label>
                    <input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" className={`${inputCls} mt-1`} style={inputStyle} />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Unit / pack</label>
                    <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. kg, 5kg box" className={`${inputCls} mt-1`} style={inputStyle} />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Supplier</label>
                    <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. 5Ways" className={`${inputCls} mt-1`} style={inputStyle} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Costings sheet</label>
                    <div className="flex gap-2 mt-1">
                      {(['food', 'coffee'] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => { setType(t); setCategory(''); }}
                          className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold capitalize transition-colors"
                          style={{ background: type === t ? 'var(--color-brand-peach)' : 'rgba(0,0,0,0.05)', color: type === t ? '#333' : 'var(--color-ink-label)' }}
                        >{t}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Category</label>
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value)}
                      className={`${inputCls} mt-1`}
                      style={inputStyle}
                    >
                      <option value="">Choose…</option>
                      {CATEGORIES[type].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>

                {error && <p className="text-xs text-red-600">{error}</p>}

                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="w-full px-4 py-2.5 rounded-lg text-sm font-bold disabled:opacity-40 transition-colors"
                  style={{ background: 'var(--color-brand-peach)', color: '#333' }}
                >{submitting ? 'Adding…' : 'Add to Supplier Prices'}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
