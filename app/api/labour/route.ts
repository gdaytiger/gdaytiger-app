import { NextResponse } from 'next/server';

// Labour analysis feed — actual worked hours + cost per day, broken down by area.
//
// Distinct from /api/roster: that route pulls only Jono's OWN upcoming shifts
// (Employee eq 1) to render the personal roster card. THIS route pulls ALL
// employees' completed Timesheets over a date range so labour can be analysed
// against daily sales (winter staff-cost blowout investigation, Jun 2026).
//
// Source: Deputy Timesheet resource (actual times worked, not scheduled Roster).
//   TotalTime = paid hours, Cost = shift cost incl penalties/loading.
//   NOTE: Cost is only populated once a timesheet is pay-approved. For very
//   recent (unapproved) weeks Cost may be 0/null — fall back to hours * rate
//   in the consumer, or pass ?rate= to have this route estimate it.
//
// Query params:
//   ?start=YYYY-MM-DD&end=YYYY-MM-DD   explicit range (inclusive)
//   ?weeks=N                            trailing N weeks ending today (default 12)
//   ?rate=NN                            $/hr used to ESTIMATE cost when Cost is missing
//
// Reuses env: DEPUTY_ENDPOINT, DEPUTY_ACCESS_TOKEN (same as /api/roster).

const DEPUTY_ENDPOINT = process.env.DEPUTY_ENDPOINT;

const AREA_NAMES: Record<number, string> = {
  3: 'Open',
  4: 'Close',
  6: 'Admin',
  7: 'Next Door',
};

const pad = (n: number) => String(n).padStart(2, '0');

// Melbourne is UTC+10 (AEST). Deputy stores Date as a unix-ish value or string;
// we render everything in Melbourne local to line up with trading days.
const MELB_OFFSET_MS = 10 * 60 * 60 * 1000;

const formatDate = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const normalizeDate = (val: string | number): string => {
  if (typeof val === 'number') {
    const melb = new Date(val * 1000 + MELB_OFFSET_MS);
    return formatDate(melb);
  }
  return String(val).substring(0, 10);
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function GET(req: Request) {
  try {
    const token = process.env.DEPUTY_ACCESS_TOKEN!;
    const { searchParams } = new URL(req.url);

    // ---- Resolve date range ----
    const melbNow = new Date(Date.now() + MELB_OFFSET_MS);
    let startStr = searchParams.get('start');
    let endStr = searchParams.get('end');
    if (!startStr || !endStr) {
      const weeks = Math.max(1, Math.min(104, Number(searchParams.get('weeks')) || 12));
      const start = new Date(melbNow.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
      startStr = formatDate(start);
      endStr = formatDate(melbNow);
    }
    const rate = Number(searchParams.get('rate')) || 0; // optional cost estimate

    // ---- Page through Deputy Timesheets (resource QUERY caps ~500/page) ----
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records: any[] = [];
    const PAGE = 500;
    let startOffset = 0;
    // Hard cap pages so a bad range can't loop forever.
    for (let page = 0; page < 20; page++) {
      const res = await fetch(
        `${DEPUTY_ENDPOINT}/api/v1/resource/Timesheet/QUERY`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            search: {
              s1: { field: 'Date', type: 'ge', data: startStr },
              s2: { field: 'Date', type: 'le', data: endStr },
            },
            // Pull area names in one hit instead of a second lookup.
            join: ['OperationalUnitObject'],
            sort: { Date: 'asc' },
            max: PAGE,
            start: startOffset,
          }),
        }
      );

      const text = await res.text();
      if (!text) break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let batch: any;
      try {
        batch = JSON.parse(text);
      } catch {
        // Deputy occasionally returns malformed bodies — fail soft.
        return NextResponse.json({ error: 'Deputy returned malformed JSON', days: [] });
      }
      if (!Array.isArray(batch) || batch.length === 0) break;
      records.push(...batch);
      if (batch.length < PAGE) break;
      startOffset += PAGE;
    }

    // ---- Aggregate per day, with per-area + headcount breakdown ----
    type AreaAgg = { hours: number; cost: number };
    type DayAgg = {
      date: string;
      weekday: string;
      hours: number;
      cost: number;
      costEstimated: boolean;
      shifts: number;
      staff: Set<number>;
      byArea: Record<string, AreaAgg>;
    };
    const dayMap: Record<string, DayAgg> = {};
    let anyCostMissing = false;

    for (const r of records) {
      // Skip discarded timesheets and leave (leave isn't worked labour on the floor).
      if (r.Discarded === true || r.IsLeave === true) continue;

      const date = normalizeDate(r.Date);
      const hours = Number(r.TotalTime) || 0;
      let cost = Number(r.Cost) || 0;
      let estimated = false;
      if (cost === 0 && rate > 0) {
        cost = hours * rate;
        estimated = true;
        anyCostMissing = true;
      } else if (cost === 0) {
        anyCostMissing = true;
      }

      const areaName =
        (r.OperationalUnitObject && r.OperationalUnitObject.OperationalUnitName) ||
        AREA_NAMES[r.OperationalUnit] ||
        'Unknown';

      if (!dayMap[date]) {
        const dt = new Date(date + 'T00:00:00Z');
        dayMap[date] = {
          date,
          weekday: DAY_NAMES[dt.getUTCDay()],
          hours: 0,
          cost: 0,
          costEstimated: false,
          shifts: 0,
          staff: new Set<number>(),
          byArea: {},
        };
      }
      const d = dayMap[date];
      d.hours += hours;
      d.cost += cost;
      d.shifts += 1;
      d.costEstimated = d.costEstimated || estimated;
      if (r.Employee != null) d.staff.add(Number(r.Employee));
      if (!d.byArea[areaName]) d.byArea[areaName] = { hours: 0, cost: 0 };
      d.byArea[areaName].hours += hours;
      d.byArea[areaName].cost += cost;
    }

    const days = Object.values(dayMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        weekday: d.weekday,
        hours: Math.round(d.hours * 100) / 100,
        cost: Math.round(d.cost * 100) / 100,
        costEstimated: d.costEstimated,
        shifts: d.shifts,
        headcount: d.staff.size,
        byArea: Object.fromEntries(
          Object.entries(d.byArea).map(([k, v]) => [
            k,
            { hours: Math.round(v.hours * 100) / 100, cost: Math.round(v.cost * 100) / 100 },
          ])
        ),
      }));

    const totals = days.reduce(
      (acc, d) => {
        acc.hours += d.hours;
        acc.cost += d.cost;
        acc.shifts += d.shifts;
        return acc;
      },
      { hours: 0, cost: 0, shifts: 0 }
    );
    totals.hours = Math.round(totals.hours * 100) / 100;
    totals.cost = Math.round(totals.cost * 100) / 100;

    return NextResponse.json({
      range: { start: startStr, end: endStr },
      days,
      totals,
      meta: {
        recordCount: records.length,
        costMissing: anyCostMissing,
        costNote: anyCostMissing
          ? 'Some timesheets had no Cost (not yet pay-approved). Pass ?rate=NN to estimate, or treat hours as the source of truth.'
          : 'Cost taken from approved timesheets.',
      },
    });
  } catch (err) {
    console.error('Deputy labour error:', err);
    return NextResponse.json({ error: 'Failed to fetch labour data', days: [] }, { status: 200 });
  }
}
