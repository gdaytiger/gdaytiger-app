import { NextResponse } from 'next/server';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const PROJECTS_DB_ID = 'f7712afe4c7247d7b1690f2e1ecc1a0d';
const NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';
const WEATHER_LAT = -38.4552;
const WEATHER_LNG = 145.2305;

const DAY_PAGES: Record<number, string> = {
  0: '3403c99c0e8581fa80d7ef629e63aa9c',
  1: '3403c99c0e858139bd34e9f3873dc7ef',
  2: '3403c99c0e858133bb31f63559b18716',
  3: '3403c99c0e85814fab17e09b32693999',
  4: '3403c99c0e8581a39fd1e3587887a1e0',
  5: '3403c99c0e858192bfa7d94c8189fe3c',
  6: '3403c99c0e8581b3a01dc82031df8f09',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notionFetch(path: string, method = 'GET', body?: object): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  return res.json();
}

async function getWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LNG}&daily=temperature_2m_max,weathercode&timezone=Australia/Melbourne&forecast_days=1`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    const temp = Math.round(data.daily.temperature_2m_max[0]);
    const code = data.daily.weathercode[0];
    const weatherMap: Record<number, [string, string]> = {
      0: ['Clear sky', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'],
      3: ['Overcast', '☁️'], 45: ['Foggy', '🌫️'], 51: ['Light drizzle', '🌦️'],
      61: ['Light rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
      80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 95: ['Thunderstorm', '⛈️'],
    };
    const [desc, emoji] = weatherMap[code] || ['Unknown', '🌡️'];
    return `${emoji} ${temp}° — ${desc}`;
  } catch {
    return '🌡️ Weather unavailable';
  }
}

// Returns ISO week number for a given date
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Auto-delete a stale Notion block (fire-and-forget)
function deleteBlock(blockId: string) {
  fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
  }).catch(() => {});
}

const DATE_PREFIX_RE = /^\[(\d{4}-\d{2}-\d{2})\]\s*/;

async function getDailyTasks(dayOfWeek: number, today: Date) {
  const pageId = DAY_PAGES[dayOfWeek];
  const data = await notionFetch(`/blocks/${pageId}/children?page_size=100`);

  const weekNum = getISOWeek(today);
  const isOddWeek = weekNum % 2 === 1;

  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type RawItem = { type: 'header' | 'task'; id: string; text: string };
  const rawItems: RawItem[] = [];

  for (const block of (data.results || [])) {
    // Category headings
    if (block.type === 'heading_2' || block.type === 'heading_3') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = (block[block.type]?.rich_text || []).map((r: any) => r.plain_text).join('').trim();
      if (text) rawItems.push({ type: 'header', id: block.id, text });
      continue;
    }

    if (block.type === 'bulleted_list_item') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (block.bulleted_list_item?.rich_text || []).map((r: any) => r.plain_text).join('');
      if (!raw.trim()) continue;

      const dateMatch = raw.match(DATE_PREFIX_RE);
      if (dateMatch) {
        const taskDate = dateMatch[1];
        if (taskDate < todayStr) { deleteBlock(block.id); continue; }
        if (taskDate === todayStr) rawItems.push({ type: 'task', id: block.id, text: raw.replace(DATE_PREFIX_RE, '').trim() });
        continue;
      }
      if (raw.startsWith('[F]')) {
        if (!isOddWeek) continue;
        rawItems.push({ type: 'task', id: block.id, text: raw.replace('[F]', '').trim() });
        continue;
      }
      if (raw.startsWith('[M]')) {
        if (today.getDate() > 7) continue;
        rawItems.push({ type: 'task', id: block.id, text: raw.replace('[M]', '').trim() });
        continue;
      }
      rawItems.push({ type: 'task', id: block.id, text: raw.trim() });
    }
  }

  // Build final list — skip headers that have no tasks beneath them
  const tasks = [];
  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (item.type === 'header') {
      let hasTask = false;
      for (let j = i + 1; j < rawItems.length; j++) {
        if (rawItems[j].type === 'header') break;
        if (rawItems[j].type === 'task') { hasTask = true; break; }
      }
      if (hasTask) tasks.push({ id: `header-${item.id}`, text: item.text, checked: false, isHeader: true });
    } else {
      tasks.push({ id: item.id, text: item.text, checked: false });
    }
  }
  return tasks;
}

async function getProjects() {
  const data = await notionFetch(
    `/databases/${PROJECTS_DB_ID}/query`,
    'POST',
    {
      filter: { property: 'Status', select: { does_not_equal: 'Done' } },
      sorts: [{ property: 'Status', direction: 'ascending' }],
    }
  );
  const projects = [];
  for (const p of (data.results || [])) {
    const name = p.properties.Name?.title?.[0]?.plain_text || 'Untitled';
    const status = p.properties.Status?.select?.name || 'No Status';
    const childData = await notionFetch(`/blocks/${p.id}/children?page_size=10`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const todos = (childData.results || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((b: any) => b.type === 'to_do')
      .slice(0, 3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b: any) => ({
        id: b.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        text: (b.to_do?.rich_text || []).map((r: any) => r.plain_text).join(''),
        checked: b.to_do?.checked || false,
      }));
    projects.push({ id: p.id, name, status, todos });
  }
  return projects;
}

async function getPersonalTodos() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allBlocks: any[] = [];
  let cursor: string | undefined;
  do {
    const url = `/blocks/${NOTION_PAGE_ID}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const data = await notionFetch(url);
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  const todos = [];
  let inPersonal = false;
  for (const b of allBlocks) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (b[b.type]?.rich_text || []).map((r: any) => r.plain_text).join('');
    if (b.type === 'heading_2' && text.includes('PERSONAL')) { inPersonal = true; continue; }
    if (inPersonal && (b.type === 'heading_2' || b.type === 'heading_1')) break;
    if (inPersonal && b.type === 'to_do') {
      todos.push({ id: b.id, text, checked: b.to_do?.checked || false });
    }
  }
  return todos;
}

export async function GET() {
  const today = new Date(new Date().getTime() + 10 * 60 * 60 * 1000);
  const dayOfWeek = today.getDay();

  const [weather, dailyTasks, projects, personalTodos] = await Promise.all([
    getWeather(),
    getDailyTasks(dayOfWeek, today),
    getProjects(),
    getPersonalTodos(),
  ]);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const d = today.getDate();
  const ordinal = d + (['th', 'st', 'nd', 'rd'][(d % 100 > 10 && d % 100 < 14) ? 0 : (d % 10 < 4 ? d % 10 : 0)] || 'th');
  const dateStr = `${dayNames[dayOfWeek]} ${ordinal} ${monthNames[today.getMonth()]}`;

  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;

  return NextResponse.json({ dateStr, weather, dailyTasks, projects, personalTodos, todayStr });
}
