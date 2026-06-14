const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_VERSION = '2022-06-28';

// Shared Notion fetch with one retry on 5xx/429.
//
// Notion occasionally 502s / rate-limits during peak (Sunday) volume. Without a
// retry a single blip returns no `results`, which renders an *empty card*
// mid-service. This is the same retry the dashboard route already uses, lifted
// into one place so every data route (costings, price-drift, ingredient-prices)
// degrades gracefully instead of silently blanking.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function notionFetch(path: string, method = 'GET', body?: object): Promise<any> {
  let lastRes: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    });
    lastRes = res;
    if (res.ok || (res.status < 500 && res.status !== 429) || attempt === 1) {
      return res.json();
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return lastRes!.json();
}
