import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { roleForToken } from '@/app/lib/auth';

// Partner (Isola Di Capri) login — the ONLY paths it can reach. Everything else
// redirects to /document (pages) or 401s (APIs).
const PARTNER_PATHS = ['/document', '/api/the-document', '/api/logout'];
const partnerAllowed = (p: string) => PARTNER_PATHS.some(base => p === base || p.startsWith(base + '/'));

// Next 16 renamed the "middleware" file convention to "proxy". Same behaviour —
// this gates every route on the gdt_session cookie. The per-route requireSession()
// guards in app/lib/auth.ts back this up in case a proxy bypass ever lands.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow login page and login API through
  if (pathname.startsWith('/login') || pathname.startsWith('/api/login')) {
    return NextResponse.next();
  }

  // 5am push cron — no cookie; the route checks Bearer CRON_SECRET itself.
  if (pathname === '/api/push/morning' && request.method === 'GET') {
    return NextResponse.next();
  }

  // Check session cookie
  const role = roleForToken(request.cookies.get('gdt_session')?.value);

  if (!role) {
    // For API routes return 401 JSON — don't redirect (fetch calls can't follow HTML redirects)
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (role === 'partner' && !partnerAllowed(pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/document', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|manifest.json|sw.js|icon-192.png).*)'],
};
