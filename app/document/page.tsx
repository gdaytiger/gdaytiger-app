'use client';

import { useEffect, useState } from 'react';
import { LogOut, ScrollText } from 'lucide-react';
import { glassStrongStyle, glassButtonStyle } from '@/app/lib/theme';
import TheDocumentCard from '@/app/components/TheDocumentCard';
import Greeting from '@/app/components/Greeting';
import WeatherLine from '@/app/components/WeatherLine';

// Standalone THE DOCUMENT page — the only screen the Isola Di Capri login can
// reach (proxy.ts redirects every other page here). Jonathan sees the same
// widget inside the dashboard launcher. Header deliberately matches the
// dashboard header exactly (TIGER OS / date / weather / greeting / logo).
export default function DocumentPage() {
  const [header, setHeader] = useState<{ dateStr: string; weather: string } | null>(null);

  useEffect(() => {
    fetch('/api/header').then(r => (r.ok ? r.json() : null)).then(d => { if (d?.dateStr) setHeader(d); }).catch(() => {});
  }, []);

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen text-gray-900 dashboard-unbold" style={{ background: 'linear-gradient(135deg, #e8eeff 0%, #fff8f0 40%, #f0fdf4 100%)' }}>
      <div style={{ position: 'fixed', top: '-10%', right: '-5%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(251,146,60,0.18) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '-10%', left: '-5%', width: '500px', height: '500px', background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: '40%', left: '30%', width: '300px', height: '300px', background: 'radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />

      <div className="max-w-5xl mx-auto px-5 pt-8 pb-4 flex items-center justify-between relative">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-gray-900" style={{ fontFamily: '"bodoni-pt-variable", "Bodoni 72", "Bodoni MT", Georgia, serif', fontWeight: 700, fontStyle: 'italic', fontVariationSettings: "'opsz' 18, 'wght' 700" }}>
            TIGER <span style={{ color: 'var(--color-brand-peach)' }}>OS</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest" style={{ fontFamily: '"stolzl", sans-serif', minHeight: '1rem' }}>{header?.dateStr ?? ''}</p>
          <p className="text-xs text-gray-400 mt-0.5 uppercase tracking-widest" style={{ fontFamily: '"stolzl", sans-serif', minHeight: '1rem' }}>{header ? <WeatherLine text={header.weather} /> : null}</p>
          <Greeting className="text-xs text-gray-500 mt-1 uppercase tracking-widest" style={{ fontFamily: '"stolzl", sans-serif' }} />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="G'Day Tiger" style={{ width: '56px', height: '56px', objectFit: 'contain', flexShrink: 0, filter: 'drop-shadow(0px 4px 12px rgba(0,0,0,0.3))' }} />
      </div>

      <div className="max-w-5xl mx-auto px-5 pb-10 relative flex flex-col gap-4">
        <div className="rounded-3xl p-5" style={glassStrongStyle}>
          <div className="flex items-center gap-2 mb-4">
            <ScrollText size={17} strokeWidth={2} aria-hidden style={{ color: 'var(--color-ink-label)' }} />
            <span className="text-xs font-bold tracking-widest uppercase" style={{ fontFamily: '"stolzl", sans-serif', fontWeight: 700, color: 'var(--color-ink-label)' }}>The Document</span>
          </div>
          <TheDocumentCard />
        </div>
        <button type="button" onClick={logout} className="self-center" style={glassButtonStyle} aria-label="Log out">
          <LogOut size={13} strokeWidth={2.25} aria-hidden /> LOG OUT
        </button>
      </div>
    </div>
  );
}
