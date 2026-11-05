import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { readOsBlocks } from '@/app/lib/osBlocks';
import { callGbp, type GoogleReviewsPayload, type MenuSyncPayload } from '@/app/lib/gbp';

// GET  — pending Google reviews with Claude drafts (`google_reviews` block) and
//        the latest Square→Google menu price check (`google_menu_sync` block).
//        Both are written by the GBP Apps Script (apps-script-gbp/).
// POST — { action: 'reply' | 'redraft' | 'skip' | 'sync' | 'menuSync', … }
//        forwarded to the GBP web app. Replies only ever post from here, on a tap.

export async function GET() {
  const blocks = await readOsBlocks<Record<string, unknown>>(['google_reviews', 'google_menu_sync']);
  return NextResponse.json({
    reviews: (blocks.google_reviews as GoogleReviewsPayload | null) ?? null,
    menu: (blocks.google_menu_sync as MenuSyncPayload | null) ?? null,
  });
}

const ACTIONS = new Set(['reply', 'redraft', 'skip', 'sync', 'menuSync']);

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;

  let body: { action?: string; reviewName?: string; comment?: string; note?: string; apply?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.action || !ACTIONS.has(body.action)) {
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  }
  if ((body.action === 'reply' || body.action === 'redraft' || body.action === 'skip') && !body.reviewName) {
    return NextResponse.json({ ok: false, error: 'reviewName required' }, { status: 400 });
  }
  if (body.action === 'reply' && !body.comment?.trim()) {
    return NextResponse.json({ ok: false, error: 'reply text required' }, { status: 400 });
  }

  const { status, data } = await callGbp({
    action: body.action,
    reviewName: body.reviewName,
    comment: body.comment?.trim(),
    note: body.note,
    apply: body.apply === true,
  });
  return NextResponse.json(data, { status });
}
