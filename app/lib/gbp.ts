// Shared types + upstream call for the Google Business Profile Apps Script
// web app (apps-script-gbp/). Mirrors the add-product pattern: secret as a
// query param, JSON body, Apps Script's 302 is followed by fetch.
//
// Env (Vercel):
//   GBP_WEBAPP_URL — the GBP Apps Script web app /exec URL
//   GBP_SECRET     — matches GBP_SECRET in that script's Script Properties

export type PendingReview = {
  name: string;          // accounts/…/locations/…/reviews/…
  reviewer: string;
  stars: number;
  comment: string;
  createTime: string;
  updateTime: string;
  draft: string;
  offMenu: string[];
};

export type GoogleReviewsPayload = {
  type: 'google_reviews';
  updated: string | null;
  average: number | null;
  total: number | null;
  exact?: number | null;
  counts?: Record<string, number> | null;
  nextShown?: number | null;
  toNext?: number | null;
  pending: PendingReview[];
  replied: { name: string; reviewer: string; stars: number | null; reply: string; at: string }[];
  error: string | null;
};

export type MenuSyncPayload = {
  type: 'google_menu_sync';
  updated: string;
  mode: 'preview' | 'live';
  changes: { item: string; from: number | null; to: number }[];
  unmatched: string[];
  applied?: boolean;
  error: string | null;
};

// tag: our photo tag (app/lib/photoTags.ts) if the photo has been tagged in Daily Story.
export type PoolPhoto = { id: string; name: string; set: string; thumb: string | null; tag?: string | null };

export type PoolSuggestion = {
  ok: boolean;
  photos: PoolPhoto[];
  remaining: number;
  poolSize: number;
  lastUploadAt: string | null;
  error?: string;
};

export async function callGbp(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const url = process.env.GBP_WEBAPP_URL;
  const secret = process.env.GBP_SECRET;
  if (!url || !secret) {
    return { status: 500, data: { ok: false, error: 'GBP_WEBAPP_URL or GBP_SECRET not configured' } };
  }
  try {
    const res = await fetch(`${url}?secret=${encodeURIComponent(secret)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      return { status: data.ok === false ? 502 : 200, data };
    } catch {
      return { status: 502, data: { ok: false, error: 'Apps Script returned non-JSON', raw: text.slice(0, 300) } };
    }
  } catch (e) {
    return { status: 502, data: { ok: false, error: 'upstream call failed: ' + (e instanceof Error ? e.message : String(e)) } };
  }
}
