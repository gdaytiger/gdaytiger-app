'use client';

import React from 'react';
import { Circle } from 'lucide-react';

// Presentational body for the dashboard "Weekly Flash" card.
// Fed by /api/weekly-flash (sales, labour, margin) + /api/flash-extras
// (category mix + day-part). The Monday-morning operational scorecard for the
// last completed week vs the week before, against benchmark zones (labour: ATO coffee-shop basis, see route).

type WeekMetrics = {
  start: string; end: string;
  net: number; orders: number; avgSale: number | null;
  labourCost: number | null; labourPct: number | null;
  totalLabourCost?: number | null; totalLabourPct?: number | null;
  best: { weekday: string; date: string; net: number } | null;
  worst: { weekday: string; date: string; net: number } | null;
} | null;

export type WeeklyFlashData = {
  ready: boolean;
  week: WeekMetrics;
  prevWeek: WeekMetrics;
  salesWoW: number | null;
  grossMargin: { pct: number; month?: string; source: string };
  zones: { grossMargin: [number, number]; labour: [number, number] };
  scorecard: {
    grossMargin: { value: number; verdict: string | null };
    labour: { value: number | null; verdict: string | null };
    salesTrend: { value: number | null; verdict: string | null };
  };
  labourTotal?: { value: number | null };
  // CD = cash difference (counted cash − Square cash). + over, − short.
  cashDiff?: { week: number | null; weekDays: number; ytd: number | null; ytdDays: number; year: string; firstWeek: string | null };
  meta: { labourBasis: string; pending: string; labourUpdated?: string | null };
} | null;

export type FlashExtrasData = {
  ready: boolean;
  weekStart: string | null; weekEnd: string | null;
  mix: { category: string; net: number; pct: number }[];
  dayPart: { hour: number; net: number; pct: number }[];
} | null;

const GREEN = '#15803d';
const AMBER = '#b45309';
const RED = '#b91c1c';

const money = (n: number | null | undefined) => n == null ? '—' : '$' + Math.round(n).toLocaleString();
const money2 = (n: number | null | undefined) => n == null ? '—' : '$' + n.toFixed(2);
const signedMoney = (n: number | null | undefined) => n == null ? '—' : `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CD_TOLERANCE = 20; // $ either way for the week before it's flagged
// ISO yyyy-mm-dd → dd/mm/yyyy (AU).
const auDate = (iso: string) => { const [y, m, d] = iso.split('-'); return d && m && y ? `${d}/${m}/${y}` : iso; };
const hourLabel = (h: number) => {
  const ap = h < 12 ? 'am' : 'pm';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ap}`;
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-widest mb-2"
      style={{ fontFamily: '"stolzl", sans-serif', color: 'var(--color-ink-muted)' }}>{children}</div>
  );
}

function ScoreRow({ label, value, zone, color, dot }:
  { label: string; value: string; zone: string; color: string; dot: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl px-3 py-2"
      style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' }}>
      <div className="flex items-center gap-2">
        <Circle size={10} strokeWidth={2.5} aria-hidden fill={dot || 'none'} style={{ display: 'block', flexShrink: 0, color: dot || 'var(--color-ink-muted)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--color-ink-label)' }}>{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold tabular-nums" style={{ color }}>{value}</span>
        <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>{zone}</span>
      </div>
    </div>
  );
}

// Category mix — top rows as horizontal bars, tail rolled into "Other".
function MixSection({ extras }: { extras: FlashExtrasData }) {
  if (!extras?.ready || !extras.mix.length) return null;
  const top = extras.mix.slice(0, 6);
  const otherPct = extras.mix.slice(6).reduce((s, r) => s + r.pct, 0);
  const rows = [...top.map((r) => ({ label: r.category, pct: r.pct }))];
  if (otherPct >= 0.5) rows.push({ label: 'Other', pct: Math.round(otherPct) });
  return (
    <div>
      <SectionLabel>Sales mix · by category</SectionLabel>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <div className="w-28 text-xs truncate" style={{ color: 'var(--color-ink-label)' }}>{r.label}</div>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
              <div className="h-2 rounded-full" style={{ width: `${Math.min(100, r.pct)}%`, background: 'var(--color-brand-peach)' }} />
            </div>
            <div className="w-9 text-right text-xs tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>{r.pct.toFixed(0)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Day-part — net sales by clock hour as mini vertical bars, peak highlighted.
// Tile matches the 62px Daily To Do tiles. Peak bar uses the pinned-task recipe
// (peach outline, faint peach fill). Hover (or tap on mobile) any hour for its $ / %.
const TILE_H = 62;
const BAR_MAX = 30;
const PINNED_STYLE: React.CSSProperties = {
  background: 'rgba(251,205,173,0.12)',
  border: '1px solid var(--color-brand-peach)',
  boxShadow: 'var(--glass-shadow)',
};

function DayPartSection({ extras }: { extras: FlashExtrasData }) {
  const [active, setActive] = React.useState<number | null>(null);
  if (!extras?.ready || !extras.dayPart.length) return null;
  // Close at 3pm — drop the 3pm+ stragglers (end-of-day orders) from the chart.
  const CLOSE_HOUR = 15;
  const hours = extras.dayPart.filter((d) => d.hour < CLOSE_HOUR);
  if (!hours.length) return null;
  const maxNet = Math.max(...hours.map((d) => d.net));
  const peak = hours.reduce((a, b) => (b.net > a.net ? b : a), hours[0]);
  return (
    <div>
      <SectionLabel>Day shape · net by hour</SectionLabel>
      <div className="rounded-2xl px-3 flex items-end" onMouseLeave={() => setActive(null)}
        style={{ height: `${TILE_H}px`, paddingTop: '8px', paddingBottom: '6px', background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' }}>
        <div className="flex items-end gap-1 w-full h-full">
          {hours.map((h, i) => {
            const isPeak = h.hour === peak.hour;
            const isActive = active === h.hour;
            const hpx = Math.max(3, maxNet > 0 ? (h.net / maxNet) * BAR_MAX : 0);
            const align = i < 2 ? { left: 0 } : i > hours.length - 3 ? { right: 0 } : { left: '50%', transform: 'translateX(-50%)' };
            return (
              <div key={h.hour} className="relative flex-1 h-full flex flex-col items-center justify-end gap-0.5 cursor-pointer"
                onMouseEnter={() => setActive(h.hour)}
                onClick={() => setActive(isActive ? null : h.hour)}>
                {isActive && (
                  <div className="absolute z-20 pointer-events-none whitespace-nowrap rounded-lg px-2 py-1 text-[10px] font-semibold tabular-nums"
                    style={{ bottom: 'calc(100% + 4px)', ...align, background: 'rgba(255,255,255,0.95)', border: '1px solid var(--color-brand-peach)', boxShadow: 'var(--glass-shadow)', color: 'var(--color-ink-label)' }}>
                    {hourLabel(h.hour)} · {money(h.net)} ({h.pct.toFixed(0)}% of the week)
                  </div>
                )}
                <div className="w-full rounded-t"
                  style={{ height: `${hpx}px`, boxSizing: 'border-box', ...(isPeak ? PINNED_STYLE : { background: isActive ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.12)' }) }} />
                <div className="text-[9px] leading-none tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>{hourLabel(h.hour)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function WeeklyFlashCard({ data, extras }: { data: WeeklyFlashData; extras: FlashExtrasData }) {
  if (!data) return <div className="text-xs py-6 text-center uppercase" style={{ color: 'var(--color-ink-muted)' }}>Loading…</div>;
  if (!data.ready || !data.week) {
    return <div className="text-xs py-6 text-center uppercase" style={{ color: 'var(--color-ink-muted)' }}>
      Last week&apos;s data is still landing — check back after the overnight sync.
    </div>;
  }

  const { week, salesWoW, grossMargin, zones, scorecard, meta } = data;
  const wow = salesWoW;
  const wowCol = wow == null ? 'var(--color-ink-muted)' : (wow >= 0 ? GREEN : RED);
  const wowArrow = wow == null ? '' : (wow >= 0 ? '▲' : '▼');

  const gmCol = scorecard.grossMargin.verdict === 'below' ? RED : GREEN;
  const labVerdict = scorecard.labour.verdict;
  const labCol = labVerdict === 'in' ? GREEN : labVerdict === 'above' ? RED : labVerdict === 'watch' ? AMBER : 'var(--color-ink-muted)';
  // Filled dot in the status colour; '' renders a hollow neutral ring.
  const dot = (col: string) => (col === GREEN || col === RED || col === AMBER) ? col : '';
  const gmMonth = grossMargin.month ? ` (${grossMargin.month})` : '';

  return (
    <div className="flex flex-col gap-5 uppercase">
      {/* HERO */}
      <div>
        <div className="rounded-2xl px-4 flex items-center justify-between gap-3"
          style={{ minHeight: '62px', background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' }}>
          <div className="flex flex-col gap-1 py-2">
            <div className="flex items-baseline gap-2">
              <span className="font-bold tabular-nums leading-none" style={{ fontSize: '28px', color: 'var(--color-ink-label)' }}>{money(week.net)}</span>
              {wow != null && <span className="text-xs font-bold tabular-nums" style={{ color: wowCol }}>{wowArrow} {Math.abs(wow).toFixed(1)}%</span>}
            </div>
            <div className="text-[10px] font-bold tracking-widest leading-none tabular-nums"
              style={{ fontFamily: '"stolzl", sans-serif', color: 'var(--color-ink-muted)' }}>Net sales · week ending {auDate(week.end)}</div>
          </div>
          <div className="flex flex-col items-end text-[10px] leading-snug tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>
            <span><span className="font-semibold" style={{ color: 'var(--color-ink-label)' }}>{week.orders.toLocaleString()}</span> orders</span>
            <span><span className="font-semibold" style={{ color: 'var(--color-ink-label)' }}>{money2(week.avgSale)}</span> avg sale</span>
          </div>
        </div>
      </div>

      <MixSection extras={extras} />
      <DayPartSection extras={extras} />

      {/* SCORECARD */}
      <div>
        <SectionLabel>Benchmark scorecard</SectionLabel>
        <div className="flex flex-col gap-2">
          <ScoreRow label={`Gross margin${gmMonth}`} value={`${grossMargin.pct}%`}
            zone={`${zones.grossMargin[0]}–${zones.grossMargin[1]}%`} color={gmCol} dot={dot(gmCol)} />
          <ScoreRow label="Line-staff labour"
            value={scorecard.labour.value != null ? `${scorecard.labour.value.toFixed(1)}%` : '—'}
            zone={`≤${zones.labour[0]}% · watch to ${zones.labour[1]}%`} color={labCol} dot={dot(labCol)} />
          <ScoreRow label="Total labour incl owner"
            value={data.labourTotal?.value != null ? `${data.labourTotal.value.toFixed(1)}%` : '—'}
            zone="context" color="var(--color-ink-label)" dot="" />
          {meta.pending && (
            <div className="text-[10px] px-1" style={{ color: 'var(--color-ink-muted)' }}>{meta.pending}</div>
          )}
          <ScoreRow label="Sales trend"
            value={wow != null ? `${wow >= 0 ? '+' : ''}${wow.toFixed(1)}%` : '—'}
            zone="WoW" color={wowCol} dot={dot(wowCol)} />
        </div>
      </div>

      {/* BEST / WORST DAY */}
      {week.best && week.worst && (
        <div>
          <SectionLabel>Best &amp; quietest day</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' }}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-ink-muted)' }}>Best</div>
              <div className="text-sm font-bold" style={{ color: GREEN }}>{week.best.weekday} · {money(week.best.net)}</div>
            </div>
            <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' }}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-ink-muted)' }}>Quietest</div>
              <div className="text-sm font-bold" style={{ color: 'var(--color-ink-label)' }}>{week.worst.weekday} · {money(week.worst.net)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Tips — cash difference (surplus is tips): last week + calendar-year running total */}
      {data.cashDiff && (() => {
        const cd = data.cashDiff;
        const wkCol = cd.week == null ? 'var(--color-ink-muted)'
          : Math.abs(cd.week) < CD_TOLERANCE ? GREEN : cd.week < 0 ? RED : AMBER;
        return (
          <div className="flex items-center justify-between rounded-xl px-3 py-2"
            style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' }}>
            <div className="flex items-center gap-2">
              <Circle size={10} strokeWidth={2.5} aria-hidden fill={dot(wkCol) || 'none'} style={{ display: 'block', flexShrink: 0, color: dot(wkCol) || 'var(--color-ink-muted)' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--color-ink-label)' }}>***</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-[10px]" style={{ color: 'var(--color-ink-muted)' }}>wk</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: wkCol }}>{signedMoney(cd.week)}</span>
              <span className="text-[10px]" style={{ color: 'var(--color-ink-muted)' }}>{cd.year}</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-ink-label)' }}>{signedMoney(cd.ytd)}</span>
            </div>
          </div>
        );
      })()}

      {/* FOOTNOTE */}
      <div className="text-[10px] leading-relaxed" style={{ color: 'var(--color-ink-muted)' }}>
        Labour = {meta.labourBasis} (payroll wage sheet). Line staff excludes the owner wage. Gross margin: {grossMargin.source}{gmMonth}.
      </div>
    </div>
  );
}
