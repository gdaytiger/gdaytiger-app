'use client';

import { useEffect, useState } from 'react';

// "Good morning / afternoon / evening, <name>" — name from whoever is logged in
// (Jono or the Isola login), time of day in Melbourne. Re-checks every minute.
// Morning to 11:59, afternoon to 4:59pm, evening from 5pm.
const hourFmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', hourCycle: 'h23' });
const partOfDay = () => {
  const h = Number(hourFmt.format(new Date()));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
};

export default function Greeting({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const [name, setName] = useState<string | null>(null);
  const [part, setPart] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/whoami').then(r => (r.ok ? r.json() : null)).then(d => {
      if (d?.name) { setName(d.name); setPart(partOfDay()); }
    }).catch(() => {});
    const t = setInterval(() => setPart(partOfDay()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!name || !part) return null;
  return <p className={className} style={style}>Good {part}, {name}</p>;
}
