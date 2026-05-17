'use client';

import { useEffect, useMemo, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Ingredient catalogues — which keys belong to which sheet, plus smart-default
// quantities (most common amount used across existing recipes). Hardcoded for
// v1; future enhancement: compute these from recipe_map at build time.
// ─────────────────────────────────────────────────────────────────────────────
const FOOD_KEYS = [
  'sourdough','ciabatta','potato_bun','croissant',
  'ham','beef_pastrami','salami','tuna','chicken',
  'mozzarella','swiss_cheese','taleggio','american_cheese','parmesan_grated','parmesan_block',
  'tomato','sauerkraut','pickles','mushrooms_raw','red_onion','fennel','red_chilli','jalapeno',
  'parsley','dill','bananas','eggplant','lemon','carrot','cucumber','leni_peppers',
  'dijon_mustard','mayo','ketchup',
  'tuna_mix','caponata','mushroom_mix','schnittas','basil_pesto','tiger_sauce','honey_mustard_mayo',
  'butter','olive_oil','salt','pepper','eggs',
  'napkins','tray',
  'plain_flour','sr_flour','caster_sugar','brown_sugar','bicarb_soda','cinnamon','vegetable_oil','breadcrumbs','honey','pinenuts',
];

const COFFEE_KEYS = [
  'coffee_beans','chocolate','chai','fbomb','decaf_beans','matcha',
  'sungold_jersey_fc','sungold_lowfat','happy_soy','alt_dairy_oat','alt_dairy_almond',
  'bundaberg_raw_sugar',
  'cup_small_6oz','cup_large_12oz','lid_hot','cup_detpak_16oz','lid_sipper','straw',
];

// Smart-default quantities: { key: { small?, large?, hot?, iced?, default } }
// Picked by inspection of existing recipes. Form uses `default` unless the
// user has indicated a context (size/temperature) and a matching key exists.
const DEFAULT_QTY: Record<string, { default: number; large?: number; iced?: number }> = {
  // ── Food (per single sandwich/serve) ─────────────────────────────────────
  sourdough: { default: 2 },
  ciabatta: { default: 1 },
  potato_bun: { default: 1 },
  croissant: { default: 1 },
  ham: { default: 0.05 },
  beef_pastrami: { default: 0.06 },
  salami: { default: 0.04 },
  tuna: { default: 0.5 },
  chicken: { default: 0.15 },
  mozzarella: { default: 0.04 },
  swiss_cheese: { default: 1 },
  taleggio: { default: 0.02 },
  american_cheese: { default: 0.03 },
  parmesan_grated: { default: 0.005 },
  parmesan_block: { default: 0.005 },
  tomato: { default: 0.03 },
  pickles: { default: 2 },
  mushrooms_raw: { default: 0.04 },
  red_onion: { default: 0.02 },
  fennel: { default: 0.05 },
  red_chilli: { default: 0.005 },
  jalapeno: { default: 0.005 },
  parsley: { default: 0.1 },
  eggplant: { default: 0.1 },
  lemon: { default: 0.01 },
  leni_peppers: { default: 0.05 },
  dijon_mustard: { default: 0.005 },
  mayo: { default: 0.015 },
  ketchup: { default: 0.01 },
  tuna_mix: { default: 0.08 },
  caponata: { default: 0.1 },
  mushroom_mix: { default: 0.06 },
  schnittas: { default: 1 },
  basil_pesto: { default: 0.02 },
  tiger_sauce: { default: 0.02 },
  honey_mustard_mayo: { default: 0.02 },
  butter: { default: 0.01 },
  olive_oil: { default: 0.005 },
  salt: { default: 0.001 },
  pepper: { default: 0.001 },
  eggs: { default: 2 },
  napkins: { default: 1 },
  tray: { default: 1 },
  honey: { default: 0.005 },
  pinenuts: { default: 0.005 },
  // ── Coffee (per cup, small/hot is default) ───────────────────────────────
  coffee_beans: { default: 23, large: 46 },
  chocolate: { default: 30, large: 60 },
  chai: { default: 25, large: 50 },
  fbomb: { default: 23, large: 46 },
  decaf_beans: { default: 23, large: 46 },
  matcha: { default: 5 },
  sungold_jersey_fc: { default: 150, large: 300, iced: 300 },
  sungold_lowfat: { default: 150, large: 300, iced: 300 },
  happy_soy: { default: 150, large: 300, iced: 300 },
  alt_dairy_oat: { default: 150, large: 300, iced: 300 },
  alt_dairy_almond: { default: 150, large: 300, iced: 300 },
  bundaberg_raw_sugar: { default: 0.5 },
  cup_small_6oz: { default: 1 },
  cup_large_12oz: { default: 1 },
  lid_hot: { default: 1 },
  cup_detpak_16oz: { default: 1 },
  lid_sipper: { default: 1 },
  straw: { default: 1 },
};

const MILK_KEYS = ['sungold_jersey_fc', 'sungold_lowfat', 'happy_soy', 'alt_dairy_oat', 'alt_dairy_almond'];

type Ingredient = { key: string; name: string; price: number; unit: string; supplier: string };
type RowState = { id: number; key: string; qty: string };
type VariantsState = { milks: string[]; sizes: ('small' | 'large')[]; channels: ('dine_in' | 'takeaway')[] };

export default function AddProductModal({
  open,
  onClose,
  category,
  ingredients,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  category: 'food' | 'coffee';
  ingredients: Ingredient[];
  onSuccess?: () => void;
}) {
  const [name, setName] = useState('');
  const [retailPrice, setRetailPrice] = useState('');
  const [rows, setRows] = useState<RowState[]>([{ id: 1, key: '', qty: '' }]);
  const [variants, setVariants] = useState<VariantsState>({ milks: [], sizes: ['small'], channels: ['dine_in'] });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sectionsWritten?: { name: string }[] } | null>(null);

  // Reset when (re)opening
  useEffect(() => {
    if (open) {
      setName('');
      setRetailPrice('');
      setRows([{ id: 1, key: '', qty: '' }]);
      setVariants({ milks: [], sizes: ['small'], channels: ['dine_in'] });
      setSubmitting(false);
      setError(null);
      setResult(null);
    }
  }, [open]);

  const allowedKeys = category === 'food' ? FOOD_KEYS : COFFEE_KEYS;
  const availableIngredients = useMemo(
    () => ingredients
      .filter(i => allowedKeys.includes(i.key))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [ingredients, allowedKeys]
  );

  const updateRow = (id: number, patch: Partial<RowState>) => {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows(rs => [...rs, { id: Date.now(), key: '', qty: '' }]);
  const removeRow = (id: number) => setRows(rs => rs.filter(r => r.id !== id));
  const onPickIngredient = (id: number, key: string) => {
    const def = DEFAULT_QTY[key];
    updateRow(id, { key, qty: def ? String(def.default) : '' });
  };

  const toggleArrayItem = <T extends string,>(arr: T[], item: T): T[] =>
    arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];

  const variantCount = useMemo(() => {
    if (category !== 'coffee') return 1;
    const milkCount = variants.milks.length || 1;
    return milkCount * variants.sizes.length * variants.channels.length;
  }, [category, variants]);

  const canSubmit = name.trim().length >= 3
    && Number(retailPrice) > 0
    && rows.some(r => r.key && Number(r.qty) > 0)
    && (category !== 'coffee' || (variants.sizes.length > 0 && variants.channels.length > 0));

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    const cleanIngredients = rows
      .filter(r => r.key && Number(r.qty) > 0)
      .map(r => ({ key: r.key, qty: Number(r.qty) }));
    const body: Record<string, unknown> = {
      type: category,
      name: name.trim(),
      retailPrice: Number(retailPrice),
      ingredients: cleanIngredients,
    };
    if (category === 'coffee') {
      body.variants = variants;
    }
    try {
      const res = await fetch('/api/add-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || `HTTP ${res.status}`);
      } else {
        setResult(data);
        onSuccess?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
        style={{ border: '1px solid rgba(0,0,0,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
          <div>
            <h2 className="text-base font-bold text-gray-800">
              Add {category === 'coffee' ? 'Coffee' : 'Food'} Product
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Writes a new recipe section to the sheet and creates the matching Notion row.
              {category === 'coffee' && variantCount > 1 && ` (${variantCount} variants will be generated)`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none" aria-label="Close">×</button>
        </div>

        {result ? (
          <div className="p-5">
            <div className="rounded-xl p-4" style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)' }}>
              <p className="text-sm font-semibold text-green-800">✓ Product created</p>
              <p className="text-xs text-gray-600 mt-2">{result.sectionsWritten?.length ?? 0} section(s) written to the sheet:</p>
              <ul className="text-xs text-gray-700 mt-1 list-disc pl-5">
                {(result.sectionsWritten || []).map(s => <li key={s.name}>{s.name}</li>)}
              </ul>
              <p className="text-xs text-gray-500 mt-3">Recipe map and TIGEROS will refresh automatically.</p>
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium">Done</button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Name */}
            <div>
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Product name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={category === 'coffee' ? 'e.g. MATCHA LATTE' : 'e.g. CAESAR SANDWICH'}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>

            {/* Retail price */}
            <div>
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Retail price ($)</label>
              <input
                type="number"
                step="0.01"
                value={retailPrice}
                onChange={e => setRetailPrice(e.target.value)}
                placeholder={category === 'coffee' ? '6.50' : '14.50'}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>

            {/* Coffee variant controls */}
            {category === 'coffee' && (
              <div className="rounded-xl p-3" style={{ background: 'rgba(0,0,0,0.03)' }}>
                <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                  Generate variants ({variantCount})
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-gray-500 mr-2">Milks:</span>
                    {MILK_KEYS.map(m => {
                      const ing = ingredients.find(i => i.key === m);
                      if (!ing) return null;
                      const checked = variants.milks.includes(m);
                      return (
                        <label key={m} className="inline-flex items-center mr-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setVariants(v => ({ ...v, milks: toggleArrayItem(v.milks, m) }))}
                            className="mr-1"
                          />
                          {ing.name.replace(/\s*\([^)]*\)\s*$/, '')}
                        </label>
                      );
                    })}
                    <p className="text-gray-400 mt-1">Leave unchecked for a milk-less product (e.g. BLACK COFFEE).</p>
                  </div>
                  <div>
                    <span className="text-gray-500 mr-2">Sizes:</span>
                    {(['small','large'] as const).map(s => (
                      <label key={s} className="inline-flex items-center mr-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={variants.sizes.includes(s)}
                          onChange={() => setVariants(v => ({ ...v, sizes: toggleArrayItem(v.sizes, s) }))}
                          className="mr-1"
                        />
                        {s === 'small' ? 'Small (default)' : 'Large'}
                      </label>
                    ))}
                  </div>
                  <div>
                    <span className="text-gray-500 mr-2">Channels:</span>
                    {(['dine_in','takeaway'] as const).map(c => (
                      <label key={c} className="inline-flex items-center mr-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={variants.channels.includes(c)}
                          onChange={() => setVariants(v => ({ ...v, channels: toggleArrayItem(v.channels, c) }))}
                          className="mr-1"
                        />
                        {c === 'dine_in' ? 'Dine In' : 'Takeaway (+ cup/lid)'}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Ingredients */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  {category === 'coffee' ? 'Base recipe (small dine-in)' : 'Ingredients'}
                </label>
                <span className="text-xs text-gray-400">Quantity is per single serve</span>
              </div>
              <div className="space-y-2">
                {rows.map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <select
                      value={r.key}
                      onChange={e => onPickIngredient(r.id, e.target.value)}
                      className="flex-1 min-w-0 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                    >
                      <option value="">— select ingredient —</option>
                      {availableIngredients.map(i => (
                        <option key={i.key} value={i.key}>{i.name}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="any"
                      value={r.qty}
                      onChange={e => updateRow(r.id, { qty: e.target.value })}
                      placeholder="qty"
                      className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                    />
                    <button
                      onClick={() => removeRow(r.id)}
                      disabled={rows.length === 1}
                      className="text-gray-400 hover:text-red-600 disabled:opacity-30 text-lg px-1"
                      aria-label="Remove ingredient"
                    >×</button>
                  </div>
                ))}
              </div>
              <button
                onClick={addRow}
                className="mt-2 text-xs text-gray-600 hover:text-gray-900 font-medium"
              >+ Add ingredient</button>
            </div>

            {error && (
              <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(220,38,38,0.08)', color: '#991b1b', border: '1px solid rgba(220,38,38,0.25)' }}>
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit || submitting}
                className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-40"
              >
                {submitting ? 'Creating…' : `Create${category === 'coffee' && variantCount > 1 ? ` ${variantCount} variants` : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
