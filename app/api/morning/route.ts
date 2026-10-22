import { NextRequest, NextResponse } from 'next/server';
import { buildMorning, type MorningSnapshot } from '@/app/lib/morning';
import { readOsBlock } from '@/app/lib/osBlocks';

// Morning card data: a fresh snapshot (no AI call) + today's saved AI focus
// line from the 5am run.

export async function GET(req: NextRequest) {
  const [snap, prev] = await Promise.all([
    buildMorning(req.nextUrl.origin, false),
    readOsBlock<MorningSnapshot>('morning_snapshot'),
  ]);
  if (prev?.today === snap.today) snap.focus = prev.focus;
  return NextResponse.json({ snapshot: snap });
}
