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
  // Retired filtered strategy columns (old rows only).
  top5?: boolean; gapPct?: number | null; filterSetup?: string; filterResult?: string; filterRules?: string;
};
type Filtered = { setups?: number; taken: number; wins: number; pnl: number | null };
// Gap-down reversal: opened 3%+ down, bought the first 5-min close back above VWAP by 12:00 NY.
type Reversal = { graded?: boolean; days?: number; setups?: number; triggered?: number; taken: number; wins: number; pnl: number | null };
type RevTrade = {
  ticker: string; gapPct: number | null; signal: string; time: string; entry: number | null; stop: number | null; target: number | null;
  shares: number | null; maxLoss: number | null; outcome: string; exit: number | null; r: number | null; pnl: number | null; rules: string;
};
type Day = { date: string; picks: number; graded: boolean; triggered: number; taken: number; wins: number; rulesPnl: number | null; allPnl: number | null; filtered?: Filtered; reversal?: Reversal };
export type TradingFeed = {
  ok: boolean; error?: string; generatedAt?: string;
  rules?: { maxLossPerTrade: number; maxDailyLoss: number; maxTradesPerDay: number; minRR: number; budget: number; flatBy: string;
    reversal?: { GAP: number; BY: string; TARGET_R: number } };
  status?: { nyDate: string; nyTime: string; tradingDay: boolean; nextScan: string | null; scanState: string; evalState: string };
  scan?: { date: string; at?: string; scanned?: number; candidates?: number; best?: string; headline?: string; errors?: string[]; note?: string; gapDowns?: { ticker: string; gapPct: number }[]; marketUp?: boolean | null } | null;
  latest?: { date: string; picks: Pick[] } | null;
  reversal?: { date: string; trades: RevTrade[] } | null;
  days?: Day[];
  totals?: { days: number; taken: number; wins: number; rulesPnl: number; allPnl: number; filtered?: Filtered; reversal?: Reversal };
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
    </div>
  );
}

function RevRow({ t }: { t: RevTrade }) {
  const counted = /^taken/.test(t.rules);
  return (
    <div className="rounded-xl px-3 py-2.5" style={ROW}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-bold" style={{ color: 'var(--color-ink-label)' }}>{t.ticker}</span>
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-danger)' }}>{t.gapPct != null ? t.gapPct.toFixed(1) + '%' : ''}</span>
        </div>
        <span className="text-sm font-bold tabular-nums" style={{ color: pnlColor(t.pnl), opacity: counted || !t.time ? 1 : 0.5 }}>
          {t.time ? signed(t.pnl) : 'no entry'}
        </span>
      </div>
      <div className="mt-1 text-[11px]" style={{ color: 'var(--color-ink-muted)' }}>
        {t.time
          ? <>In {px(t.entry)} at {t.time} · stop {px(t.stop)} · target {px(t.target)} · {t.shares} sh → {t.outcome}{t.r != null ? ` (${t.r}R)` : ''} · {t.rules}</>
          : t.signal}
      </div>
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
  const rev = totals?.reversal;
  const rWinRate = rev?.taken ? Math.round((rev.wins / rev.taken) * 100) + '%' : '—';
  const revToday = feed.reversal && feed.reversal.date === latest?.date ? feed.reversal : null;

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
              <Stat label="Reversal" value={today.reversal?.graded ? signed(today.reversal.pnl) : '—'} color={pnlColor(today.reversal?.pnl)} />
              <Stat label="Trades" value={`${today.taken} · ${today.reversal?.taken ?? 0}`} />
            </div>
          )}
          {!revToday && !!feed.scan?.gapDowns && (
            <div className="text-[11px] mb-2" style={{ color: 'var(--color-ink-label)' }}>
              Gap-down reversal watch: {feed.scan.gapDowns.length
                ? feed.scan.gapDowns.map((g) => `${g.ticker} ${g.gapPct.toFixed(1)}%`).join(', ')
                : 'no stock opened 3%+ down'}
              {!!feed.scan.gapDowns.length && <span style={{ color: 'var(--color-ink-muted)' }}> · buy only on a 5-min close back above VWAP by 12:00 NY</span>}
            </div>
          )}
          <div className="space-y-2">
            {latest.picks.map((p) => <PickRow key={p.ticker} p={p} />)}
          </div>
          {!!revToday?.trades.length && (
            <div className="mt-3">
              <SectionLabel>Gap-down reversal</SectionLabel>
              <div className="space-y-2">
                {revToday.trades.map((t) => <RevRow key={t.ticker} t={t} />)}
              </div>
            </div>
          )}
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

      {totals && (totals.days > 0 || !!rev?.days) && (
        <div>
          <SectionLabel>Last {Math.max(totals.days, rev?.days ?? 0)} graded days: current rules vs gap-down reversal</SectionLabel>
          <div className="flex gap-2 mb-1">
            <Stat label="Current P&L" value={signed(totals.rulesPnl)} color={pnlColor(totals.rulesPnl)} />
            <Stat label="Trades" value={String(totals.taken)} />
            <Stat label="Win rate" value={winRate} />
          </div>
          <div className="flex gap-2 mb-2">
            <Stat label="Reversal P&L" value={signed(rev?.pnl)} color={pnlColor(rev?.pnl)} />
            <Stat label="Trades" value={String(rev?.taken ?? 0)} />
            <Stat label="Win rate" value={rWinRate} />
          </div>
          <div className="space-y-1">
            {(feed.days || []).filter((d) => (d.graded && d.picks) || d.reversal?.graded).map((d) => (
              <div key={d.date} className="flex items-center justify-between rounded-xl px-3 py-1.5 text-xs tabular-nums" style={ROW}>
                <span style={{ color: 'var(--color-ink-label)' }}>{dayLabel(d.date)}</span>
                <span className="font-bold" style={{ color: pnlColor(d.picks ? d.rulesPnl : null) }}>{d.picks ? signed(d.rulesPnl) : '—'}</span>
                <span className="font-bold" style={{ color: pnlColor(d.reversal?.pnl) }}>{d.reversal?.graded ? signed(d.reversal.pnl) : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rules && (
        <div className="text-[10px]" style={{ color: 'var(--color-ink-muted)' }}>
          Rules: ${rules.maxLossPerTrade} max loss a trade · ${rules.maxDailyLoss} a day · {rules.maxTradesPerDay} trades a day · {rules.minRR}R minimum · flat by {rules.flatBy} NY.
          {rules.reversal && <> Gap-down reversal: opens {Math.round(rules.reversal.GAP * 100)}%+ below yesterday&apos;s close, buy the first 5-min close back above VWAP by {rules.reversal.BY} NY, stop 1¢ under the day&apos;s low, {rules.reversal.TARGET_R}R target; P&amp;L after estimated costs.</>}
          {' '}Current-rules fills are hypothetical with no fees. Not financial advice.
        </div>
      )}
    </div>
  );
}
