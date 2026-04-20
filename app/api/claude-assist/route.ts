import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function POST(req: NextRequest) {
  const { messages, projectName, actionText } = await req.json();

  const systemPrompt = `You are a sharp, practical business assistant for G'Day Tiger — a busy Melbourne café run by Jonathan. You help him work through business tasks efficiently. Jonathan is an experienced operator who doesn't need hand-holding. Be direct, commercially aware, and keep responses concise and actionable. No fluff.

Current task context:
- Project: ${projectName}
- Action item: ${actionText}

Respond helpfully to whatever Jonathan asks about this task. If it's a research task, give him facts. If it's a draft he needs, write it. If it's a decision, give him a recommendation.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('Anthropic API error:', err);
    return NextResponse.json({ content: 'Claude is unavailable right now. Check your ANTHROPIC_API_KEY.' }, { status: 500 });
  }

  const data = await res.json();
  const content = data.content?.[0]?.text || 'No response received.';
  return NextResponse.json({ content });
}
