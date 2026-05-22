'use client';

import { useState } from 'react';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = '/';
      } else {
        setError('Incorrect password');
        setSubmitting(false);
      }
    } catch {
      setError('Something went wrong — try again');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: 'linear-gradient(135deg, #e8eeff 0%, #fff8f0 40%, #f0fdf4 100%)' }}>
      <form onSubmit={submit} className="w-full max-w-xs flex flex-col items-center gap-5">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900" style={{ fontFamily: '"bodoni-pt-variable", "Bodoni 72", "Bodoni MT", Georgia, serif', fontWeight: 700, fontStyle: 'italic' }}>
          TIGER <span style={{ color: '#fbcdad' }}>OS</span>
        </h1>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          className="w-full text-sm px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-center text-gray-800"
          style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)' }}
        />
        <button
          type="submit"
          disabled={submitting || !password.trim()}
          className="w-full text-xs uppercase tracking-widest px-5 py-3 rounded-xl font-semibold disabled:opacity-40"
          style={{ background: '#fbcdad', color: '#333' }}
        >
          {submitting ? '…' : 'Enter'}
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </form>
    </div>
  );
}
