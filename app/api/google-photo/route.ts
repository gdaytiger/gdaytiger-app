import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { callGbp } from '@/app/lib/gbp';

// POST { category, mimeType, base64, description? } → GBP Apps Script uploads
// the photo to the Google Business Profile. The client shrinks the image to
// ≤2000px JPEG first, keeping the body well under Vercel's 4.5 MB limit.

const CATEGORIES = new Set(['FOOD_AND_DRINK', 'INTERIOR', 'EXTERIOR', 'TEAMS', 'AT_WORK', 'ADDITIONAL']);

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;

  let body: { category?: string; mimeType?: string; base64?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.base64) return NextResponse.json({ ok: false, error: 'no image' }, { status: 400 });
  if (!body.category || !CATEGORIES.has(body.category)) {
    return NextResponse.json({ ok: false, error: 'bad category' }, { status: 400 });
  }
  if (body.base64.length > 4_000_000) {
    return NextResponse.json({ ok: false, error: 'image too large' }, { status: 413 });
  }

  const { status, data } = await callGbp({
    action: 'photo',
    category: body.category,
    mimeType: body.mimeType || 'image/jpeg',
    base64: body.base64,
    description: body.description,
  });
  return NextResponse.json(data, { status });
}
