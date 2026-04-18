'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError('Wrong password. Try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{
      background: 'linear-gradient(135deg, #e8eeff 0%, #fff8f0 40%, #f0fdf4 100%)',
    }}>
      {/* Decorative blobs */}
      <div style={{
        position: 'fixed', top: '-10%', right: '-5%', width: '400px', height: '400px',
        background: 'radial-gradient(circle, rgba(251,146,60,0.18) 0%, transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'fixed', bottom: '-10%', left: '-5%', width: '500px', height: '500px',
        background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
        borderRadius: '50%', pointerEvents: 'none',
      }} />

      <div style={{
        background: 'rgba(255, 255, 255, 0.45)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.7)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
      }} className="rounded-3xl p-8 w-full max-w-sm flex flex-col gap-6 relative">

        <div className="flex flex-col items-center gap-3">
          <img src="/logo.png" alt="G'Day Tiger" style={{ width: '64px', height: '64px', objectFit: 'contain', filter: 'drop-shadow(0px 4px 12px rgba(0,0,0,0.3))' }} />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900" style={{ fontFamily: '"bodoni-pt-variable", "Bodoni 72", "Bodoni MT", Georgia, serif', fontWeight: 700, fontVariationSettings: "'opsz' 18, 'wght' 700" }}>
              TIGER <span style={{ color: '#fbcdad' }}>OS</span>
            </h1>
            <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest" style={{ fontFamily: '"stolzl", sans-serif' }}>Enter password to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.1)' }}
            className="w-full rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-200 transition-all"
          />
          {error && <p className="text-xs text-red-400 text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40"
            style={{ background: '#fbcdad', color: '#333' }}
          >
            {loading ? 'Checking...' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}
