import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { readOsBlock, writeOsBlock } from '@/app/lib/osBlocks';
import type { CashCounts } from '@/app/lib/morning';
import { melbNowDate } from '@/app/lib/melbTime';
import { formatYMD, shiftYMD } from '@/app/lib/dayTasks';

// Daily cash-up. Stores the till count (incl. float) per Melbourne date in the
// `cash_counts` Notion block. The 5am push compares (count − float) with the
// CASH tenders Square recorded that day (morning_brief block, Apps Script).

const KEEP_DAYS = 120;

async function load(): Promise<CashCounts> {
  const b = await readOsBlock<CashCounts>('cash_counts');
  return { float: b?.float ?? null, entries: b?.entries ?? {} };
}

export async function GET() {
  return NextResponse.json(await load());
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const data = await load();
  const today = formatYMD(melbNowDate());

  if (body.float != null) {
    const f = Number(body.float);
    if (!Number.isFinite(f) || f < 0 || f > 5000) return NextResponse.json({ error: 'Bad float' }, { status: 400 });
    data.float = Math.round(f * 100) / 100;
  }
  if (body.counted != null) {
    const c = Number(body.counted);
    const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today;
    if (!Number.isFinite(c) || c < 0 || c > 50000) return NextResponse.json({ error: 'Bad amount' }, { status: 400 });
    data.entries[date] = Math.round(c * 100) / 100;
  }
  const cutoff = shiftYMD(today, -KEEP_DAYS);
  for (const d of Object.keys(data.entries)) if (d < cutoff) delete data.entries[d];

  await writeOsBlock('cash_counts', data);
  return NextResponse.json(data);
}
