import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

// Adds a custom ingredient (chosen from an invoice match) to the dynamic
// CustomIngredients tab via the shared AddProduct Apps Script Web App, which
// then re-syncs ingredient prices to Notion. Reuses /api/add-product env vars.

export const maxDuration = 60; // Apps Script also runs a full price-sync after writing

type Body = {
  name?: string;
  price?: number;
  unit?: string;
  supplier?: string;
  type?: 'food' | 'coffee';   // which costing sheet
  category?: string;          // which category column within that sheet
  sig?: string;               // unmapped-SKU id, when added from a NEW SKU prompt
};

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

  const name = (body.name || '').toString().trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
  }
  if (typeof body.price !== 'number' || body.price <= 0) {
    return NextResponse.json({ ok: false, error: 'price must be a positive number' }, { status: 400 });
  }
  const type = body.type === 'coffee' ? 'coffee' : 'food';
  const category = (body.category || '').toString().trim();
  if (!category) {
    return NextResponse.json({ ok: false, error: 'category required' }, { status: 400 });
  }

  try {
    const targetUrl = `${url}?secret=${encodeURIComponent(secret)}`;
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'addCustomIngredient',
        name,
        price: body.price,
        unit: (body.unit || 'unit').toString().trim() || 'unit',
        supplier: (body.supplier || 'Other').toString().trim() || 'Other',
        type,
        category,
        sig: (body.sig || '').toString(),
      }),
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
