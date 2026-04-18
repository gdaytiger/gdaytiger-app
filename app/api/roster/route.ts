import { NextResponse } from 'next/server';

const DEPUTY_ENDPOINT = process.env.DEPUTY_ENDPOINT;
const DEPUTY_CLIENT_ID = process.env.DEPUTY_CLIENT_ID;
const DEPUTY_CLIENT_SECRET = process.env.DEPUTY_CLIENT_SECRET;

async function getValidToken(): Promise<string> {
  // Try refresh token to get a fresh access token
  const refreshToken = process.env.DEPUTY_REFRESH_TOKEN;
  const res = await fetch(`${DEPUTY_ENDPOINT}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DEPUTY_CLIENT_ID!,
      client_secret: DEPUTY_CLIENT_SECRET!,
      refresh_token: refreshToken!,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.access_token) return data.access_token;
  // Fall back to stored token
  return process.env.DEPUTY_ACCESS_TOKEN!;
}

export async function GET() {
  try {
    const token = await getValidToken();

    // Get today and 7 days ahead in Deputy's date format
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    const pad = (n: number) => String(n).padStart(2, '0');
    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const startDate = formatDate(today);
    const endDate = formatDate(nextWeek);

    // Query rosters for the next 7 days
    const rosterRes = await fetch(
      `${DEPUTY_ENDPOINT}/api/v1/resource/Roster/QUERY`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          search: {
            s1: { field: 'Date', type: 'ge', data: startDate },
            s2: { field: 'Date', type: 'le', data: endDate },
            s3: { field: 'Employee', type: 'eq', data: 1 },
          },
          sort: { Date: 'asc' },
        }),
      }
    );

    const rosters = await rosterRes.json();

    if (!Array.isArray(rosters)) {
      return NextResponse.json({ shifts: [], error: 'No roster data' });
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const formatTime = (unix: number) => {
      const d = new Date(unix * 1000);
      // Convert to Melbourne time (UTC+10/+11)
      const melb = new Date(d.getTime() + 10 * 60 * 60 * 1000);
      let h = melb.getUTCHours();
      const m = melb.getUTCMinutes();
      const ampm = h >= 12 ? 'pm' : 'am';
      h = h % 12 || 12;
      return `${h}${m > 0 ? `:${pad(m)}` : ''}${ampm}`;
    };

    const shifts = rosters.map((r: {
      Date: string;
      StartTime: number;
      EndTime: number;
      Comment?: string;
    }) => {
      const date = new Date(r.Date);
      const dayLabel = `${dayNames[date.getDay()]} ${date.getDate()} ${monthNames[date.getMonth()]}`;
      const start = formatTime(r.StartTime);
      const end = formatTime(r.EndTime);
      return {
        date: r.Date,
        label: dayLabel,
        start,
        end,
        comment: r.Comment || '',
      };
    });

    return NextResponse.json({ shifts });
  } catch (err) {
    console.error('Deputy roster error:', err);
    return NextResponse.json({ shifts: [], error: 'Failed to fetch roster' });
  }
}
