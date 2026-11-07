'use client';

import { LogOut, ScrollText } from 'lucide-react';
import { glassStrongStyle, glassButtonStyle } from '@/app/lib/theme';
import TheDocumentCard from '@/app/components/TheDocumentCard';
import Greeting from '@/app/components/Greeting';

// Standalone THE DOCUMENT page — the only screen the Isola Di Capri login can
// reach (proxy.ts redirects every other page here). Jonathan sees the same
// widget inside the dashboard launcher.
export default function DocumentPage() {
  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen text-gray-900 px-4 py-6 md:py-10" style={{ background: 'linear-gradient(135deg, #e8eeff 0%, #fff8f0 40%, #f0fdf4 100%)' }}>
      <div className="max-w-2xl mx-auto flex flex-col gap-5">
        <div className="flex items-center gap-3 px-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" aria-hidden style={{ width: 30, height: 30, objectFit: 'contain' }} />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight leading-none" style={{ fontFamily: '"bodoni-pt-variable", "Bodoni 72", "Bodoni MT", Georgia, serif', fontStyle: 'italic' }}>
              THE <span style={{ color: 'var(--color-brand-peach)' }}>DOCUMENT</span>
            </h1>
            <p className="text-xs text-gray-400 mt-1">G&apos;Day Tiger × Isola Di Capri</p>
            <Greeting className="text-xs text-gray-500 mt-1 uppercase tracking-widest" style={{ fontFamily: '"stolzl", sans-serif' }} />
          </div>
          <button type="button" onClick={logout} style={glassButtonStyle} aria-label="Log out">
            <LogOut size={13} strokeWidth={2.25} aria-hidden /> LOG OUT
          </button>
        </div>
        <div className="rounded-3xl p-5" style={glassStrongStyle}>
          <div className="flex items-center gap-2 mb-4">
            <ScrollText size={17} strokeWidth={2} aria-hidden style={{ color: 'var(--color-ink-label)' }} />
            <span className="text-xs font-bold tracking-widest uppercase" style={{ fontFamily: '"stolzl", sans-serif', fontWeight: 700, color: 'var(--color-ink-label)' }}>The Document</span>
          </div>
          <TheDocumentCard />
        </div>
      </div>
    </div>
  );
}
