import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/lib/auth';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Anthropic call is small + structured; keep well under Vercel's ceiling.
export const maxDuration = 15;

interface ExistingProject {
  id: string;
  name: string;
}

// Turns a raw brain-dump into a structured project draft. Decides whether the
// idea is a brand-new project or another action on one Jonathan already has.
export async function POST(req: NextRequest) {
  const denied = requireSession(req);
  if (denied) return denied;
  const { ideaText, existingProjects = [] } = (await req.json()) as {
    ideaText: string;
    existingProjects: ExistingProject[];
  };

  if (!ideaText?.trim()) {
    return NextResponse.json({ error: 'No idea text provided.' }, { status: 400 });
  }

  const projectList = (existingProjects || [])
    .map((p) => `- ${p.name} (id: ${p.id})`)
    .join('\n') || '(none yet)';

  const systemPrompt = `You are the capture assistant inside TIGER OS, the daily dashboard for G'Day Tiger — a busy café run by Jonathan. He drops a raw, half-formed idea and you turn it into a clean, actionable project draft.

Rules:
- Decide if the idea is a NEW project, or an action that belongs on one of his EXISTING projects (listed below). Only choose "existing" when the idea clearly continues that project — otherwise default to "new".
- Project name: short, punchy, title-case-ish, no trailing punctuation. Max ~6 words.
- Next actions: 2–4 concrete, doable next steps written as imperative verbs ("Email Seven Seeds for wholesale rates", not "wholesale rates"). Café-operator practical. Don't pad to 4 if 2 is right.
- Keep his voice: direct, no fluff.

Existing projects:
${projectList}

Respond with ONLY a JSON object, no markdown, no commentary:
{"mode":"new"|"existing","projectName":"...","matchProjectId":"<id or empty>","actions":["...","..."]}
For "new", matchProjectId is "". For "existing", projectName must be the exact existing project name and matchProjectId its id.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: ideaText.trim() }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('braindump-analyze Anthropic error:', err);
    return NextResponse.json({ error: 'AI draft unavailable. Check ANTHROPIC_API_KEY.' }, { status: 500 });
  }

  const data = await res.json();
  const raw = data.content?.[0]?.text || '';

  // Be defensive: strip any stray code fences before parsing.
  const jsonStr = raw.replace(/```json|```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error('braindump-analyze parse fail:', raw);
    // Graceful fallback — treat the dump as a new project with no actions.
    return NextResponse.json({
      mode: 'new',
      projectName: ideaText.trim().slice(0, 60),
      matchProjectId: '',
      matchProjectName: '',
      actions: [],
    });
  }

  const mode = parsed.mode === 'existing' ? 'existing' : 'new';
  const match = (existingProjects || []).find((p) => p.id === parsed.matchProjectId);
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.filter((a: unknown) => typeof a === 'string' && a.trim()).slice(0, 6)
    : [];

  return NextResponse.json({
    mode: mode === 'existing' && match ? 'existing' : 'new',
    projectName: mode === 'existing' && match ? match.name : (parsed.projectName || ideaText.trim().slice(0, 60)),
    matchProjectId: mode === 'existing' && match ? match.id : '',
    matchProjectName: mode === 'existing' && match ? match.name : '',
    actions,
  });
}
