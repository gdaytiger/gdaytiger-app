'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Circle, RotateCcw } from 'lucide-react';
import { glassButtonStyle } from '@/app/lib/theme';

// Body for the owner-only "Trading" widget. Fed by /api/trading, which proxies the
// Day Trader Scan Apps Script (09:46 NY opening-range scan + Time Machine, graded after
// the close). Paper / analysis only — this widget is read-only and places nothing.

type Result = { entry: string; outcome: string; exit: number | null; r: number | null; pnl: number | null; maxLoss: number | null; rules: string };
type Pick = {
  ticker: string; status: string; orHigh: number | null; orLow: number | null; relVol: number | null;
  entry: number | null; stop: number | null; target: number | null; rr: number | null; shares: number | null; maxLoss: number | null;
  tmTarget: number | null; tmStop: number | null; tmNeither: number | null; tmAvgR: number | null;
  histTrades: number | null; histTarget: number | null; histAvgR: number | null; verdict: string; notes: string;
  result: Result | null;
  // Filtered strategy (opening volume >= 1.5x, gap up, market above its open at the breakout).
  top5?: boolean; gapPct?: number | null; filterSetup?: string; filterResult?: string; filterRules?: string;
};
type Filtered = { setups?: number; taken: number; wins: number; pnl: number | null };
type Day = { date: string; picks: number; graded: boolean; triggered: number; taken: number; wins: number; rulesPnl: number | null; allPnl: number | null; filtered?: Filtered };
export type TradingFeed = {
  ok: boolean; error?: string; generatedAt?: string;
  rules?: { maxLossPerTrade: number; maxDailyLoss: number; maxTradesPerDay: number; minRR: number; budget: number; flatBy: string;
    filter?: { MIN_REL_VOL: number; GAP_UP: boolean; MARKET_UP: boolean; MARKET_SYMBOL: string } };
  status?: { nyDate: string; nyTime: string; tradingDay: boolean; nextScan: string | null; scanState: string; evalState: string };
  scan?: { date: string; at?: string; scanned?: number; candidates?: number; best?: string; headline?: string; errors?: string[]; note?: string; filtered?: string[]; marketUp?: boolean | null } | null;
  latest?: { date: string; picks: Pick[] } | null;
  days?: Day[];
  totals?: { days: number; taken: number; wins: number; rulesPnl: number; allPnl: number; filtered?: Filtered };
};

const signed = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const px = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));
const pnlColor = (n: number | null | undefined) =>
  n == null || n === 0 ? 'var(--color-ink-label)' : n > 0 ? 'var(--color-success)' : 'var(--color-danger)';
const verdictColor = (v: string) =>
  /^Positive/.test(v) ? 'var(--color-success)' : /^Odds against/.test(v) ? 'var(--color-danger)' : /^No trade/.test(v) ? 'var(--color-ink-muted)' : 'var(--color-warning)';
const shortVerdict = (v: string) =>
  /^Positive/.test(v) ? 'Edge' : /^Odds against/.test(v) ? 'Odds against' : /^Coin flip/.test(v) ? 'Coin flip' : /^No trade/.test(v) ? 'No trade' : v || '—';
const melb = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};
const dayLabel = (date: string) =>
  new Date(date + 'T12:00:00Z').toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

// Launcher badge: the latest graded day's P&L following the rules, else the number of picks.
export function tradingBadge(feed: TradingFeed | null): string | undefined {
  if (!feed?.ok || !feed.days?.length) return undefined;
  const d = feed.days[0];
  if (d.graded && d.rulesPnl != null) return `${d.rulesPnl >= 0 ? '+' : '−'}$${Math.round(Math.abs(d.rulesPnl))}`;
  return d.picks ? String(d.picks) : undefined;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-widest mb-2"
      style={{ fontFamily: '"stolzl", sans-serif', color: 'var(--color-ink-muted)' }}>{children}</div>
  );
}

const ROW: React.CSSProperties = { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.8)' };

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-3 py-2 flex-1 min-w-0" style={ROW}>
      <div className="text-[10px] uppercase tracking-widest truncate" style={{ color: 'var(--color-ink-muted)', fontFamily: '"stolzl", sans-serif' }}>{label}</div>
      <div className="text-base font-bold tabular-nums truncate" style={{ color: color || 'var(--color-ink-label)' }}>{value}</div>
    </div>
  );
}

function PickRow({ p }: { p: Pick }) {
  const r = p.result;
  const counted = r && /^taken/.test(r.rules);
  return (
    <div className="rounded-xl px-3 py-2.5" style={ROW}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Circle size={10} strokeWidth={2.5} aria-hidden fill={verdictColor(p.verdict)} style={{ display: 'block', flexShrink: 0, color: verdictColor(p.verdict) }} />
          <span className="text-sm font-bold" style={{ color: 'var(--color-ink-label)' }}>{p.ticker}</span>
          <span className="text-[11px] truncate" style={{ color: verdictColor(p.verdict) }}>{shortVerdict(p.verdict)}</span>
          {p.filterSetup === 'yes' && (
            <span className="text-[9px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5"
              style={{ background: 'var(--color-brand-peach-soft)', color: 'var(--color-brand-bark)', fontFamily: '"stolzl", sans-serif' }}>Filtered</span>
          )}
        </div>
        {r ? (
          <span className="text-sm font-bold tabular-nums" style={{ color: pnlColor(r.pnl), opacity: counted || !r.entry ? 1 : 0.5 }}>
            {r.entry ? signed(r.pnl) : 'no entry'}
          </span>
        ) : (
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>{p.status}</span>
        )}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-x-2 text-[11px] tabular-nums" style={{ color: 'var(--color-ink-muted)' }}>
        <span>In {px(p.entry)}</span>
        <span>Stop {px(p.stop)}</span>
        <span>Target {px(p.target)}</span>
        <span>{p.shares ?? '—'} sh · risk {p.maxLoss != null ? '$' + Math.round(p.maxLoss) : '—'}</span>
        <span>TM {p.tmTarget ?? '—'}% / {p.tmStop ?? '—'}%</span>
        <span>{p.histTrades ?? 0} past · {p.histAvgR ?? '—'}R</span>
      </div>
      {r && r.entry && (
        <div className="mt-1 text-[11px]" style={{ color: 'var(--color-ink-label)' }}>
          {r.entry} → {r.outcome}{r.r != null ? ` (${r.r}R)` : ''}
          <span style={{ color: 'var(--color-ink-muted)' }}> · {r.rules}</span>
        </div>
      )}
      {r && p.filterSetup === 'yes' && (
        <div className="mt-0.5 text-[11px]" style={{ color: 'var(--color-ink-muted)' }}>
          Filtered: {p.filterResult === 'pass' ? p.filterRules || 'pass' : p.filterResult || '—'}
        </div>
      )}
    </div>
  );
}

export default function TradingCard({ active, onFeed }: { active: boolean; onFeed?: (f: TradingFeed | null) => void }) {
  const [feed, setFeed] = useState<TradingFeed | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    return fetch('/api/trading', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: TradingFeed) => { setFeed(d); onFeed?.(d); })
      .catch((e) => setFeed({ ok: false, error: String(e) }));
  }, [onFeed]);

  // Load once for the launcher badge, then refresh whenever the sheet is opened.
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (active) load(); }, [active, load]);

  const refreshNow = () => { setLoading(true); load().finally(() => setLoading(false)); };

  const refresh = (
    <button onClick={refreshNow} disabled={loading} style={{ ...glassButtonStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }} aria-label="Refresh">
      <RotateCcw size={13} strokeWidth={2} aria-hidden style={{ display: 'block' }} />
      {loading ? 'LOADING' : 'REFRESH'}
    </button>
  );

  if (!feed) return <div className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>Loading…</div>;
  if (!feed.ok) {
    return (
      <div className="space-y-3">
        <div className="text-sm" style={{ color: 'var(--color-danger)' }}>Trading feed unavailable: {feed.error}</div>
        {refresh}
      </div>
    );
  }

  const latest = feed.latest;
  const today = feed.days?.[0];
  const totals = feed.totals;
  const rules = feed.rules;
  const winRate = totals && totals.taken ? Math.round((totals.wins / totals.taken) * 100) + '%' : '—';
  const fWinRate = totals?.filtered?.taken ? Math.round((totals.filtered.wins / totals.filtered.taken) * 100) + '%' : '—';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[11px]" style={{ color: 'var(--color-ink-muted)' }}>
          <span className="font-bold uppercase tracking-widest" style={{ color: 'var(--color-ink-label)', fontFamily: '"stolzl", sans-serif' }}>Paper · analysis only</span>
          {' · '}next scan {melb(feed.status?.nextScan)}
        </div>
        {refresh}
      </div>

      {latest ? (
        <div>
          <SectionLabel>{dayLabel(latest.date)} (New York){feed.scan?.at ? ` · scanned ${feed.scan.at}` : ''}</SectionLabel>
          {feed.scan?.headline && <div className="text-sm mb-2" style={{ color: 'var(--color-ink-label)' }}>{feed.scan.headline}</div>}
          {today?.graded && (
            <div className="flex gap-2 mb-2">
              <Stat label="Current rules" value={signed(today.rulesPnl)} color={pnlColor(today.rulesPnl)} />
              <Stat label="Filtered" value={signed(today.filtered?.pnl)} color={pnlColor(today.filtered?.pnl)} />
              <Stat label="Trades" value={`${today.taken} · ${today.filtered?.taken ?? 0}`} />
            </div>
          )}
          {!today?.graded && !!feed.scan?.filtered && (
            <div className="text-[11px] mb-2" style={{ color: 'var(--color-ink-label)' }}>
              Filtered setups: {feed.scan.filtered.length ? feed.scan.filtered.join(', ') : 'none today'}
              {feed.scan.marketUp != null && <span style={{ color: 'var(--color-ink-muted)' }}> · market {feed.scan.marketUp ? 'above' : 'below'} its open at the scan</span>}
            </div>
          )}
          <div className="space-y-2">
            {latest.picks.map((p) => <PickRow key={p.ticker} p={p} />)}
          </div>
          {!today?.graded && (
            <div className="text-[11px] mt-2" style={{ color: 'var(--color-ink-muted)' }}>
              A pick counts only if a 5-min bar closes above its OR high before 15:30 NY. Graded after the close (~8:10am Melbourne).
            </div>
          )}
          {!!feed.scan?.errors?.length && (
            <div className="text-[11px] mt-2" style={{ color: 'var(--color-warning)' }}>Data gaps: {feed.scan.errors.join('; ')}</div>
          )}
        </div>
      ) : (
        <div className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>No scans yet. The first one runs {melb(feed.status?.nextScan)}.</div>
      )}

      {totals && totals.days > 0 && (
        <div>
          <SectionLabel>Last {totals.days} graded day{totals.days === 1 ? '' : 's'}: current rules vs filtered</SectionLabel>
          <div className="flex gap-2 mb-1">
            <Stat label="Current P&L" value={signed(totals.rulesPnl)} color={pnlColor(totals.rulesPnl)} />
            <Stat label="Trades" value={String(totals.taken)} />
            <Stat label="Win rate" value={winRate} />
          </div>
          <div className="flex gap-2 mb-2">
            <Stat label="Filtered P&L" value={signed(totals.filtered?.pnl)} color={pnlColor(totals.filtered?.pnl)} />
            <Stat label="Trades" value={String(totals.filtered?.taken ?? 0)} />
            <Stat label="Win rate" value={fWinRate} />
          </div>
          <div className="space-y-1">
            {(feed.days || []).filter((d) => d.graded).map((d) => (
              <div key={d.date} className="flex items-center justify-between rounded-xl px-3 py-1.5 text-xs tabular-nums" style={ROW}>
                <span style={{ color: 'var(--color-ink-label)' }}>{dayLabel(d.date)}</span>
                <span className="font-bold" style={{ color: pnlColor(d.rulesPnl) }}>{signed(d.rulesPnl)}</span>
                <span className="font-bold" style={{ color: pnlColor(d.filtered?.pnl) }}>{signed(d.filtered?.pnl)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rules && (
        <div className="text-[10px]" style={{ color: 'var(--color-ink-muted)' }}>
          Rules: ${rules.maxLossPerTrade} max loss a trade · ${rules.maxDailyLoss} a day · {rules.maxTradesPerDay} trades a day · {rules.minRR}R minimum · flat by {rules.flatBy} NY.
          {rules.filter && <> Filtered: opening volume ≥ {rules.filter.MIN_REL_VOL}× normal, gap up, {rules.filter.MARKET_SYMBOL} above its open at the breakout.</>}
          {' '}Hypothetical fills, no slippage or fees. Not financial advice.
        </div>
      )}
    </div>
  );
}
