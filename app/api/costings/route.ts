import { NextResponse } from 'next/server';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const COSTINGS_DB_ID = '8f16358a47e54062b5fe1ce7a7480754';
const REVIEW_DAYS = 60;

export async function GET() {
  const res = await fetch(`https://api.notion.com/v1/databases/${COSTINGS_DB_ID}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ sorts: [{ property: 'Category', direction: 'ascending' }, { property: 'Name', direction: 'ascending' }] }),
    cache: 'no-store',
  });
  const data = await res.json();
  const today = new Date();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const products = (data.results || []).map((p: any) => {
    const name = p.properties.Name?.title?.[0]?.plain_text || 'Untitled';
    const category = p.properties.Category?.select?.name || 'Uncategorised';
    const cost = p.properties.Cost?.number ?? null;
    const sellPrice = p.properties['Sell Price']?.number ?? null;
    const lastReviewedStr = p.properties['Last Reviewed']?.date?.start ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notes = (p.properties.Notes?.rich_text || []).map((r: any) => r.plain_text).join('');
    const margin = cost !== null && sellPrice !== null && sellPrice > 0 ? ((sellPrice - cost) / sellPrice) * 100 : null;
    const marginDollar = cost !== null && sellPrice !== null ? sellPrice - cost : null;
    let daysSinceReview: number | null = null;
    let needsReview = true;
    if (lastReviewedStr) {
      const lastReviewed = new Date(lastReviewedStr);
      daysSinceReview = Math.floor((today.getTime() - lastReviewed.getTime()) / (1000 * 60 * 60 * 24));
      needsReview = daysSinceReview > REVIEW_DAYS;
    }
    return { id: p.id, name, category, cost, sellPrice, margin, marginDollar, lastReviewedStr, daysSinceReview, needsReview, notes };
  });
  return NextResponse.json({ products });
}
