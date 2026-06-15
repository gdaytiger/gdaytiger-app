'use client';

import React from 'react';

// Presentational body for the dashboard "Labour" card. Fed by /api/staff-cost.
// Three sections: hero staff-cost % (this week), last-14-day bars, roster shape.

export type StaffWeek = {
  start: string; end: string;
  hours: number; labourCost: number;
  sales: number | null; staffPct: number | null;
};
export type StaffDay = {
  date: string; weekday: string;
  hours: number; labourCost: number;
  sales: number | null; staffPct: number | null;
};
export type StaffCostData = {
  rate: number; target: number;
  thisWeek: StaffWeek | null;
  lastWeek: StaffWeek | null;
  recent: StaffDay[];
  weeks: StaffWeek[];
  rosterShape: { weekday: string; avgHours: number }[];
  meta: { salesReady: boolean; note: string };
} | null;

const money = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Math.round(n).toLocaleString();

// Traffic-light colour for a staff-cost %.
function pctColor(p: number | null): string {
  if (p == null) return '#9ca3af';
  if (p <= 35) return '#15803d'; // green
  if (p <= 45) return '#b45309'; // amber
  return '#b91c1c';              // red
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-widest mb-2"
      style={{ fontFamily: '"stolzl", sans-serif', color: '#9ca3af' }}>{children}</div>
  );
}

export default function LabourCardBody({ data }: { data: StaffCostData }) {
  if (!data) {
    return <div className="text-xs text-gray-400 py-6 text-center">Loading…</div>;
  }

  const { thisWeek, lastWeek, recent, rosterShape, target, meta } = data;
  const heroPct = thisWeek?.staffPct ?? null;
  const heroCol = pctColor(heroPct);

  // Trend vs last week (lower is better → green when improving).
  let trend: { arrow: string; col: string; text: string } | null = null;
  if (heroPct != null && lastWeek?.staffPct != null) {
    const delta = heroPct - lastWeek.staffPct;
    const up = delta > 0;
    trend = {
      arrow: up ? '▲' : '▼',
      col: up ? '#b91c1c' : '#15803d',
      text: `${Math.abs(delta).toFixed(0)} pts vs last wk`,
    };
  }

  const maxRoster = Math.max(1, ...rosterShape.map((r) => r.avgHours));

  return (
    <div className="flex flex-col gap-5">
      {/* ── HERO: this week's staff cost % ── */}
      <div>
        <SectionLabel>Staff cost % · this week</SectionLabel>
        {heroPct != null ? (
          <div className="rounded-2xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' }}>
            <div className="flex items-baseline gap-2">
              <span className="font-bold tabular-nums leading-none" style={{ fontSize: '40px', color: heroCol }}>
                {Math.round(heroPct)}<span style={{ fontSize: '20px' }}>%</span>
              </span>
              {trend && (
                <span className="text-[11px] font-semibold tabular-nums" style={{ color: trend.col }}>
                  {trend.arrow} {trend.text}
                </span>
              )}
            </div>
            <div className="text-[11px] text-gray-500 mt-1.5 tabular-nums">
              {money(thisWeek?.sales)} sales · {money(thisWeek?.labourCost)} labour · {Math.round(thisWeek?.hours ?? 0)} hrs
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: heroPct <= target ? '#15803d' : '#b45309' }}>
              Target ≤ {target}% {heroPct <= target ? '· on target' : `· ${Math.round(heroPct - target)} pts over`}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl px-4 py-3 text-xs text-gray-400"
            style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.7)' }}>
            {meta.salesReady ? 'No sales recorded yet this week.' : 'Square sales backfill still running — fills in shortly.'}
          </div>
        )}
      </div>

      {/* ── LAST 14 DAYS: sales vs labour, coloured by staff cost % ── */}
      <div>
        <SectionLabel>Last 14 days · staff cost %</SectionLabel>
        {recent.length ? (
          <div className="space-y-1.5">
            {recent.map((d) => {
              const col = pctColor(d.staffPct);
              const w = Math.min(100, d.staffPct ?? 0);
              const dd = d.date.slice(8, 10);
              return (
                <div key={d.date} className="flex items-center gap-2"
                  title={`${d.weekday} ${d.date} — ${money(d.sales)} sales, ${money(d.labourCost)} labour, ${Math.round(d.hours)}h`}>
                  <span className="text-[10px] text-gray-400 tabular-nums shrink-0" style={{ width: '34px' }}>
                    {d.weekday.slice(0, 2)} {dd}
                  </span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
                    <div className="h-full rounded-full" style={{ width: `${w}%`, background: col, transition: 'width 0.5s ease' }} />
                  </div>
                  <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ width: '30px', textAlign: 'right', color: col }}>
                    {d.staffPct != null ? `${Math.round(d.staffPct)}%` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-[11px] text-gray-400 py-2">Sales data filling in — check back shortly.</div>
        )}
      </div>

      {/* ── ROSTER SHAPE: avg hours by weekday (labour-only, always available) ── */}
      <div>
        <SectionLabel>Roster shape · avg hrs/day</SectionLabel>
        <div className="space-y-1.5">
          {rosterShape.map((r) => (
            <div key={r.weekday} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 tabular-nums shrink-0" style={{ width: '34px' }}>{r.weekday}</span>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
                <div className="h-full rounded-full"
                  style={{ width: `${(r.avgHours / maxRoster) * 100}%`, background: '#fbcdad', transition: 'width 0.5s ease' }} />
              </div>
              <span className="text-[10px] font-semibold tabular-nums shrink-0 text-gray-500" style={{ width: '30px', textAlign: 'right' }}>
                {r.avgHours.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
