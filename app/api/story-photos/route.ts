import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireSession } from '@/app/lib/auth';
import { callGbp } from '@/app/lib/gbp';

// Story Maker photo library — same Drive pool as the Google tile (Paul's gallery).
//   { action: 'browse', set?, cat?, page?, random? } → GBP storyBrowse (random → 5 at random; cat filters by tag)
//   { action: 'image', id }                          → GBP storyImage  (~1920px JPEG data URI)
//   { action: 'queue', exclude? }                    → GBP storyTagQueue (untagged photos for hand tagging)
//   { action: 'tag', tags: {id: CATEGORY} }          → GBP storyTag
//   { action: 'autotag' }                            → Claude tags up to 8 untagged photos, saved via storyTag
// If the GBP script hasn't been updated with GbpStoryPhotos.js yet, browse falls
// back to the random picker (poolSuggest) so the widget still works, low-res.

export const maxDuration = 60;

// Google Business Profile photo categories — same set the Google tab posts with.
const CATS = ['FOOD_AND_DRINK', 'INTERIOR', 'EXTERIOR', 'TEAMS', 'AT_WORK', 'ADDITIONAL'] as const;
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
    const cat = typeof body.cat === 'string' && (CATS as readonly string[]).includes(body.cat) ? body.cat : '';
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

  if (body.action === 'tag') {
    const tags = cleanTags(body.tags);
    if (!Object.keys(tags).length) return NextResponse.json({ ok: false, error: 'no tags' }, { status: 400 });
    const r = await callGbp({ action: 'storyTag', tags });
    return NextResponse.json(r.data, { status: r.status });
  }

  if (body.action === 'autotag') {
    const q = await callGbp({ action: 'storyTagQueue', count: 8, size: 400 });
    if (q.data.ok === false) return NextResponse.json(q.data, { status: q.status });
    if (q.data.auto !== true) return NextResponse.json({ ok: false, error: 'auto-tagging starts once the backlog is tagged by hand' }, { status: 409 });
    const photos = (Array.isArray(q.data.photos) ? q.data.photos : []) as { id: string; thumb: string | null }[];
    const withThumbs = photos.filter(p => typeof p.thumb === 'string' && p.thumb.startsWith('data:image/'));
    if (!withThumbs.length) return NextResponse.json({ ok: true, saved: 0, remaining: q.data.remaining ?? 0 });
    try {
      const tags = await classify(withThumbs as { id: string; thumb: string }[]);
      if (!Object.keys(tags).length) return NextResponse.json({ ok: false, error: 'Claude returned no tags' }, { status: 502 });
      const r = await callGbp({ action: 'storyTag', tags });
      return NextResponse.json({ ...r.data, tagged: tags }, { status: r.status });
    } catch (e) {
      console.error('story autotag failed:', e);
      const status = e instanceof Anthropic.APIError ? 502 : 500;
      return NextResponse.json({ ok: false, error: 'auto-tag failed' }, { status });
    }
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
}

function cleanTags(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, cat] of Object.entries(raw as Record<string, unknown>)) {
    if (ID_RE.test(id) && typeof cat === 'string' && (CATS as readonly string[]).includes(cat)) out[id] = cat;
    if (Object.keys(out).length >= 20) break;
  }
  return out;
}

// One vision request for the batch. Each image is preceded by a text label with its
// photo id so the answer can be mapped back; structured output keeps it parseable.
async function classify(photos: { id: string; thumb: string }[]): Promise<Record<string, string>> {
  const client = new Anthropic(); // ANTHROPIC_API_KEY from the Vercel env
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const p of photos) {
    const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/.exec(p.thumb);
    if (!m) continue;
    content.push({ type: 'text', text: `Photo id: ${p.id}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: m[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: m[2] } });
  }
  content.push({
    type: 'text',
    text: `These are photos from G'Day Tiger, a café. Put each photo in exactly one Google Business Profile category:
FOOD_AND_DRINK — food or drinks are the subject (coffee, sandwiches, pastries, cabinet shots).
INTERIOR — inside the café: the room, counter, seating, shelves, decor, with no food or person as the main subject.
EXTERIOR — the shopfront, signage or street outside.
TEAMS — staff posing or smiling for the camera, or customers as the subject.
AT_WORK — staff working: making coffee, cooking, serving, behind the machine.
ADDITIONAL — anything that fits none of the above.
Return one entry per photo id.`,
  });

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            photos: {
              type: 'array',
              items: {
                type: 'object',
                properties: { id: { type: 'string' }, category: { type: 'string', enum: [...CATS] } },
                required: ['id', 'category'],
                additionalProperties: false,
              },
            },
          },
          required: ['photos'],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') throw new Error('refused');
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text ?? '';
  const parsed = JSON.parse(text) as { photos?: { id: string; category: string }[] };
  const ids = new Set(photos.map(p => p.id));
  return cleanTags(Object.fromEntries((parsed.photos ?? []).filter(x => ids.has(x.id)).map(x => [x.id, x.category])));
}
