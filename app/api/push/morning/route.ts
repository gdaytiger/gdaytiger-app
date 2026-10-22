import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { readOsBlock, writeOsBlock } from '@/app/lib/osBlocks';
import { sendPush, type PushSubscriptionJSON } from '@/app/lib/webpush';
import { buildMorning, pushText, saveSnapshot } from '@/app/lib/morning';
import { melbNowDate } from '@/app/lib/melbTime';
import { writeBankingTally } from '@/app/lib/banking';

// 5am morning push.
//  GET  — Vercel cron (Authorization: Bearer CRON_SECRET). Two UTC schedules
//         cover AEDT/AEST; only the one landing in Melbourne's 5am hour sends.
//  POST — "Send test" button in the Morning card (session-authed), sends now.

export const maxDuration = 60;

async function run(origin: string) {
  const snap = await buildMorning(origin, true);
  await saveSnapshot(snap);
  const banking = snap.cash?.week?.complete ? await writeBankingTally(snap.cash.week).catch(e => `error: ${e}`) : 'not monday';
  const { title, body } = pushText(snap);
  const cur = await readOsBlock<{ subs: PushSubscriptionJSON[] }>('push_subs');
  const subs = cur?.subs || [];
  const results = await Promise.all(subs.map(s => sendPush(s, { title, body, url: '/?open=morning' }).catch(() => 0)));
  const alive = subs.filter((_, i) => results[i] !== 404 && results[i] !== 410);
  if (alive.length !== subs.length) await writeOsBlock('push_subs', { subs: alive });
  return { sent: results.filter(r => r >= 200 && r < 300).length, devices: subs.length, results, title, body, banking };
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const hour = melbNowDate().getUTCHours();
  if (hour !== 5 && req.nextUrl.searchParams.get('force') !== '1') {
    return NextResponse.json({ skipped: `Melbourne hour is ${hour}, not 5` });
  }
  return NextResponse.json(await run(req.nextUrl.origin));
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  return NextResponse.json(await run(req.nextUrl.origin));
}
