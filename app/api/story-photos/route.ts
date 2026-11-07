import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { callGbp } from '@/app/lib/gbp';

// Story Maker photo library — same Drive pool as the Google tile (Paul's gallery).
//   { action: 'browse', set?, page?, random? } → GBP storyBrowse (24 thumbs per page, by set; random → 5 at random)
//   { action: 'image', id }           → GBP storyImage  (~1920px JPEG data URI)
// If the GBP script hasn't been updated with GbpStoryPhotos.js yet, browse falls
// back to the random picker (poolSuggest) so the widget still works, low-res.

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;

  let body: { action?: string; set?: unknown; page?: unknown; id?: unknown; random?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  if (body.action === 'browse') {
    const set = typeof body.set === 'string' ? body.set.slice(0, 200) : '';
    const page = typeof body.page === 'number' && body.page >= 0 ? Math.floor(body.page) : 0;
    const random = body.random === true;
    const r = await callGbp({ action: 'storyBrowse', set, page, pageSize: random ? 5 : 24, random });
    if (r.data.ok === false && /unknown action/i.test(String(r.data.error ?? ''))) {
      const f = await callGbp({ action: 'poolSuggest', count: 5 });
      if (f.data.ok === false) return NextResponse.json(f.data, { status: f.status });
      const photos = Array.isArray(f.data.photos) ? f.data.photos : [];
      return NextResponse.json({ ok: true, fallback: true, sets: [], photos, page: 0, pages: 1, total: photos.length });
    }
    return NextResponse.json(r.data, { status: r.status });
  }

  if (body.action === 'image') {
    const id = typeof body.id === 'string' && /^[\w-]{10,100}$/.test(body.id) ? body.id : '';
    if (!id) return NextResponse.json({ ok: false, error: 'bad photo id' }, { status: 400 });
    const r = await callGbp({ action: 'storyImage', id, size: 1920 });
    return NextResponse.json(r.data, { status: r.status });
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
}
