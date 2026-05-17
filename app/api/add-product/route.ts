import { NextRequest, NextResponse } from 'next/server';

// Calls the AddProduct Apps Script Web App, which writes the new section
// to the costings sheet + creates a Notion DB row + triggers buildRecipeMap.
//
// Required env vars:
//   ADD_PRODUCT_WEBAPP_URL — Apps Script Web App deployment URL
//                            (e.g. https://script.google.com/macros/s/AKfy.../exec)
//   ADD_PRODUCT_SECRET     — shared secret matching the Apps Script's
//                            Script Property of the same name

type IngredientInput = { key: string; qty: number };
type Variants = { milks?: string[]; sizes?: string[]; channels?: string[] };
type AddProductBody = {
  type: 'food' | 'coffee';
  name: string;
  retailPrice: number;
  ingredients: IngredientInput[];
  variants?: Variants;
};

export async function POST(req: NextRequest) {
  const url = process.env.ADD_PRODUCT_WEBAPP_URL;
  const secret = process.env.ADD_PRODUCT_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      { ok: false, error: 'ADD_PRODUCT_WEBAPP_URL or ADD_PRODUCT_SECRET not configured' },
      { status: 500 }
    );
  }

  let body: AddProductBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  // Validate
  if (body.type !== 'food' && body.type !== 'coffee') {
    return NextResponse.json({ ok: false, error: 'type must be food or coffee' }, { status: 400 });
  }
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
  }
  if (!Array.isArray(body.ingredients) || body.ingredients.length === 0) {
    return NextResponse.json({ ok: false, error: 'at least one ingredient required' }, { status: 400 });
  }
  if (typeof body.retailPrice !== 'number' || body.retailPrice <= 0) {
    return NextResponse.json({ ok: false, error: 'retailPrice must be positive' }, { status: 400 });
  }

  try {
    // Apps Script Web Apps expect form-encoded params for the query string PLUS
    // a JSON body. We send `secret` as a query param and the payload as JSON.
    const targetUrl = `${url}?secret=${encodeURIComponent(secret)}`;
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Apps Script can take 5–15s on a slow run (sheet writes + Notion fetches +
      // recipe-map rebuild). Don't time out too aggressively.
      cache: 'no-store',
    });
    const text = await upstream.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Apps Script returned non-JSON', raw: text.slice(0, 500) },
        { status: 502 }
      );
    }
    if (!upstream.ok) {
      return NextResponse.json(data, { status: upstream.status });
    }
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: 'upstream call failed: ' + msg }, { status: 502 });
  }
}
