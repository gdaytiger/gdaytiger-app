import { NextResponse } from 'next/server';

const DEPUTY_ENDPOINT = process.env.DEPUTY_ENDPOINT;
const DEPUTY_CLIENT_ID = process.env.DEPUTY_CLIENT_ID;
const DEPUTY_CLIENT_SECRET = process.env.DEPUTY_CLIENT_SECRET;

const AREA_NAMES: Record<number, string> = {
  3: 'Open',
  4: 'Close',
  6: 'Admin',
  7: 'Next Door',
};

async function getValidToken(): Promise<string> {
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
  return process.env.DEPUTY_ACCESS_TOKEN!;
}

export async function GET() {
  try {
    const token = await getValidToken();

    const today = new Date();
    const eightDays = new Date(today.getTime() + 8 * 24 * 60 * 60 * 1000);

    const pad = (n: number) => String(n).padStart(2, '0');
    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const startDate = formatDate(today);
    const endDate = formatDate(eightDays);

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

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const formatTime = (unix: number) => {
      const d = new Date(unix * 1000);
      const melb = new Date(d.getTime() + 10 * 60 * 60 * 1000);
      let h = melb.getUTCHours();
      const m = melb.getUTCMinutes();
      const ampm = h >= 12 ? 'pm' : 'am';
      h = h % 12 || 12;
      return `${h}${m > 0 ? `:${pad(m)}` : ''}${ampm}`;
    };

    // Build map of date -> shift from Deputy
    const shiftMap: Record<string, { start: string; end: string; area: string; comment: string }> = {};
    if (Array.isArray(rosters)) {
      for (const r of rosters as {
        Date: string;
        StartTime: number;
        EndTime: number;
        OperationalUnit: number;
        Comment?: string;
      }[]) {
        shiftMap[r.Date] = {
          start: formatTime(r.StartTime),
          end: formatTime(r.EndTime),
          area: AREA_NAMES[r.OperationalUnit] || '',
          comment: r.Comment || '',
        };
      }
    }

    // Generate all 7 days, fill gaps with "not working"
    const shifts = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = formatDate(d);
      const dayLabel = `${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;
      const shift = shiftMap[dateStr];

      shifts.push({
        date: dateStr,
        label: dayLabel,
        working: !!shift,
        start: shift?.start || '',
        end: shift?.end || '',
        area: shift?.area || '',
        comment: shift?.comment || '',
      });
    }

    return NextResponse.json({ shifts });
  } catch (err) {
    console.error('Deputy roster error:', err);
    return NextResponse.json({ shifts: [], error: 'Failed to fetch roster' });
  }
}
