import { NextResponse } from 'next/server';

// Retired 22 Oct 2026 — counted cash now comes straight from the staff's weekly
// cash-up sheets in Drive (Apps Script MorningBrief.gs), so there's no manual entry.
export async function GET() {
  return NextResponse.json({ retired: true }, { status: 410 });
}
