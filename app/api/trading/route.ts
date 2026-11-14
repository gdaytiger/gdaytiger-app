import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

// GET — the Day Trader Scan feed (owner only). Proxies the "Day Trader Scan" Apps Script
// web app (~/Documents/day-trader/google-apps-script, its own Google Sheet — not
// apps-script/). It runs a 09:46 New York opening-range-breakout scan + Time Machine each
// NYSE day and grades the picks after the close. ANALYSIS ONLY: nothing here can place orders.
// Env: TRADING_WEBAPP_URL (…/exec) + TRADING_SECRET (from setupFeed() in that script).

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const url = process.env.TRADING_WEBAPP_URL;
  const secret = process.env.TRADING_SECRET;
  if (!url || !secret) {
    return NextResponse.json({ ok: false, error: 'TRADING_WEBAPP_URL or TRADING_SECRET not configured' });
  }
  try {
    const upstream = await fetch(`${url}?secret=${encodeURIComponent(secret)}`, { cache: 'no-store' });
    const text = await upstream.text();
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ ok: false, error: 'Apps Script returned non-JSON' }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: `feed unreachable: ${String(e)}` }, { status: 502 });
  }
}
