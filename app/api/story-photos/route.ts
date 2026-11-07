import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';
import { callGbp } from '@/app/lib/gbp';
import { isPhotoTag } from '@/app/lib/photoTags';

// Story Maker photo library — same Drive pool as the Google tile (Paul's gallery).
//   { action: 'browse', set?, cat?, page?, random? } → GBP storyBrowse (random → 5 at random; cat filters by tag)
//   { action: 'image', id }                          → GBP storyImage  (~1920px JPEG data URI)
//   { action: 'queue', exclude? }                    → GBP storyTagQueue (untagged photos for hand tagging)
//   { action: 'tag', tags: {id: CATEGORY} }          → GBP storyTag
//   { action: 'used', id }                           → GBP storyUse (photo went into a saved story → rests 30 days)
// If the GBP script hasn't been updated with GbpStoryPhotos.js yet, browse falls
// back to the random picker (poolSuggest) so the widget still works, low-res.

export const maxDuration = 60;

const ID_RE = /^[\w-]{10,100}$/;

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;

  let body: { action?: string; set?: unknown; cat?: unknown; page?: unknown; id?: unknown; random?: unknown; exclude?: unknown; tags?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  if (body.action === 'browse') {
    const set = typeof body.set === 'string' ? body.set.slice(0, 200) : '';
    const cat = isPhotoTag(body.cat) ? body.cat : '';
    const page = typeof body.page === 'number' && body.page >= 0 ? Math.floor(body.page) : 0;
    const random = body.random === true;
    const r = await callGbp({ action: 'storyBrowse', set, cat, page, pageSize: random ? 5 : 24, random });
    if (r.data.ok === false && /unknown action/i.test(String(r.data.error ?? ''))) {
      const f = await callGbp({ action: 'poolSuggest', count: 5 });
      if (f.data.ok === false) return NextResponse.json(f.data, { status: f.status });
      const photos = Array.isArray(f.data.photos) ? f.data.photos : [];
      return NextResponse.json({ ok: true, fallback: true, sets: [], photos, page: 0, pages: 1, total: photos.length });
    }
    return NextResponse.json(r.data, { status: r.status });
  }

  if (body.action === 'image') {
    const id = typeof body.id === 'string' && ID_RE.test(body.id) ? body.id : '';
    if (!id) return NextResponse.json({ ok: false, error: 'bad photo id' }, { status: 400 });
    const r = await callGbp({ action: 'storyImage', id, size: 1920 });
    return NextResponse.json(r.data, { status: r.status });
  }

  if (body.action === 'queue') {
    const exclude = Array.isArray(body.exclude) ? body.exclude.filter((x): x is string => typeof x === 'string' && ID_RE.test(x)).slice(0, 100) : [];
    const r = await callGbp({ action: 'storyTagQueue', count: 6, size: 600, exclude });
    return NextResponse.json(r.data, { status: r.status });
  }

  if (body.action === 'used') {
    const id = typeof body.id === 'string' && ID_RE.test(body.id) ? body.id : '';
    if (!id) return NextResponse.json({ ok: false, error: 'bad photo id' }, { status: 400 });
    const r = await callGbp({ action: 'storyUse', id });
    return NextResponse.json(r.data, { status: r.status });
  }

  if (body.action === 'tag') {
    const tags = cleanTags(body.tags);
    if (!Object.keys(tags).length) return NextResponse.json({ ok: false, error: 'no tags' }, { status: 400 });
    const r = await callGbp({ action: 'storyTag', tags });
    return NextResponse.json(r.data, { status: r.status });
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
}

function cleanTags(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, cat] of Object.entries(raw as Record<string, unknown>)) {
    if (ID_RE.test(id) && isPhotoTag(cat)) out[id] = cat;
    if (Object.keys(out).length >= 100) break;
  }
  return out;
}
