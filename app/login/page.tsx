'use client';

import { glassButtonStyle, glassButtonPrimaryStyle } from '@/app/lib/theme';

import { useRef, useState } from 'react';

// Owner: leave Username blank (or anything) + the usual password.
// Isola Di Capri: their username + password → THE DOCUMENT only.
export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Read the fields directly so iOS/Safari autofill (which doesn't always fire
    // onChange) still works — don't trust React state alone.
    const pw = inputRef.current?.value || password;
    const user = userRef.current?.value || username;
    if (!pw.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pw }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        window.location.href = data.redirect || '/';
      } else {
        setError('Incorrect username or password');
        setSubmitting(false);
      }
    } catch {
      setError('Something went wrong — try again');
      setSubmitting(false);
    }
  };

  const fieldClass = 'w-full text-sm px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 text-center text-gray-800';
  const fieldStyle = { background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)' };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: 'linear-gradient(135deg, #e8eeff 0%, #fff8f0 40%, #f0fdf4 100%)' }}>
      <form onSubmit={submit} className="w-full max-w-xs flex flex-col items-center gap-3">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 mb-2" style={{ fontFamily: '"bodoni-pt-variable", "Bodoni 72", "Bodoni MT", Georgia, serif', fontWeight: 700, fontStyle: 'italic' }}>
          TIGER <span style={{ color: 'var(--color-brand-peach)' }}>OS</span>
        </h1>
        <input
          ref={userRef}
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={fieldClass}
          style={fieldStyle}
        />
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          className={fieldClass}
          style={fieldStyle}
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full disabled:opacity-40 mt-2"
          style={{ ...glassButtonStyle, ...glassButtonPrimaryStyle, width: '100%' }}
        >
          {submitting ? '…' : 'Enter'}
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </form>
    </div>
  );
}
