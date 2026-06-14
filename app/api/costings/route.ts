import { NextResponse } from 'next/server';
import { notionFetch } from '@/app/lib/notion';

const COSTINGS_DB_ID = '8f16358a47e54062b5fe1ce7a7480754';
const REVIEW_DAYS = 60;

export async function GET() {
  // Paginate through all results (Notion caps at 100 per page)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allResults: any[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      sorts: [{ property: 'Category', direction: 'ascending' }, { property: 'Name', direction: 'ascending' }],
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const data = await notionFetch(`/databases/${COSTINGS_DB_ID}/query`, 'POST', body);
    allResults.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  const today = new Date();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const products = allResults.map((p: any) => {
    const name = p.properties.Name?.title?.[0]?.plain_text || 'Untitled';
    const category = p.properties.Category?.select?.name || 'Uncategorised';
    const cost = p.properties.Cost?.number ?? null;
    const sellPrice = p.properties['Sell Price']?.number ?? null;
    // Profit % is synced directly by GAS — use it as primary source
    const profitPct = p.properties['Profit %']?.number ?? null;
    const lastReviewedStr = p.properties['Last Reviewed']?.date?.start ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notes = (p.properties.Notes?.rich_text || []).map((r: any) => r.plain_text).join('');
    // Use profitPct if available, fall back to calculating from cost/sellPrice
    const margin = profitPct !== null ? profitPct
      : (cost !== null && sellPrice !== null && sellPrice > 0 ? ((sellPrice - cost) / sellPrice) * 100 : null);
    const marginDollar = sellPrice !== null && margin !== null ? sellPrice * (margin / 100) : null;
    let daysSinceReview: number | null = null;
    let needsReview = true;
    if (lastReviewedStr) {
      const lastReviewed = new Date(lastReviewedStr);
      daysSinceReview = Math.floor((today.getTime() - lastReviewed.getTime()) / (1000 * 60 * 60 * 24));
      needsReview = daysSinceReview > REVIEW_DAYS;
    }
    return { id: p.id, name, category, cost, sellPrice, profitPct, margin, marginDollar, lastReviewedStr, daysSinceReview, needsReview, notes };
  });
  return NextResponse.json({ products });
}
