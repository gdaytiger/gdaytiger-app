import { NextRequest, NextResponse } from 'next/server';
import { getRole, displayName } from '@/app/lib/auth';

// Who's logged in — drives the "Good morning, Jono / Claudio" greeting.
export async function GET(req: NextRequest) {
  const role = getRole(req);
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ role, name: displayName(role) });
}
