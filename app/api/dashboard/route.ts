import { NextResponse } from 'next/server';
import { DAY_PAGES, parseDayTaskBlocks, formatYMD, shiftYMD, STICKY_PREFIX_RE, isReviewPricingTask } from '@/app/lib/dayTasks';
import { melbNowDate } from '@/app/lib/melbTime';

// Permanent (never-expiring) key in the checked-state JSON for completed [STICKY]
// tasks. cleanOldDates() in /api/checked-state only strips keys that sort below
// today's date string — "_sticky_done" starts with "_" (charCode 95), which is
// greater than any digit (charCodes 48-57), so it always survives the cutoff
// comparison. No changes needed to the cleanup routine.
const STICKY_DONE_KEY = '_sticky_done';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const PROJECTS_DB_ID = 'f7712afe4c7247d7b1690f2e1ecc1a0d';
const NOTION_PAGE_ID = '3403c99c0e858113a941c2118b3cdef9';
const SHOPPING_PAGE_ID = '3683c99c0e8581c7b19cc2eec6b27b47';
const WEATHER_LAT = -38.4552;
const WEATHER_LNG = 145.2305;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notionFetch(path: string, method = 'GET', body?: object): Promise<any> {
  // One retry on 5xx/429 — Notion occasionally 502s during Sunday volume and
  // a single retry is enough to get past the blip without making the card
  // appear empty to the user.
  for (let attempt = 0; attempt < 2; attempt++) {
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
    if (res.ok || (res.status < 500 && res.status !== 429) || attempt === 1) {
      return res.json();
    }
    await new Promise(r => setTimeout(r, 500));
  }
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
      3: ['Overcast', '☁️'], 45: ['Foggy', '🌫️'], 48: ['Icy fog', '🌫️'],
      51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
      61: ['Light rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
      80: ['Light showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Heavy showers', '⛈️'],
      95: ['Thunderstorm', '⛈️'], 99: ['Thunderstorm', '⛈️'],
    };
    const [desc, emoji] = weatherMap[code] || ['Unknown', '🌡️'];
    return `${emoji} ${temp}° — ${desc}`;
  } catch {
    return '🌡️ Weather unavailable';
  }
}

// Both getCheckedState and getPersonalTodos need every block on the OS page —
// they used to each paginate it separately (2x the Notion calls for the same
// page on every dashboard load). Fetched once here and shared by both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOSPageBlocks(): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allBlocks: any[] = [];
  let cursor: string | undefined;
  do {
    const url = `/blocks/${NOTION_PAGE_ID}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const data = await notionFetch(url);
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return allBlocks;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCheckedState(allBlocks: any[]): Record<string, string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const codeBlock = allBlocks.find((b: any) => b.type === 'code' && b.code?.language === 'json');
  if (codeBlock) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (codeBlock.code?.rich_text || []).map((r: any) => r.plain_text).join('');
    try { return JSON.parse(text || '{}'); } catch { return {}; }
  }
  return {};
}

// Fetch raw [CARRY] and [STICKY] candidates from today + the past 6 days (7 pages,
// which between them cover all 7 DAY_PAGES regardless of which day "today" is).
// This has no dependency on checked state, so it runs inside the main Promise.all
// batch rather than as a serial step after it. The checked-state filtering happens
// in memory in GET() once both this and getCheckedState() have resolved.
//
// [CARRY] — resurfaces if unchecked within the ~8-day checked-state retention window.
// [STICKY] — persistent task; resurfaces every day until ticked off, with no expiry
// (completion is recorded permanently under the "_sticky_done" key, exempt from cleanup).
async function fetchCarryAndStickyCandidates(today: Date) {
  const pages = await Promise.all(
    Array.from({ length: 7 }, (_, i) => {
      const past = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      return notionFetch(`/blocks/${DAY_PAGES[past.getDay()]}/children?page_size=100`);
    })
  );

  const carry: { id: string; text: string; header: string }[] = [];
  const sticky: { id: string; text: string; header: string; startDate: string | null; projectId: string | null }[] = [];
  const seenIds = new Set<string>();

  for (const data of pages) {
    let currentHeader = 'ADMIN';
    for (const block of (data.results || [])) {
      if (block.type === 'heading_2' || block.type === 'heading_3') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentHeader = (block[block.type]?.rich_text || []).map((r: any) => r.plain_text).join('').trim();
        continue;
      }
      // Accept both bulleted_list_item and to_do (checkbox) blocks. The to_do.checked
      // flag is intentionally ignored — checked state lives in the JSON map keyed by date.
      let raw: string;
      if (block.type === 'bulleted_list_item') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        raw = (block.bulleted_list_item?.rich_text || []).map((r: any) => r.plain_text).join('');
      } else if (block.type === 'to_do') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        raw = (block.to_do?.rich_text || []).map((r: any) => r.plain_text).join('');
      } else {
        continue;
      }
      if (seenIds.has(block.id)) continue; // deduplicate across pages
      if (raw.startsWith('[CARRY]')) {
        seenIds.add(block.id);
        carry.push({ id: block.id, text: raw.replace('[CARRY]', '').trim(), header: currentHeader });
        continue;
      }
      const stickyMatch = raw.match(STICKY_PREFIX_RE);
      if (stickyMatch) {
        seenIds.add(block.id);
        sticky.push({ id: block.id, text: raw.replace(STICKY_PREFIX_RE, '').trim(), header: currentHeader, startDate: stickyMatch[1] || null, projectId: stickyMatch[2] || null });
      }
    }
  }
  // pages[1..6] are the previous 6 days' pages — reused by getMissedTasks() so
  // "Not completed yesterday" costs no extra Notion calls.
  return { carry, sticky, pastPages: pages.map(p => p?.results || []) };
}

// Key recording "not completed" tasks dismissed (✕) on a given day. Date-prefixed,
// so the normal 8-day cleanOldDates() routine clears it.
const carryHandledKey = (dateStr: string) => `${dateStr}:carry-handled`;
// How far back unticked tasks keep rolling forward (pages fetched = today + 6).
const MISSED_LOOKBACK_DAYS = 6;

// "Not completed yesterday": tasks that were on a past day's list in the last 6
// days and haven't been ticked since. They roll forward every day until ticked,
// dismissed (✕), moved, pinned, or they age out of the window. Ticking one today
// is stored under today's date like any task, so tomorrow it's gone.
//
// Pinned/[CARRY] tasks are skipped by the parser (they resurface on their own);
// shopping lives on another page; anything already on today's list is skipped.
function getMissedTasks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pastPages: any[][],
  today: Date,
  checkedState: Record<string, string[]>,
  todayTasks: { id: string; text: string; isHeader?: boolean }[],
) {
  const todayStr = formatYMD(today);
  const stickyDone = new Set(checkedState[STICKY_DONE_KEY] || []);
  const todayIds = new Set(todayTasks.filter(t => !t.isHeader).map(t => t.id));
  // [D]/[MD] tasks are mirrored as separate blocks per day page, so match on text too.
  const seenTexts = new Set(todayTasks.filter(t => !t.isHeader).map(t => t.text.trim().toLowerCase()));
  const seenIds = new Set<string>();

  // Was this id ticked on [fromStr, todayStr) or dismissed/moved on [fromStr, todayStr]?
  const resolvedSince = (id: string, fromStr: string) => {
    for (const [k, ids] of Object.entries(checkedState)) {
      if (!ids.includes(id)) continue;
      const date = k.slice(0, 10);
      if (date < fromStr) continue;
      if (k.length === 10 && date < todayStr) return true;           // ticked
      if (k.endsWith(':carry-handled') || k.endsWith(':moved')) return true; // dismissed / moved
    }
    return false;
  };

  const missed: { id: string; text: string; category: string; isRecurring: boolean }[] = [];
  for (let i = 1; i <= MISSED_LOOKBACK_DAYS; i++) { // most recent day first
    const blocks = pastPages[i];
    if (!blocks) continue;
    const dayDate = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const dayStr = shiftYMD(todayStr, -i);
    const parsed = parseDayTaskBlocks(blocks, { renderDate: dayDate, todayStr });
    let category = '';
    for (const t of parsed) {
      if (t.isHeader) { category = t.text.toUpperCase(); continue; }
      const textKey = t.text.trim().toLowerCase();
      if (seenIds.has(t.id) || todayIds.has(t.id) || seenTexts.has(textKey) || stickyDone.has(t.id)) continue;
      if (resolvedSince(t.id, dayStr)) continue;
      seenIds.add(t.id);
      seenTexts.add(textKey);
      missed.push({ id: t.id, text: t.text, category: category || 'ADMIN', isRecurring: !!t.isRecurring });
    }
  }
  return missed;
}

async function getDailyTasks(dayOfWeek: number, today: Date) {
  const pageId = DAY_PAGES[dayOfWeek];
  const data = await notionFetch(`/blocks/${pageId}/children?page_size=100`);
  return parseDayTaskBlocks(data.results || [], { renderDate: today, todayStr: formatYMD(today) });
}

async function getShoppingTasks() {
  // Only unchecked items from the 🛒 Shopping List page — Notion-checked items
  // are excluded to avoid old completed items flooding back. The isShopping flag
  // tells the client not to let applyServerChecked override the checked state,
  // and to re-inject any locally-checked items across soft refreshes.
  const data = await notionFetch(`/blocks/${SHOPPING_PAGE_ID}/children?page_size=100`);
  const items: { id: string; text: string; checked: boolean; isRecurring: boolean; isShopping: boolean }[] = [];
  for (const block of (data.results || [])) {
    if (block.type === 'to_do' && !block.to_do?.checked) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (block.to_do?.rich_text || []).map((r: any) => r.plain_text).join('');
      if (raw.trim()) items.push({ id: block.id, text: raw.trim(), checked: false, isRecurring: false, isShopping: true });
    }
  }
  return items;
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
  // Fetch every project's checklist concurrently instead of one-by-one (much faster load).
  const projects = await Promise.all((data.results || []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (p: any) => {
      const name = p.properties.Name?.title?.[0]?.plain_text || 'Untitled';
      const status = p.properties.Status?.select?.name || 'No Status';
      const childData = await notionFetch(`/blocks/${p.id}/children?page_size=50`);
      const todos = (childData.results || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((b: any) => b.type === 'to_do')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((b: any) => ({
          id: b.id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          text: (b.to_do?.rich_text || []).map((r: any) => r.plain_text).join(''),
          checked: b.to_do?.checked || false,
        }));
      return { id: p.id, name, status, todos };
    }
  ));
  return projects;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPersonalTodos(allBlocks: any[]) {
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
  const today = melbNowDate();
  const dayOfWeek = today.getDay();
  const todayStr = formatYMD(today);

  const [weather, dailyTasks, projects, osPageBlocks, shoppingItems, { carry: carryCandidates, sticky: stickyCandidates, pastPages }] = await Promise.all([
    getWeather(),
    getDailyTasks(dayOfWeek, today),
    getProjects(),
    getOSPageBlocks(),
    getShoppingTasks(),
    fetchCarryAndStickyCandidates(today),
  ]);

  // Derived in memory from the single OS-page fetch above — no extra Notion calls.
  const personalTodos = getPersonalTodos(osPageBlocks);
  const checkedState = getCheckedState(osPageBlocks);

  // Inject any [CARRY] tasks from past days that haven't been checked off yet.
  // Carry if the task ID hasn't been checked on ANY date in the retention window
  // (checked state is retained ~8 days by /api/checked-state). Filtered in memory
  // here so the page fetch above can run in parallel with everything else.
  const carries = carryCandidates.filter(
    c => !Object.values(checkedState).some(ids => ids.includes(c.id))
  );
  for (const carry of carries) {
    const carryTask = { id: carry.id, text: carry.text, checked: false, isRecurring: false, isSticky: isReviewPricingTask(carry.text) || undefined };
    const headerIdx = dailyTasks.findIndex((t: { isHeader?: boolean; text: string }) => t.isHeader && t.text === carry.header);
    if (headerIdx !== -1) {
      // Insert right after the existing header
      dailyTasks.splice(headerIdx + 1, 0, carryTask);
    } else {
      // Header not on today's page — prepend it with the task
      dailyTasks.unshift(
        { id: `header-carry-${carry.header}`, text: carry.header, checked: false, isHeader: true },
        carryTask,
      );
    }
  }

  // Inject any [STICKY] (persistent) tasks that haven't been permanently ticked off
  // AND whose "starts showing" date (the day they were added from) has arrived.
  // Unlike [CARRY], there's no retention window — once a sticky task's ID is recorded
  // in checkedState["_sticky_done"] it never resurfaces again. Stickies with no
  // encoded date (older [STICKY] blocks) show immediately, as before.
  // Inject persistent [STICKY] tasks under their original category header (so they
  // keep their real category label). The client groups all isSticky tasks together
  // at the BOTTOM of the Daily To Do at render time. They show only on the current
  // day — if left unchecked they resurface again tomorrow via this same scan.
  const stickyDone: string[] = checkedState[STICKY_DONE_KEY] || [];
  const stickies = stickyCandidates.filter(c =>
    !stickyDone.includes(c.id) && (!c.startDate || c.startDate <= todayStr)
  );
  // Pinned tasks created via /api/pin-task carry a linked Projects DB page id
  // (see STICKY_PREFIX_RE). Where that project is still open (getProjects() above
  // already excludes Status=Done), attach its checklist as `subtasks` so the pinned
  // row can expand into an "ongoing project" view in Daily To Do. No match (project
  // completed/archived/older pin with no linked project) just renders as a plain pin.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectMap = new Map(projects.map((p: any) => [p.id, p]));
  for (const sticky of stickies) {
    const linkedProject = sticky.projectId ? projectMap.get(sticky.projectId) : undefined;
    const stickyTask = {
      id: sticky.id,
      text: sticky.text,
      checked: false,
      isRecurring: false,
      isSticky: true,
      ...(linkedProject ? { projectId: sticky.projectId, subtasks: linkedProject.todos } : {}),
    };
    const headerIdx = dailyTasks.findIndex((t: { isHeader?: boolean; text: string }) => t.isHeader && t.text === sticky.header);
    if (headerIdx !== -1) {
      dailyTasks.splice(headerIdx + 1, 0, stickyTask);
    } else {
      dailyTasks.unshift(
        { id: `header-sticky-${sticky.header}`, text: sticky.header, checked: false, isHeader: true },
        stickyTask,
      );
    }
  }

  // Inject "not completed yesterday" tasks. Computed after carry/sticky injection
  // so the "already on today's list" check sees everything that will render.
  // Placed under their category header like any task; the client renders the
  // unticked ones red at the top and ticked ones with the other checked tasks.
  const missedTasks = getMissedTasks(pastPages, today, checkedState, dailyTasks);
  for (const m of missedTasks) {
    const missedTask = { id: m.id, text: m.text, checked: false, isRecurring: m.isRecurring, isMissed: true };
    const headerIdx = dailyTasks.findIndex((t: { isHeader?: boolean; text: string }) => t.isHeader && t.text.toUpperCase() === m.category);
    if (headerIdx !== -1) {
      dailyTasks.splice(headerIdx + 1, 0, missedTask);
    } else {
      dailyTasks.unshift(
        { id: `header-missed-${m.category}`, text: m.category, checked: false, isHeader: true },
        missedTask,
      );
    }
  }

  // Append the 🛒 Shopping List as its own group at the end of the daily list
  if (shoppingItems.length > 0) {
    dailyTasks.push({ id: 'header-shopping', text: '🛒 SHOPPING LIST', checked: false, isHeader: true });
    for (const item of shoppingItems) dailyTasks.push(item);
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const d = today.getDate();
  const ordinal = d + (['th', 'st', 'nd', 'rd'][(d % 100 > 10 && d % 100 < 14) ? 0 : (d % 10 < 4 ? d % 10 : 0)] || 'th');
  const dateStr = `${dayNames[dayOfWeek]} ${ordinal} ${monthNames[today.getMonth()]}`;

  // Short edge cache + SWR — halves Notion API calls during pull-to-refresh
  // spam on a busy Saturday. Up to 30s stale is acceptable: client checkboxes
  // are managed locally and posted to /api/checked-state separately, so the
  // user never sees their own tap as "missing" from the cached payload.
  return NextResponse.json(
    { dateStr, weather, dailyTasks, projects, personalTodos, todayStr },
    { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' } }
  );
}
