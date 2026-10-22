'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { MorningSnapshot } from '@/app/lib/morning';

// Morning card: the same snapshot the 5am push sends, the nightly cash-up
// entry, and the switch to turn phone alerts on. Self-contained — fetches its
// own data from /api/morning, /api/cash-count, /api/push/*.

type MorningData = { snapshot: MorningSnapshot; cash: { float: number | null; todayCount: number | null } } | null;

const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
const signed = (n: number | null, suffix: string) => (n == null ? null : `${n >= 0 ? '+' : ''}${n}% ${suffix}`);
const label: React.CSSProperties = { fontFamily: '"stolzl", sans-serif', fontWeight: 700, fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-ink-label)' };
const box: React.CSSProperties = { background: 'rgba(255,255,255,0.55)', borderRadius: '16px', padding: '12px 14px' };
const input: React.CSSProperties = { width: '110px', padding: '8px 10px', borderRadius: '10px', border: '1px solid rgba(0,0,0,0.12)', fontSize: '16px', background: 'white' };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: '999px', background: 'var(--color-brand-peach)', color: '#333', fontWeight: 700, fontSize: '13px', border: 'none' };

function urlB64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export default function MorningCard({ active }: { active: boolean }) {
  const [data, setData] = useState<MorningData>(null);
  const [count, setCount] = useState('');
  const [floatVal, setFloatVal] = useState('');
  const [editFloat, setEditFloat] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pushState, setPushState] = useState<'unknown' | 'unsupported' | 'off' | 'on'>('unknown');

  const load = useCallback(() => {
    fetch('/api/morning').then(r => r.json()).then((d: MorningData) => {
      setData(d);
      if (d?.cash.float == null) setEditFloat(true);
    }).catch(() => {});
  }, []);

  useEffect(() => { if (active && !data) load(); }, [active, data, load]);

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window;
    (supported ? navigator.serviceWorker.getRegistration('/').then(reg => reg?.pushManager.getSubscription()) : Promise.reject(new Error('unsupported')))
      .then(sub => setPushState(sub ? 'on' : 'off'))
      .catch(() => setPushState(supported ? 'off' : 'unsupported'));
  }, []);

  async function saveCash(payload: { counted?: number; float?: number }) {
    setMsg('Saving…');
    const r = await fetch('/api/cash-count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) { setMsg('Couldn’t save — try again'); return; }
    setMsg('Saved ✓'); setCount(''); setEditFloat(false); load();
    setTimeout(() => setMsg(null), 2500);
  }

  async function enablePush() {
    try {
      setMsg('Turning on…');
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setMsg('Notifications are blocked — allow them in iPhone Settings → Notifications → Tiger OS'); return; }
      const { publicKey } = await fetch('/api/push/subscribe').then(r => r.json());
      if (!publicKey) { setMsg('Server push keys not set yet'); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
      const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      if (!r.ok) throw new Error('save failed');
      setPushState('on'); setMsg('6am alerts on ✓');
    } catch (e) {
      setMsg(`Couldn’t turn on alerts (${e instanceof Error ? e.message : 'error'})`);
    }
  }

  async function sendTest() {
    setMsg('Sending…');
    const r = await fetch('/api/push/morning', { method: 'POST' }).then(x => x.json()).catch(() => null);
    setMsg(r?.sent ? `Sent to ${r.sent} device${r.sent > 1 ? 's' : ''} ✓` : 'Nothing sent — turn alerts on first');
    load();
  }

  const s = data?.snapshot;
  const cashColour = s?.cash?.status === 'ok' ? 'var(--color-success)' : s?.cash?.status === 'missing' || s?.cash?.status === 'no-float' ? 'var(--color-warning)' : 'var(--color-danger)';

  return (
    <div className="flex flex-col gap-3" style={{ padding: '4px 2px 12px' }}>
      {!s ? (
        <div className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>Loading this morning’s snapshot…</div>
      ) : (
        <>
          <div className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
            {s.todayLabel}{s.weather ? ` · ${s.weather}` : ''}{s.shift ? ` · You: ${s.shift}` : ''}
          </div>

          {s.focus && (
            <div style={{ ...box, borderLeft: '4px solid var(--color-brand-peach)' }}>
              <div style={label}>Today’s focus</div>
              <div className="text-[15px] font-semibold" style={{ marginTop: 4 }}>{s.focus}</div>
            </div>
          )}

          {s.alerts.length > 0 && (
            <div style={{ ...box, borderLeft: '4px solid var(--color-danger)' }}>
              <div style={label}>Needs attention</div>
              {s.alerts.map(a => <div key={a} className="text-sm" style={{ marginTop: 4 }}>⚠️ {a}</div>)}
            </div>
          )}

          <div style={box}>
            <div style={label}>Today · {s.tasks.total} tasks{s.tasks.missed ? ` · ${s.tasks.missed} from before` : ''}</div>
            {s.tasks.top.map((t, i) => <div key={i} className="text-sm" style={{ marginTop: 4 }}>• {t}</div>)}
          </div>

          {s.sales && (
            <div style={box}>
              <div style={label}>Yesterday’s sales</div>
              <div className="flex items-baseline gap-2" style={{ marginTop: 4 }}>
                <span className="text-2xl font-bold tabular-nums">{money(s.sales.gross)}</span>
                <span className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>{s.sales.orders} orders · incl GST</span>
              </div>
              <div className="text-sm tabular-nums" style={{ marginTop: 2 }}>
                {[signed(s.sales.lyPct, 'vs same day last year'), signed(s.sales.avg4Pct, 'vs last 4 weeks')].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
          )}

          {s.cash && (
            <div style={box}>
              <div style={label}>Yesterday’s cash-up</div>
              <div className="text-sm tabular-nums" style={{ marginTop: 4 }}>
                Square cash {money(s.cash.square)}{s.cash.counted != null && s.cash.status !== 'no-float' ? ` · Counted ${money(s.cash.counted)}` : ''}
              </div>
              <div className="text-sm font-bold" style={{ color: cashColour, marginTop: 2 }}>
                {s.cash.status === 'ok' && 'Balanced ✓'}
                {s.cash.status === 'missing' && 'No count entered'}
                {s.cash.status === 'no-float' && 'Set your float below to check this'}
                {(s.cash.status === 'short' || s.cash.status === 'over') && `${s.cash.status === 'short' ? 'Short' : 'Over'} ${money(Math.abs(s.cash.variance || 0))}`}
              </div>
            </div>
          )}
        </>
      )}

      <div style={box}>
        <div style={label}>Tonight’s cash-up</div>
        <div className="text-xs" style={{ color: 'var(--color-ink-muted)', marginTop: 4 }}>
          Total cash in the till at close, float included.{data?.cash.todayCount != null ? ` Entered today: ${money(data.cash.todayCount)}.` : ''}
        </div>
        <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
          <input inputMode="decimal" placeholder="$ till count" value={count} onChange={e => setCount(e.target.value)} style={input} />
          <button style={btn} disabled={!count} onClick={() => saveCash({ counted: Number(count.replace(/[$,]/g, '')) })}>Save</button>
        </div>
        {editFloat ? (
          <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
            <input inputMode="decimal" placeholder="$ float" value={floatVal} onChange={e => setFloatVal(e.target.value)} style={input} />
            <button style={btn} disabled={!floatVal} onClick={() => saveCash({ float: Number(floatVal.replace(/[$,]/g, '')) })}>Set float</button>
          </div>
        ) : (
          <div className="text-xs" style={{ color: 'var(--color-ink-muted)', marginTop: 8 }} onClick={() => setEditFloat(true)}>
            Float {money(data?.cash.float ?? 0)} · <u>change</u>
          </div>
        )}
      </div>

      <div style={box}>
        <div style={label}>Phone alerts</div>
        {pushState === 'unsupported' && <div className="text-sm" style={{ marginTop: 4 }}>Open Tiger OS from your home-screen icon to turn on alerts.</div>}
        {pushState === 'off' && <button style={{ ...btn, marginTop: 8 }} onClick={enablePush}>Turn on 5am alerts</button>}
        {pushState === 'on' && (
          <div className="flex items-center gap-3" style={{ marginTop: 6 }}>
            <span className="text-sm">On — arrives 5–6am daily</span>
            <button style={btn} onClick={sendTest}>Send test</button>
          </div>
        )}
      </div>

      {msg && <div className="text-sm font-semibold" style={{ color: 'var(--color-ink-label)' }}>{msg}</div>}
    </div>
  );
}
