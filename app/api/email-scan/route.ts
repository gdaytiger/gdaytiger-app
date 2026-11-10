import { NextRequest, NextResponse } from 'next/server';
import { readOsBlock, writeOsBlock } from '@/app/lib/osBlocks';
import { melbNowDate } from '@/app/lib/melbTime';

// Email → Daily To Do.
// POST from the Apps Script sweeper (apps-script/EmailToTasks.js) with a batch of
// recent Gmail messages. Claude decides which ones carry a real action for Jonathan,
// and each action is written through /api/add-task so supplier links, category
// headings and the context panel all behave exactly like a manually added task.
//
// Auth: Authorization: Bearer CRON_SECRET (same secret the Morning Brief push uses).
// Dedupe: processed Gmail message IDs live in the `email_scan` OS block (last 500),
// so re-sending a message never double-adds a task.
// Dry run: { dryRun: true } returns the tasks it WOULD add without writing anything.

export const maxDuration = 60;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAX_SEEN = 500;
const CATEGORIES = ['ORDER', 'ADMIN', 'STAFF', 'MAINTENANCE', 'MERCHANDISE', 'PERSONAL', 'COSTING'];
// Keep in sync with KNOWN_ORDER_SUPPLIERS in add-task — a task whose text is exactly
// one of these renders as a tappable order link.
const SUPPLIER_NAMES = ['Dench', 'Seven Seeds', 'Noisette', 'Redimilk', 'Candied', 'Little Bertha', '5WAYS', "Scicluna's", 'MÖRK', 'Planetware'];

type Email = { id: string; threadId: string; from: string; to?: string; subject: string; date: string; body: string };
type Task = { emailId: string; text: string; context: string; date: string; category: string };
type ScanState = { seen: string[]; lastRun?: string; lastAdded?: { text: string; date: string; from: string }[] };

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function extractTasks(emails: Email[], today: string): Promise<Task[]> {
  const weekday = new Date(today + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' });
  const prompt = `You triage the inbox for Jonathan, owner-operator of G'Day Tiger, a café in Cowes, Phillip Island (open 6:30am–2pm). Today is ${weekday} ${today} (Melbourne).

For each email below, decide whether it needs Jonathan to DO something. Only create a task when there is a concrete action: reply/confirm, pay a bill or overdue invoice, chase a supplier issue (short delivery, credit, price rise, out of stock), book/arrange something, sign or submit a form, fix a staff/roster problem, a council/compliance/ATO deadline, a customer complaint or catering/wholesale enquiry that needs a response.

Do NOT create tasks for: newsletters, marketing, promos, receipts, routine supplier invoices or order confirmations with no problem (an automated scanner already handles invoice prices), shipping notifications, social media alerts, automated system notices, Google review notifications, calendar auto-emails, anything already resolved in the thread, or emails Jonathan sent himself.

Rules for each task:
- text: short imperative title, max 60 chars, no dates, no sender email addresses (e.g. "Reply to Bass Coast Council re footpath permit", "Pay Origin Energy bill"). If the action is simply placing an order with one of these suppliers, make text EXACTLY the supplier name: ${SUPPLIER_NAMES.join(', ')}.
- context: 1–3 short lines with the useful details (who, amounts, deadlines, what they asked). Australian English. No greeting.
- date: YYYY-MM-DD the task should appear on. Default ${today}. Use a later date only if the email clearly sets when the action should happen (never later than the deadline itself; never before ${today}; max 30 days out).
- category: one of ${CATEGORIES.join(', ')}.
- One email → at most 2 tasks. When unsure, leave it out — a missed newsletter costs nothing, a junk task costs Jonathan's attention.

Reply with ONLY a JSON array (no prose), e.g. [{"emailId":"...","text":"...","context":"...","date":"${today}","category":"ADMIN"}]. Empty array if nothing needs action.

EMAILS:
${emails.map(e => `--- emailId: ${e.id}
From: ${e.from}
Subject: ${e.subject}
Date: ${e.date}
${e.body.slice(0, 2500)}`).join('\n\n')}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (data.type === 'error') throw new Error(data.error?.message || 'Anthropic error');
  const raw: string = data.content?.[0]?.text || '[]';
  const match = raw.match(/\[[\s\S]*\]/);
  let parsed: unknown;
  try { parsed = JSON.parse(match ? match[0] : '[]'); } catch { parsed = []; }
  if (!Array.isArray(parsed)) return [];

  const ids = new Set(emails.map(e => e.id));
  const max = new Date(today + 'T00:00:00Z'); max.setUTCDate(max.getUTCDate() + 30);
  const maxStr = ymd(max);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return parsed.flatMap((t: any) => {
    if (!t || !ids.has(t.emailId) || typeof t.text !== 'string' || !t.text.trim()) return [];
    let date = typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : today;
    if (date < today) date = today;
    if (date > maxStr) date = maxStr;
    const category = CATEGORIES.includes(String(t.category).toUpperCase()) ? String(t.category).toUpperCase() : '';
    return [{ emailId: t.emailId, text: t.text.trim().slice(0, 80), context: String(t.context || '').trim(), date, category }];
  });
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { emails?: Email[]; dryRun?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const dryRun = Boolean(body.dryRun);
  const state = (await readOsBlock<ScanState>('email_scan')) || { seen: [] };
  const seen = new Set(state.seen || []);
  const fresh = (body.emails || []).filter(e => e && e.id && (dryRun || !seen.has(e.id))).slice(0, 25);
  if (!fresh.length) return NextResponse.json({ added: [], skipped: 0, note: 'nothing new' });

  const today = ymd(melbNowDate());
  let tasks: Task[];
  try { tasks = await extractTasks(fresh, today); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 502 }); }

  const byId = new Map(fresh.map(e => [e.id, e]));
  const withLink = tasks.map(t => {
    const e = byId.get(t.emailId)!;
    const link = `https://mail.google.com/mail/u/0/#all/${e.threadId}`;
    return { ...t, context: `${t.context}\n\nFrom: ${e.from}\nSubject: ${e.subject}\n${link}`.trim() };
  });

  if (dryRun) return NextResponse.json({ dryRun: true, scanned: fresh.length, tasks: withLink });

  // Write each task through the normal add-task route so all its rules apply.
  const origin = req.nextUrl.origin;
  const added: { text: string; date: string; from: string; emailId: string; threadId: string }[] = [];
  const errors: string[] = [];
  for (const t of withLink) {
    const r = await fetch(`${origin}/api/add-task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `gdt_session=${process.env.SESSION_TOKEN}` },
      body: JSON.stringify({ date: t.date, text: t.text, context: t.context, category: t.category || undefined, recurrence: 'once' }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.success) {
      const e = byId.get(t.emailId)!;
      added.push({ text: t.text, date: t.date, from: e.from, emailId: e.id, threadId: e.threadId });
    } else errors.push(`${t.text}: ${j.error || r.status}`);
  }

  // Mark every scanned message as seen (with or without a task) — but if a write failed,
  // leave that email unseen so the next sweep retries it.
  const failedIds = new Set(withLink.filter(t => !added.some(a => a.emailId === t.emailId)).map(t => t.emailId));
  const nextSeen = [...(state.seen || []), ...fresh.map(e => e.id).filter(id => !failedIds.has(id))].slice(-MAX_SEEN);
  await writeOsBlock('email_scan', {
    seen: nextSeen,
    lastRun: new Date().toISOString(),
    lastAdded: [...added.map(a => ({ text: a.text, date: a.date, from: a.from })), ...(state.lastAdded || [])].slice(0, 20),
  });

  return NextResponse.json({ scanned: fresh.length, added, errors });
}
