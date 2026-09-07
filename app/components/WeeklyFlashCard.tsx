'use client';

import React from 'react';

// Presentational body for the dashboard "Weekly Flash" card.
// Fed by /api/weekly-flash (sales, labour, margin) + /api/flash-extras
// (category mix + day-part). The Monday-morning operational scorecard for the
// last completed week vs the week before, against the ONA benchmark zones.

type WeekMetrics = {
  start: string; end: string;
  net: number; orders: number; avgSale: number | null;
  labourCost: number | null; labourPct: number | null;
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
  meta: { labourBasis: string; pending: string };
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
const hourLabel = (h: number) => {
  const ap = h < 12 ? 'a' : 'p';
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
        <span style={{ fontSize: '12px' }}>{dot}</span>
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
function DayPartSection({ extras }: { extras: FlashExtrasData }) {
  if (!extras?.ready || !extras.dayPart.length) return null;
  const maxNet = Math.max(...extras.dayPart.map((d) => d.net));
  const peak = extras.dayPart.reduce((a, b) => (b.net > a.net ? b : a), extras.dayPart[0]);
  return (
    <div>
      <SectionLabel>Day shape · net by hour</SectionLabel>
      <div className="rounded-xl px-3 py-3" style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' }}>
        <div className="flex items-end gap-1" style={{ height: '68px' }}>
          {extras.dayPart.map((h) => {
            const isPeak = h.hour === peak.hour;
            const hpx = Math.max(3, maxNet > 0 ? (h.net / maxNet) * 56 : 0);
            return (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end gap-1">
                <div className="w-full rounded-t"
                  style={{ height: `${hpx}px`, background: isPeak ? 'var(--color-brand-peach)' : 'rgba(0,0,0,0.12)' }} />
                <div className="text-[9px] tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>{hourLabel(h.hour)}</div>
              </div>
            );
          })}
        </div>
        <div className="text-[10px] mt-2" style={{ color: 'var(--color-ink-muted)' }}>
          Peak <span className="font-semibold" style={{ color: 'var(--color-ink-label)' }}>{hourLabel(peak.hour)}</span> · {money(peak.net)} ({peak.pct.toFixed(0)}% of the week)
        </div>
      </div>
    </div>
  );
}

export default function WeeklyFlashCard({ data, extras }: { data: WeeklyFlashData; extras: FlashExtrasData }) {
  if (!data) return <div className="text-xs text-gray-400 py-6 text-center">Loading…</div>;
  if (!data.ready || !data.week) {
    return <div className="text-xs py-6 text-center" style={{ color: 'var(--color-ink-muted)' }}>
      Last week&apos;s data is still landing — check back after the overnight sync.
    </div>;
  }

  const { week, salesWoW, grossMargin, zones, scorecard, meta } = data;
  const wow = salesWoW;
  const wowCol = wow == null ? 'var(--color-ink-muted)' : (wow >= 0 ? GREEN : RED);
  const wowArrow = wow == null ? '' : (wow >= 0 ? '▲' : '▼');

  const gmCol = scorecard.grossMargin.verdict === 'below' ? RED : GREEN;
  const labVerdict = scorecard.labour.verdict;
  const labCol = labVerdict === 'in' ? GREEN : labVerdict === 'above' ? RED : labVerdict === 'below' ? AMBER : 'var(--color-ink-muted)';
  const dot = (col: string) => col === GREEN ? '🟢' : col === RED ? '🔴' : col === AMBER ? '🟡' : '⚪';
  const gmMonth = grossMargin.month ? ` (${grossMargin.month})` : '';

  return (
    <div className="flex flex-col gap-5">
      {/* HERO */}
      <div>
        <SectionLabel>Net sales · week ending {week.end}</SectionLabel>
        <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' }}>
          <div className="flex items-baseline gap-3">
            <span className="font-bold tabular-nums leading-none" style={{ fontSize: '40px', color: 'var(--color-ink-label)' }}>{money(week.net)}</span>
            {wow != null && <span className="text-sm font-bold tabular-nums" style={{ color: wowCol }}>{wowArrow} {Math.abs(wow).toFixed(1)}%</span>}
          </div>
          <div className="flex gap-4 mt-2 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
            <span><span className="font-semibold" style={{ color: 'var(--color-ink-label)' }}>{week.orders.toLocaleString()}</span> orders</span>
            <span>avg sale <span className="font-semibold" style={{ color: 'var(--color-ink-label)' }}>{money2(week.avgSale)}</span></span>
            <span className="tabular-nums">vs prior wk</span>
          </div>
        </div>
      </div>

      <MixSection extras={extras} />
      <DayPartSection extras={extras} />

      {/* SCORECARD */}
      <div>
        <SectionLabel>Benchmark scorecard · ONA zones</SectionLabel>
        <div className="flex flex-col gap-2">
          <ScoreRow label={`Gross margin${gmMonth}`} value={`${grossMargin.pct}%`}
            zone={`${zones.grossMargin[0]}–${zones.grossMargin[1]}%`} color={gmCol} dot={dot(gmCol)} />
          <ScoreRow label="Line-staff labour"
            value={scorecard.labour.value != null ? `${Math.round(scorecard.labour.value)}%` : '—'}
            zone={`${zones.labour[0]}–${zones.labour[1]}%`} color={labCol} dot={dot(labCol)} />
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

      {/* FOOTNOTE */}
      <div className="text-[10px] leading-relaxed" style={{ color: 'var(--color-ink-muted)' }}>
        Labour is {meta.labourBasis}, on net (ex-GST) sales. Gross margin: {grossMargin.source}{gmMonth}.
      </div>
    </div>
  );
}
