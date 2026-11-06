import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { callGbp } from '@/app/lib/gbp';

// Paul's gallery → Google photo picker. Forwards to the GBP Apps Script:
//   poolSuggest { exclude?: string[] }                      → 5 random unposted photos (with thumbnails)
//   poolUpload  { ids: string[], categories: Record<id,cat> } → posts them to the Business Profile
//   poolHide    { ids: string[] }                           → never suggest these again
// Nothing goes onto Google without a tap.

export const maxDuration = 60;

const ACTIONS = new Set(['poolSuggest', 'poolUpload', 'poolHide']);

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;

  let body: { action?: string; ids?: unknown; categories?: unknown; exclude?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.action || !ACTIONS.has(body.action)) {
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
  if ((body.action === 'poolUpload' || body.action === 'poolHide') && !ids.length) {
    return NextResponse.json({ ok: false, error: 'no photos chosen' }, { status: 400 });
  }
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
  const categories = body.categories && typeof body.categories === 'object' ? body.categories : {};

  const { status, data } = await callGbp({ action: body.action, ids, exclude, categories });
  return NextResponse.json(data, { status });
}
