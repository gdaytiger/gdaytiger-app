'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { GoogleReviewsPayload, MenuSyncPayload, PendingReview, PoolSuggestion } from '@/app/lib/gbp';
import { glassTileStyle } from '@/app/lib/theme';

// Google card: new reviews with Claude-drafted replies (Post / Redraft / Skip),
// a photo uploader for the Business Profile, and the Square→Google menu price
// check. Self-contained — fetches /api/google-reviews and /api/google-pool.
// Nothing posts to Google without a tap here.

type Data = { reviews: GoogleReviewsPayload | null; menu: MenuSyncPayload | null } | null;

const label: React.CSSProperties = { fontFamily: '"stolzl", sans-serif', fontWeight: 700, fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-ink-label)' };
const box: React.CSSProperties = { background: 'rgba(255,255,255,0.55)', borderRadius: '16px', padding: '12px 14px' };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: '999px', background: 'var(--color-brand-peach)', color: '#333', fontWeight: 700, fontSize: '13px', border: 'none' };
const ghost: React.CSSProperties = { ...btn, background: 'rgba(0,0,0,0.05)', color: 'var(--color-ink-label)' };

const PHOTO_CATEGORIES: [string, string][] = [
  ['FOOD_AND_DRINK', 'Food & drink'], ['INTERIOR', 'Inside'], ['EXTERIOR', 'Outside'], ['TEAMS', 'Team'], ['AT_WORK', 'At work'], ['ADDITIONAL', 'Other'],
];

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
const ago = (iso: string | null) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};
const money = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);


export default function GoogleReviewsCard({ active, onCount }: { active: boolean; onCount?: (n: number) => void }) {
  const [data, setData] = useState<Data>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);


  // Paul's gallery picker — 5 random photos not yet on Google.
  const [pool, setPool] = useState<PoolSuggestion | null>(null);
  const [poolBusy, setPoolBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [poolCat, setPoolCat] = useState('FOOD_AND_DRINK');

  // Next 5, fetched in the background so Shuffle is instant.
  const [nextPool, setNextPool] = useState<PoolSuggestion | null>(null);

  const fetchPool = useCallback(async (exclude: string[]): Promise<PoolSuggestion> => {
    const r = await fetch('/api/google-pool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'poolSuggest', exclude }) });
    const d = await r.json();
    if (!r.ok || d.ok === false) throw new Error(d.error || 'failed');
    return d as PoolSuggestion;
  }, []);

  const prefetchNext = useCallback((exclude: string[]) => {
    setNextPool(null);
    fetchPool(exclude).then(setNextPool).catch(() => {});
  }, [fetchPool]);

  const loadPool = useCallback(async (exclude: string[] = []) => {
    setPoolBusy('load');
    try {
      const d = await fetchPool(exclude);
      setPool(d);
      setPicked(new Set());
      prefetchNext([...exclude, ...d.photos.map(p => p.id)]);
    } catch (e) {
      setPool({ ok: false, photos: [], remaining: 0, poolSize: 0, lastUploadAt: null, error: e instanceof Error ? e.message : 'error' });
    } finally {
      setPoolBusy(null);
    }
  }, [fetchPool, prefetchNext]);

  function shuffle() {
    const shown = pool?.photos.map(p => p.id) ?? [];
    if (nextPool && nextPool.photos.length) {
      setPool(nextPool);
      setPicked(new Set());
      prefetchNext([...shown, ...nextPool.photos.map(p => p.id)]);
    } else {
      loadPool(shown);
    }
  }

  // Load as soon as TigerOS opens (this card is always mounted), not when the tile opens.
  useEffect(() => {
    if (pool || poolBusy) return;
    const t = setTimeout(() => { loadPool(); }, 0);
    return () => clearTimeout(t);
  }, [pool, poolBusy, loadPool]);

  async function postPicked() {
    const ids = [...picked];
    if (!ids.length) return;
    setPoolBusy('post'); setMsg(null);
    try {
      const categories = Object.fromEntries(ids.map(id => [id, poolCat]));
      const r = await fetch('/api/google-pool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'poolUpload', ids, categories }) });
      const d = await r.json();
      if (!r.ok || d.ok === false) throw new Error(d.error || 'failed');
      setMsg(`${d.posted} photo${d.posted === 1 ? '' : 's'} sent to Google ✓ Usually visible within 48 hours`);
      setPool(null);
    } catch (e) {
      setMsg(`Photos didn’t upload: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setPoolBusy(null);
    }
  }

  async function hidePhoto(id: string) {
    setPool(prev => prev ? { ...prev, photos: prev.photos.filter(p => p.id !== id) } : prev);
    setPicked(prev => { const n = new Set(prev); n.delete(id); return n; });
    fetch('/api/google-pool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'poolHide', ids: [id] }) }).catch(() => {});
  }

  const load = useCallback(() => {
    fetch('/api/google-reviews').then(r => r.json()).then((d: Data) => {
      setData(d);
      onCount?.(d?.reviews?.pending.length ?? 0);
    }).catch(() => {});
  }, [onCount]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (active) load(); }, [active, load]);

  async function act(body: Record<string, unknown>, key: string, done: string) {
    setBusy(key); setMsg(null);
    try {
      const r = await fetch('/api/google-reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || d.ok === false) throw new Error(d.error || 'failed');
      setMsg(done);
      if (body.action === 'redraft' && typeof d.draft === 'string') {
        setDrafts(prev => ({ ...prev, [body.reviewName as string]: d.draft }));
        setNotes(prev => ({ ...prev, [body.reviewName as string]: '' }));
      }
      load();
    } catch (e) {
      setMsg(`Didn’t work: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setBusy(null);
    }
  }



  const reviews = data?.reviews ?? null;
  const menu = data?.menu ?? null;
  const notConnected = data !== null && !reviews;
  const awaitingApproval = !!reviews?.error && /quota is 0|not approved/i.test(reviews.error);

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div style={box} className="flex items-center justify-between gap-3">
        <div>
          <div style={label}>Google rating</div>
          <div className="text-lg font-bold tabular-nums">{reviews?.exact != null ? `${reviews.exact.toFixed(4)} ★` : reviews?.average != null ? `${reviews.average.toFixed(2)} ★` : '—'} <span className="text-sm font-semibold" style={{ color: 'var(--color-ink-muted)' }}>{reviews?.total != null ? `${reviews.total} reviews` : ''}</span></div>
          {reviews?.toNext != null && reviews.nextShown != null && (
            <div className="text-xs font-semibold">{reviews.toNext} × 5★ to show {reviews.nextShown.toFixed(1)}</div>
          )}
          <div className="text-[11px]" style={{ color: 'var(--color-ink-muted)' }}>{reviews?.updated ? `Checked ${ago(reviews.updated)}` : 'Not checked yet'}</div>
        </div>
        <button style={ghost} disabled={busy === 'sync'} onClick={() => act({ action: 'sync' }, 'sync', 'Checked for new reviews ✓')}>{busy === 'sync' ? 'Checking…' : 'Check now'}</button>
      </div>

      {msg && <div className="text-sm font-semibold px-1">{msg}</div>}

      {notConnected && (
        <div style={box} className="text-sm">Not connected yet. This switches on once Google approves the Business Profile API (case 1-6049000042499) and the GBP Apps Script is set up.</div>
      )}
      {reviews?.error && (
        <div style={{ ...box, color: 'var(--color-danger-deep)' }} className="text-sm">
          {awaitingApproval ? 'Waiting on Google to approve API access — reviews will appear here once it does.' : `Last check failed: ${reviews.error}`}
        </div>
      )}

      {/* Pending reviews */}
      <div className="flex flex-col gap-3">
        <div style={label}>New reviews to reply to {reviews?.pending.length ? `(${reviews.pending.length})` : ''}</div>
        {reviews && reviews.pending.length === 0 && !reviews.error && (
          <div style={box} className="text-sm" >All caught up — every new review has a reply.</div>
        )}
        {reviews?.pending.map((r: PendingReview) => {
          const text = drafts[r.name] ?? r.draft;
          const low = r.stars <= 3;
          return (
            <div key={r.name} style={{ ...box, ...(low ? { border: '1.5px solid var(--color-danger)' } : {}) }} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm">{r.reviewer}</span>
                <span className="text-xs tabular-nums" style={{ color: low ? 'var(--color-danger)' : 'var(--color-warning)' }}>{stars(r.stars)} · {ago(r.createTime)}</span>
              </div>
              <div className="text-sm" style={{ color: r.comment ? undefined : 'var(--color-ink-muted)' }}>{r.comment || 'Stars only, no text'}</div>
              {r.offMenu?.length > 0 && (
                <div className="text-[11px] font-semibold px-2 py-1 rounded-lg self-start" style={{ background: 'var(--color-brand-peach-soft)', color: 'var(--color-brand-bark)' }}>
                  Not on the menu: {r.offMenu.join(', ')}
                </div>
              )}
              <textarea
                value={text}
                onChange={e => setDrafts(prev => ({ ...prev, [r.name]: e.target.value }))}
                rows={Math.min(6, Math.max(2, Math.ceil(text.length / 60)))}
                className="w-full text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300"
                style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.1)' }}
                aria-label={`Reply to ${r.reviewer}`}
              />
              <input
                value={notes[r.name] ?? ''}
                onChange={e => setNotes(prev => ({ ...prev, [r.name]: e.target.value }))}
                placeholder="Note for a redraft (optional), e.g. mention the new special"
                className="w-full text-xs rounded-xl px-3 py-2 focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.06)' }}
              />
              <div className="flex gap-2 flex-wrap">
                <button style={btn} disabled={!!busy || !text.trim()} onClick={() => act({ action: 'reply', reviewName: r.name, comment: text }, r.name, `Reply posted to ${r.reviewer} ✓`)}>{busy === r.name ? 'Posting…' : 'Post reply'}</button>
                <button style={ghost} disabled={!!busy} onClick={() => act({ action: 'redraft', reviewName: r.name, note: notes[r.name] || undefined }, `${r.name}:redraft`, 'New draft ✓')}>{busy === `${r.name}:redraft` ? 'Drafting…' : 'Redraft'}</button>
                <button style={ghost} disabled={!!busy} onClick={() => act({ action: 'skip', reviewName: r.name }, `${r.name}:skip`, 'Skipped')}>Skip</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Paul's gallery → Google */}
      <div style={box} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div style={label}>Photos from G’Day Tigers album</div>
          <button style={ghost} disabled={!!poolBusy} onClick={shuffle}>{poolBusy === 'load' ? 'Loading…' : 'Shuffle'}</button>
        </div>
        {pool && pool.ok !== false && (
          <div className="text-[11px]" style={{ color: 'var(--color-ink-muted)' }}>
            {pool.lastUploadAt ? `Last photo on Google ${ago(pool.lastUploadAt)}` : 'No photos on Google yet'} · {pool.remaining} not yet posted
          </div>
        )}
        {pool?.error && <div className="text-sm" style={{ color: 'var(--color-danger-deep)' }}>Couldn’t load photos: {pool.error}</div>}
        {!pool && poolBusy === 'load' && <div className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>Picking 5 photos…</div>}
        {pool && pool.ok !== false && pool.photos.length === 0 && <div className="text-sm">Every photo in the pool is already on Google. New ones arrive when Paul adds a set.</div>}
        {pool && pool.photos.length > 0 && (
          <div className="grid grid-cols-5 gap-3">
            {pool.photos.map(ph => {
              const on = picked.has(ph.id);
              return (
                <div key={ph.id} className="relative">
                  <button
                    onClick={() => setPicked(prev => { const n = new Set(prev); if (n.has(ph.id)) n.delete(ph.id); else n.add(ph.id); return n; })}
                    className="block w-full aspect-square rounded-3xl overflow-hidden transition-all"
                    style={{ ...glassTileStyle, padding: 0, ...(on ? { border: '1.5px solid var(--color-brand-peach)', boxShadow: 'var(--glass-shadow), var(--glass-ring)' } : {}) }}
                    aria-pressed={on}
                    aria-label={`${on ? 'Unselect' : 'Select'} ${ph.name}`}
                  >
                    {ph.thumb
                      // eslint-disable-next-line @next/next/no-img-element -- data-URI thumbnail from Apps Script
                      ? <img src={ph.thumb} alt={ph.name} className="w-full h-full object-cover" />
                      : <span className="text-[10px] p-1 block">{ph.name}</span>}
                  </button>
                  {on && <span className="absolute top-1.5 left-1.5 text-[11px] font-bold rounded-full px-1.5" style={{ background: 'var(--color-brand-peach)', color: '#333' }}>✓</span>}
                  <button onClick={() => hidePhoto(ph.id)} className="absolute top-1.5 right-1.5 text-[11px] font-bold rounded-full w-5 h-5 leading-5 text-center" style={{ background: 'rgba(255,255,255,0.85)', color: 'var(--color-ink-label)' }} aria-label={`Never show ${ph.name}`}>×</button>
                </div>
              );
            })}
          </div>
        )}
        {pool && pool.photos.length > 0 && (
          <>
            <div className="flex gap-2 flex-wrap">
              {PHOTO_CATEGORIES.map(([k, v]) => (
                <button key={k} onClick={() => setPoolCat(k)} className="text-xs font-semibold px-3 py-1.5 rounded-full" style={poolCat === k ? { background: 'var(--color-brand-peach)', color: '#333' } : { background: 'rgba(0,0,0,0.05)', color: 'var(--color-ink-label)' }}>{v}</button>
              ))}
            </div>
            <div className="text-[11px]" style={{ color: 'var(--color-ink-muted)' }}>Tap photos to pick them · × hides one for good</div>
            <button style={btn} disabled={!picked.size || !!poolBusy} onClick={postPicked} className="self-start">
              {poolBusy === 'post' ? 'Posting…' : picked.size ? `Post ${picked.size} to Google` : 'Pick photos to post'}
            </button>
          </>
        )}
      </div>

      {/* Menu price sync */}
      <div style={box} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div style={label}>Google menu prices vs Square</div>
          <button style={ghost} disabled={!!busy} onClick={() => act({ action: 'menuSync', apply: false }, 'menu', 'Menu checked ✓')}>{busy === 'menu' ? 'Checking…' : 'Check'}</button>
        </div>
        {!menu && <div className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>No check run yet.</div>}
        {menu && (
          <>
            <div className="text-[11px]" style={{ color: 'var(--color-ink-muted)' }}>
              {menu.mode === 'live' ? 'Live — prices update automatically' : 'Preview — showing what would change, nothing sent'} · {ago(menu.updated)}
            </div>
            {menu.error && <div className="text-sm" style={{ color: 'var(--color-danger-deep)' }}>{menu.error}</div>}
            {!menu.error && menu.changes.length === 0 && <div className="text-sm">All Google menu prices match Square ✓</div>}
            {menu.changes.map(c => (
              <div key={c.item} className="flex justify-between text-sm tabular-nums">
                <span>{c.item}</span><span>{money(c.from)} → <b>{money(c.to)}</b></span>
              </div>
            ))}
            {menu.unmatched.length > 0 && (
              <div className="text-[11px]" style={{ color: 'var(--color-warning)' }}>Not matched to Square ({menu.unmatched.length}): {menu.unmatched.join(', ')}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
