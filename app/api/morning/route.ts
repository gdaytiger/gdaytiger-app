import { NextRequest, NextResponse } from 'next/server';
import { buildMorning, type MorningSnapshot, type CashCounts } from '@/app/lib/morning';
import { readOsBlocks } from '@/app/lib/osBlocks';

// Morning card data: a fresh snapshot (no AI call) + today's saved AI focus
// line from the 5am run + the cash-up block for the entry form.

export async function GET(req: NextRequest) {
  const [snap, saved] = await Promise.all([
    buildMorning(req.nextUrl.origin, false),
    readOsBlocks(['morning_snapshot', 'cash_counts']),
  ]);
  const prev = saved.morning_snapshot as unknown as MorningSnapshot | null;
  if (prev?.today === snap.today) snap.focus = prev.focus;
  const cc = (saved.cash_counts as unknown as CashCounts | null) || { float: null, entries: {} };
  return NextResponse.json({ snapshot: snap, cash: { float: cc.float, todayCount: cc.entries[snap.today] ?? null } });
}
