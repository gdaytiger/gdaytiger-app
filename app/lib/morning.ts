import { readOsBlocks, writeOsBlock } from './osBlocks';
import { melbNowDate } from './melbTime';
import { formatYMD, shiftYMD } from './dayTasks';

// Builds the 6am snapshot shared by the push (/api/push/morning) and the
// Morning card (/api/morning). Pulls the app's own /api/dashboard + /api/roster
// (with the session cookie, server-side) so task/roster logic lives in one place.

export const CASH_TOLERANCE = 20; // $ either way before a cash-up is flagged

type Brief = { updated: string; yesterday: { date: string; gross: number; orders: number; cash: number }; ly: { date: string; gross: number; orders: number } };
type SalesDaily = { days: { date: string; gross: number; orders: number }[] };
export type CashCounts = { float: number | null; entries: Record<string, number> };

export type MorningSnapshot = {
  generated: string;
  today: string;
  todayLabel: string;
  weather: string | null;
  tasks: { total: number; missed: number; top: string[] };
  shift: string | null;
  sales: { date: string; gross: number; orders: number; ly: number | null; lyPct: number | null; avg4: number | null; avg4Pct: number | null } | null;
  cash: { date: string; square: number; counted: number | null; variance: number | null; status: 'ok' | 'short' | 'over' | 'missing' | 'no-float' } | null;
  alerts: string[];
  focus: string | null;
};

const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

async function internal(origin: string, path: string) {
  try {
    const r = await fetch(`${origin}${path}`, { headers: { cookie: `gdt_session=${process.env.SESSION_TOKEN}` }, cache: 'no-store' });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

export async function buildMorning(origin: string, withFocus: boolean): Promise<MorningSnapshot> {
  const now = melbNowDate();
  const today = formatYMD(now);
  const yesterday = shiftYMD(today, -1);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const todayLabel = `${dayNames[now.getUTCDay()]} ${now.getUTCDate()} ${monthNames[now.getUTCMonth()]}`;

  const [dash, roster, blocks] = await Promise.all([
    internal(origin, '/api/dashboard'),
    internal(origin, '/api/roster'),
    readOsBlocks(['morning_brief', 'sales_daily', 'cash_counts']),
  ]);
  const brief = blocks.morning_brief as unknown as Brief | null;
  const salesDaily = blocks.sales_daily as unknown as SalesDaily | null;
  const cashCounts = (blocks.cash_counts as unknown as CashCounts | null) || { float: null, entries: {} };
  const alerts: string[] = [];

  // Tasks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const taskList: any[] = (dash?.dailyTasks || []).filter((t: any) => !t.isHeader && !t.checked);
  const tasks = {
    total: taskList.length,
    missed: taskList.filter(t => t.isMissed).length,
    top: taskList.slice(0, 5).map(t => String(t.text).replace(/^\[[^\]]*\]\s*/, '')),
  };
  const weather = typeof dash?.weather === 'string' && !dash.weather.includes('unavailable') ? dash.weather.replace(' — ', ' ') : null;

  // Your shift today
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (roster?.shifts || []).find((x: any) => x.date === today);
  const shift = s?.working ? `${s.area ? s.area + ' ' : ''}${s.start}–${s.end}` : s ? 'Not rostered' : null;

  // Sales (yesterday)
  let sales: MorningSnapshot['sales'] = null;
  if (brief?.yesterday?.date === yesterday) {
    const y = brief.yesterday;
    const sameDays = [7, 14, 21, 28].map(n => shiftYMD(yesterday, -n));
    const prior = (salesDaily?.days || []).filter(d => sameDays.includes(d.date) && d.gross > 0);
    const avg4 = prior.length ? prior.reduce((a, d) => a + d.gross, 0) / prior.length : null;
    const ly = brief.ly?.gross > 0 ? brief.ly.gross : null;
    sales = { date: y.date, gross: y.gross, orders: y.orders, ly, lyPct: ly ? pct(y.gross, ly) : null, avg4, avg4Pct: avg4 ? pct(y.gross, avg4) : null };
    if (sales.avg4Pct != null && sales.avg4Pct <= -15) alerts.push(`Sales ${sales.avg4Pct}% vs last 4 ${dayNames[new Date(yesterday + 'T00:00:00Z').getUTCDay()]}s`);
  } else if (brief) {
    alerts.push('Square sales feed didn’t update overnight');
  }

  // Cash-up (yesterday)
  let cash: MorningSnapshot['cash'] = null;
  if (brief?.yesterday?.date === yesterday && (brief.yesterday.cash > 0 || cashCounts.entries[yesterday] != null)) {
    const square = brief.yesterday.cash;
    const raw = cashCounts.entries[yesterday];
    if (raw == null) {
      cash = { date: yesterday, square, counted: null, variance: null, status: 'missing' };
      alerts.push('No cash-up entered for yesterday');
    } else if (cashCounts.float == null) {
      cash = { date: yesterday, square, counted: raw, variance: null, status: 'no-float' };
    } else {
      const counted = raw - cashCounts.float;
      const variance = Math.round((counted - square) * 100) / 100;
      const status = Math.abs(variance) < CASH_TOLERANCE ? 'ok' : variance < 0 ? 'short' : 'over';
      cash = { date: yesterday, square, counted, variance, status };
      if (status !== 'ok') alerts.push(`Cash ${status} ${money(Math.abs(variance))} yesterday`);
    }
  }

  const snap: MorningSnapshot = { generated: new Date().toISOString(), today, todayLabel, weather, tasks, shift, sales, cash, alerts, focus: null };
  if (withFocus) snap.focus = await focusLine(snap);
  return snap;
}

async function focusLine(snap: MorningSnapshot): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 80,
        system: "You brief Jonathan, owner-operator of G'Day Tiger café (Cowes, Phillip Island; 6:30am–3pm). Given this morning's snapshot, write ONE line (max 18 words, Australian English, no preamble, no emoji) naming the single most useful thing to focus on today — a commercial or operational call, not a generic tip. If nothing stands out, point at the highest-value task.",
        messages: [{ role: 'user', content: JSON.stringify({ ...snap, focus: undefined }) }],
      }),
    });
    const d = await res.json();
    return d?.content?.[0]?.text?.trim() || null;
  } catch { return null; }
}

export function pushText(s: MorningSnapshot): { title: string; body: string } {
  const lines: string[] = [];
  lines.push(`${s.tasks.total} tasks${s.tasks.missed ? ` (${s.tasks.missed} from before)` : ''}${s.shift ? ` · You: ${s.shift}` : ''}${s.weather ? ` · ${s.weather}` : ''}`);
  if (s.sales) {
    const vs = s.sales.lyPct != null ? `${s.sales.lyPct >= 0 ? '+' : ''}${s.sales.lyPct}% vs LY` : s.sales.avg4Pct != null ? `${s.sales.avg4Pct >= 0 ? '+' : ''}${s.sales.avg4Pct}% vs 4wk` : '';
    const c = s.cash ? (s.cash.status === 'ok' ? ' · Cash ✓' : s.cash.status === 'missing' ? ' · Cash-up missing' : s.cash.status === 'no-float' ? '' : ` · Cash ${s.cash.status} $${Math.abs(s.cash.variance || 0).toFixed(0)}`) : '';
    lines.push(`Yesterday ${money(s.sales.gross)}${vs ? ` (${vs})` : ''}${c}`);
  }
  if (s.focus) lines.push(s.focus);
  else if (s.alerts.length) lines.push(`⚠️ ${s.alerts[0]}`);
  return { title: `☀️ ${s.todayLabel}`, body: lines.join('\n') };
}

export async function saveSnapshot(s: MorningSnapshot) {
  await writeOsBlock('morning_snapshot', s as unknown as Record<string, unknown>);
}
