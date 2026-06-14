import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

// Proxies an invoice-price search to the shared AddProduct Apps Script Web App.
// Apps Script scans recent invoice PDFs across supplier folders for the keyword.
// Reuses the same env vars as /api/add-product.

export const maxDuration = 60; // invoice OCR across folders can be slow

type Body = { query?: string };

export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const url = process.env.ADD_PRODUCT_WEBAPP_URL;
  const secret = process.env.ADD_PRODUCT_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      { ok: false, error: 'ADD_PRODUCT_WEBAPP_URL or ADD_PRODUCT_SECRET not configured' },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const query = (body.query || '').toString().trim();
  if (query.length < 2) {
    return NextResponse.json({ ok: false, error: 'query must be at least 2 characters' }, { status: 400 });
  }

  try {
    const targetUrl = `${url}?secret=${encodeURIComponent(secret)}`;
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'searchInvoices', query }),
      cache: 'no-store',
    });
    const text = await upstream.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Apps Script returned non-JSON', raw: text.slice(0, 500) },
        { status: 502 },
      );
    }
    return NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'upstream call failed: ' + msg }, { status: 502 });
  }
}
