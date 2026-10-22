'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { MorningSnapshot } from '@/app/lib/morning';

// Morning card (opens from the TIGER OS header): the 5am snapshot — focus line,
// alerts, today's tasks, yesterday's sales — and the switch for phone alerts.
// The cash check lives on Monday's DO THE BANKING subtask, not here. Self-contained — fetches /api/morning, /api/push/*.

type MorningData = { snapshot: MorningSnapshot } | null;

const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
const signed = (n: number | null, suffix: string) => (n == null ? null : `${n >= 0 ? '+' : ''}${n}% ${suffix}`);
const label: React.CSSProperties = { fontFamily: '"stolzl", sans-serif', fontWeight: 700, fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-ink-label)' };
const box: React.CSSProperties = { background: 'rgba(255,255,255,0.55)', borderRadius: '16px', padding: '12px 14px' };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: '999px', background: 'var(--color-brand-peach)', color: '#333', fontWeight: 700, fontSize: '13px', border: 'none' };

function urlB64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export default function MorningCard({ active }: { active: boolean }) {
  const [data, setData] = useState<MorningData>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pushState, setPushState] = useState<'unknown' | 'unsupported' | 'off' | 'on'>('unknown');

  const load = useCallback(() => {
    fetch('/api/morning').then(r => r.json()).then((d: MorningData) => setData(d)).catch(() => {});
  }, []);

  useEffect(() => { if (active && !data) load(); }, [active, data, load]);

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window;
    (supported ? navigator.serviceWorker.getRegistration('/').then(reg => reg?.pushManager.getSubscription()) : Promise.reject(new Error('unsupported')))
      .then(sub => setPushState(sub ? 'on' : 'off'))
      .catch(() => setPushState(supported ? 'off' : 'unsupported'));
  }, []);

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
  // Cash alerts belong to Monday's banking subtask — keep them out of this card.
  const alerts = (s?.alerts || []).filter(x => !/cash/i.test(x));

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

          {alerts.length > 0 && (
            <div style={{ ...box, borderLeft: '4px solid var(--color-danger)' }}>
              <div style={label}>Needs attention</div>
              {alerts.map(a => <div key={a} className="text-sm" style={{ marginTop: 4 }}>⚠️ {a}</div>)}
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

        </>
      )}

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
