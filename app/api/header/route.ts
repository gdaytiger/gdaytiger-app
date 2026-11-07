import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/app/lib/auth';
import { melbNowDate } from '@/app/lib/melbTime';
import { getWeather } from '@/app/lib/weather';

// Date + weather for the TIGER OS header on /document (the Isola login can't
// read /api/dashboard). Same format as the dashboard: "Sunday 8th November".
export async function GET(req: NextRequest) {
  if (!getRole(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const today = melbNowDate();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const d = today.getUTCDate();
  const ordinal = d + (['th', 'st', 'nd', 'rd'][(d % 100 > 10 && d % 100 < 14) ? 0 : (d % 10 < 4 ? d % 10 : 0)] || 'th');
  const dateStr = `${dayNames[today.getUTCDay()]} ${ordinal} ${monthNames[today.getUTCMonth()]}`;
  return NextResponse.json({ dateStr, weather: await getWeather() });
}
