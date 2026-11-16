'use client';

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';

// Presentational body for the dashboard "Roster Check" card. Fed by
// /api/roster-check. Answers one question before a roster is published:
// "is this week rostered heavier than last year's trade justifies?"
//   Hero    — projected labour % for the 7 days (rostered hrs × rate ÷ LY net sales)
//   Flags   — open + unpublished shifts
//   Days    — rostered vs last-year hours, people on at 10am and 1pm, projected %
// The ‹ › buttons step the window a week at a time (e.g. to check New Year week early).

type Side = { hours: number; cost: number; shifts: number; atPeak: number; atAfter: number };
export type RosterCheckDay = {
  date: string; weekday: string;
  rostered: Side & { open: number; unpublished: number };
  lastYear: Side & { date: string; sales: number | null; pct: number | null };
  rosterPending: boolean;
  projectedPct: number | null;
  verdict: 'below' | 'in' | 'above' | null;
};
export type RosterCheckData = {
  range: { start: string; end: string; lyStart: string; lyEnd: string };
  rate: number; zone: [number, number];
  totals: {
    hours: number; cost: number; lyHours: number; lySales: number;
    projectedPct: number | null; lyPct: number | null; verdict: RosterCheckDay['verdict'];
    hoursVsLy: number; comparableDays: number; pendingDays: number; noSalesDays: number;
    open: number; unpublished: number;
  };
  days: RosterCheckDay[];
  error?: string;
} | null;

const money = (n: number | null | undefined) => (n == null ? '—' : '$' + Math.round(n).toLocaleString());
const pctColor = (v: RosterCheckDay['verdict']) =>
  v === 'above' ? 'var(--color-danger)' : v === 'in' ? 'var(--color-warning)' : v === 'below' ? 'var(--color-success)' : 'var(--color-ink-muted)';
const shortDate = (s: string) => {
  const [, m, d] = s.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
};
const addDays = (s: string, n: number) => {
  const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const PANEL: React.CSSProperties = { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' };

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-widest mb-2"
      style={{ fontFamily: '"stolzl", sans-serif', color: 'var(--color-ink-muted)' }}>{children}</div>
  );
}

function Delta({ now, then }: { now: number; then: number }) {
  const d = Math.round((now - then) * 10) / 10;
  if (!then || Math.abs(d) < 0.5) return null;
  return (
    <span className="text-[10px] tabular-nums" style={{ color: d > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
      {d > 0 ? '+' : '−'}{Math.abs(d)}
    </span>
  );
}

export default function RosterCheckCard({ data: initial }: { data: RosterCheckData }) {
  const [offset, setOffset] = useState(0); // weeks from the default window
  const [stepped, setStepped] = useState<RosterCheckData>(null);
  const [busy, setBusy] = useState(false);
  const baseStart = initial?.range.start;

  const step = (dir: 1 | -1) => {
    if (!baseStart || busy) return;
    const next = offset + dir;
    setOffset(next);
    if (!next) return; // back to the default window — use the prop
    setBusy(true);
    fetch(`/api/roster-check?start=${addDays(baseStart, next * 7)}`)
      .then((r) => r.json())
      .then((d) => setStepped(d))
      .catch(() => setStepped(null))
      .finally(() => setBusy(false));
  };

  const data = offset ? stepped : initial;
  if (!initial) return <div className="text-xs text-gray-400 py-6 text-center">Loading…</div>;
  if (initial.error) return <div className="text-xs text-gray-400 py-6 text-center">Couldn’t reach Deputy — try again shortly.</div>;

  const nav = (
    <div className="flex items-center justify-between mb-3">
      <button aria-label="Previous week" onClick={() => step(-1)} disabled={busy}
        className="p-1 rounded-full" style={{ color: 'var(--color-ink-label)' }}><ChevronLeft size={16} /></button>
      <div className="text-xs font-semibold tabular-nums" style={{ color: 'var(--color-ink-label)' }}>
        {data ? `${data.days[0]?.weekday} ${shortDate(data.range.start)} – ${data.days[data.days.length - 1]?.weekday} ${shortDate(data.range.end)}` : '…'}
        {busy && <span className="ml-2" style={{ color: 'var(--color-ink-muted)' }}>loading</span>}
      </div>
      <button aria-label="Next week" onClick={() => step(1)} disabled={busy}
        className="p-1 rounded-full" style={{ color: 'var(--color-ink-label)' }}><ChevronRight size={16} /></button>
    </div>
  );

  if (!data || data.error) return <div>{nav}<div className="text-xs text-gray-400 py-6 text-center">{busy ? 'Loading…' : 'No data for this week.'}</div></div>;

  const t = data.totals;
  const [lo, hi] = data.zone;
  const heroCol = pctColor(t.verdict);
  const allPending = t.pendingDays === data.days.length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        {nav}
        {/* ── HERO: projected labour % for the window ── */}
        <SectionLabel>Projected labour % · vs last year’s trade</SectionLabel>
        {allPending ? (
          <div className="rounded-2xl px-4 py-3 text-xs text-gray-400" style={PANEL}>Nothing rostered in Deputy for these days yet.</div>
        ) : t.projectedPct == null ? (
          <div className="rounded-2xl px-4 py-3 text-xs text-gray-400" style={PANEL}>
            {Math.round(t.hours)} hrs rostered · no last-year sales on file for these dates.
          </div>
        ) : (
          <div className="rounded-2xl px-4 py-3" style={PANEL}>
            <div className="flex items-baseline gap-2">
              <span className="font-bold tabular-nums leading-none" style={{ fontSize: '40px', color: heroCol }}>
                {Math.round(t.projectedPct)}<span style={{ fontSize: '20px' }}>%</span>
              </span>
              {t.lyPct != null && (
                <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--color-ink-label)' }}>
                  last year {Math.round(t.lyPct)}%
                </span>
              )}
            </div>
            <div className="text-[11px] text-gray-500 mt-1.5 tabular-nums">
              {Math.round(t.hours)} hrs rostered ({t.hoursVsLy >= 0 ? '+' : '−'}{Math.abs(Math.round(t.hoursVsLy))} vs LY) · {money(t.cost)} · LY sales {money(t.lySales)}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: heroCol }}>
              Zone {lo}–{hi}% {t.verdict === 'above' ? `· ${Math.round(t.projectedPct - hi)} pts over — trim before publishing` : t.verdict === 'in' ? '· at the top of the zone' : '· under the zone'}
            </div>
            {(t.pendingDays > 0 || t.noSalesDays > 0) && (
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-ink-muted)' }}>
                Based on {t.comparableDays} of {data.days.length} days
                {t.pendingDays > 0 ? ` · ${t.pendingDays} not rostered yet` : ''}
                {t.noSalesDays > 0 ? ` · ${t.noSalesDays} without LY sales` : ''}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── FLAGS: open / unpublished shifts ── */}
      {(t.open > 0 || t.unpublished > 0) && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs" style={PANEL}>
          <TriangleAlert size={14} aria-hidden style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
          <span style={{ color: 'var(--color-ink-label)' }}>
            {t.open > 0 && `${t.open} open shift${t.open > 1 ? 's' : ''} to fill`}
            {t.open > 0 && t.unpublished > 0 && ' · '}
            {t.unpublished > 0 && `${t.unpublished} unpublished`}
          </span>
        </div>
      )}

      {/* ── DAYS: rostered vs last year ── */}
      <div>
        <SectionLabel>By day · hrs and people on, vs last year</SectionLabel>
        <div className="grid text-[10px] mb-1 px-1" style={{ gridTemplateColumns: '52px 1fr 1fr 1fr 40px', color: 'var(--color-ink-muted)' }}>
          <span /> <span>Hours</span> <span>10am</span> <span>1pm</span> <span className="text-right">Proj</span>
        </div>
        <div className="flex flex-col gap-1">
          {data.days.map((d) => (
            <div key={d.date} className="grid items-center rounded-lg px-1 py-1 text-xs tabular-nums"
              style={{ gridTemplateColumns: '52px 1fr 1fr 1fr 40px' }}
              title={`LY ${d.lastYear.date}: ${d.lastYear.hours} hrs, ${money(d.lastYear.sales)} net sales${d.lastYear.pct != null ? `, ${Math.round(d.lastYear.pct)}% labour` : ''}`}>
              <span className="text-[10px]" style={{ color: 'var(--color-ink-muted)' }}>{d.weekday} {d.date.slice(8)}</span>
              {d.rosterPending ? (
                <span className="col-span-3 text-[10px]" style={{ color: 'var(--color-ink-muted)' }}>not rostered · LY {d.lastYear.hours} hrs</span>
              ) : (
                <>
                  <span style={{ color: 'var(--color-ink-label)' }}>
                    {d.rostered.hours} <span style={{ color: 'var(--color-ink-muted)' }}>/ {d.lastYear.hours}</span>{' '}
                    <Delta now={d.rostered.hours} then={d.lastYear.hours} />
                  </span>
                  <span style={{ color: 'var(--color-ink-label)' }}>
                    {d.rostered.atPeak} <span style={{ color: 'var(--color-ink-muted)' }}>/ {d.lastYear.atPeak}</span>
                  </span>
                  <span style={{ color: 'var(--color-ink-label)' }}>
                    {d.rostered.atAfter} <span style={{ color: 'var(--color-ink-muted)' }}>/ {d.lastYear.atAfter}</span>
                  </span>
                </>
              )}
              <span className="text-right font-bold" style={{ color: pctColor(d.verdict) }}>
                {d.projectedPct != null ? `${Math.round(d.projectedPct)}%` : '—'}
              </span>
            </div>
          ))}
        </div>
        <div className="text-[10px] mt-2" style={{ color: 'var(--color-ink-muted)' }}>
          This year / last year (same weekday, 52 weeks back). Staff only, Jono excluded. Cost = hrs × ${data.rate} incl super ÷ LY net sales ex-GST.
        </div>
      </div>
    </div>
  );
}
