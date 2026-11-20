import { NextRequest, NextResponse, after } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { getStateBlock, cleanOldDates, setChecked } from '@/app/lib/checkedState';
import { onTaskToggled } from '@/app/lib/documentTask';

// Read/write logic lives in app/lib/checkedState.ts (shared with THE DOCUMENT's monthly task).

export async function GET() {
  const { state } = await getStateBlock();
  return NextResponse.json({ state: cleanOldDates(state) });
}

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { blockId, blockIds, date, checked } = await req.json();
  // Accept a batch (blockIds) so multi-task actions like "Add all" are one
  // read-modify-write instead of N racing writes to the same code block.
  const ids: string[] = Array.isArray(blockIds) ? blockIds : [blockId];
  const result = await setChecked(date, ids, checked);
  if (!result.success && result.error === 'Notion write failed') return NextResponse.json(result, { status: 502 });
  // Ticking / unticking the monthly "SETTLE THE DOCUMENT" task settles / un-settles THE DOCUMENT.
  if (result.success && date === '_sticky_done') {
    after(() => onTaskToggled(ids, checked).catch(e => console.error('document task toggle failed', e)));
  }
  return NextResponse.json(result);
}
