import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_TOKEN = process.env.SESSION_TOKEN;
// Second login (Isola Di Capri) — only sees THE DOCUMENT. Unset = partner login disabled.
const PARTNER_SESSION_TOKEN = process.env.PARTNER_SESSION_TOKEN;

export type Role = 'owner' | 'partner';

// Which account a gdt_session cookie belongs to (null = not logged in).
export function roleForToken(token: string | undefined): Role | null {
  if (!token) return null;
  if (SESSION_TOKEN && token === SESSION_TOKEN) return 'owner';
  if (PARTNER_SESSION_TOKEN && token === PARTNER_SESSION_TOKEN) return 'partner';
  return null;
}

export function getRole(req: NextRequest): Role | null {
  return roleForToken(req.cookies.get('gdt_session')?.value);
}

// Defence-in-depth session check for mutating API routes.
//
// proxy.ts (the Next 16 rename of middleware.ts) already gates every route,
// but the May 2026 Next.js middleware/proxy-bypass advisories (crafted .rsc /
// segment-prefetch URLs that resolve to a page without the proxy matching)
// mean it can be skipped. Re-checking the session inside each write route
// ensures a bypass can't post to Notion, delete tasks, or burn the Anthropic API key.
//
// OWNER ONLY — the partner (Isola) session fails this, so every existing route
// stays locked to Jonathan. THE DOCUMENT route uses requireDocumentAccess instead.
//
// Returns a 401 NextResponse when the session is missing/invalid, or null when
// the request is authorised. Usage at the top of a handler:
//   const denied = requireSession(req);
//   if (denied) return denied;
export function requireSession(req: NextRequest): NextResponse | null {
  if (getRole(req) !== 'owner') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

// THE DOCUMENT — owner or partner. Returns the role, or a 401 response.
export function requireDocumentAccess(req: NextRequest): Role | NextResponse {
  const role = getRole(req);
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return role;
}
