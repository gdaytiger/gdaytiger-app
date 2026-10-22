import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { readOsBlock, writeOsBlock } from '@/app/lib/osBlocks';
import type { PushSubscriptionJSON } from '@/app/lib/webpush';

// Stores browser push subscriptions in the `push_subs` Notion block.
// GET → the VAPID public key the browser needs to subscribe.

export async function GET() {
  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const sub = (await req.json().catch(() => null)) as PushSubscriptionJSON | null;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return NextResponse.json({ error: 'Bad subscription' }, { status: 400 });
  const cur = await readOsBlock<{ subs: PushSubscriptionJSON[] }>('push_subs');
  const subs = (cur?.subs || []).filter(s => s.endpoint !== sub.endpoint);
  subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  await writeOsBlock('push_subs', { subs: subs.slice(-5) });
  return NextResponse.json({ ok: true, devices: Math.min(subs.length, 5) });
}
