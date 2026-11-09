import { NextRequest, NextResponse } from 'next/server';
import { readOsBlock, writeOsBlock } from '@/app/lib/osBlocks';
import { sendPush, type PushSubscriptionJSON } from '@/app/lib/webpush';

// Push from the GBP Apps Script (e.g. "a review was removed").
// No session cookie — authorised by the shared GBP_SECRET in the x-gbp-secret header.
// Tapping the notification opens TigerOS on the Google tile.

export async function POST(req: NextRequest) {
  const secret = process.env.GBP_SECRET;
  if (!secret || req.headers.get('x-gbp-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { title?: string; body?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const title = String(body.title || 'Google').slice(0, 80);
  const text = String(body.body || '').slice(0, 240);

  const cur = await readOsBlock<{ subs: PushSubscriptionJSON[] }>('push_subs');
  const subs = cur?.subs || [];
  const results = await Promise.all(subs.map(s => sendPush(s, { title, body: text, url: '/?open=google' }).catch(() => 0)));
  const alive = subs.filter((_, i) => results[i] !== 404 && results[i] !== 410);
  if (alive.length !== subs.length) await writeOsBlock('push_subs', { subs: alive });
  return NextResponse.json({ sent: results.filter(r => r >= 200 && r < 300).length, devices: subs.length });
}
