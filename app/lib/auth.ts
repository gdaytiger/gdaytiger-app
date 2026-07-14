import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_TOKEN = process.env.SESSION_TOKEN;

// Defence-in-depth session check for mutating API routes.
//
// proxy.ts (the Next 16 rename of middleware.ts) already gates every route,
// but the May 2026 Next.js middleware/proxy-bypass advisories (crafted .rsc /
// segment-prefetch URLs that resolve to a page without the proxy matching)
// mean it can be skipped. Re-checking the session inside each write route
// ensures a bypass can't post to Notion, delete tasks, or burn the Anthropic API key.
//
// Returns a 401 NextResponse when the session is missing/invalid, or null when
// the request is authorised. Usage at the top of a handler:
//   const denied = requireSession(req);
//   if (denied) return denied;
export function requireSession(req: NextRequest): NextResponse | null {
  const session = req.cookies.get('gdt_session')?.value;
  if (!session || session !== SESSION_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
