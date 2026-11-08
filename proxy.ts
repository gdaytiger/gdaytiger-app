import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { roleForToken } from '@/app/lib/auth';

// Partner (Isola Di Capri / Claudio) login — the ONLY paths it can reach. Everything else
// redirects to / (pages) or 401s (APIs).
//   Pages: the dashboard (role-aware: only Supplier Prices, Costings, Weekly Flash, The Document) + /document.
//   APIs:  THE DOCUMENT (read/write), plus READ-ONLY (GET) feeds for the three shared widgets.
const PARTNER_PAGES = ['/', '/document'];
const PARTNER_APIS = ['/api/the-document', '/api/logout', '/api/whoami', '/api/header'];
const PARTNER_READ_APIS = ['/api/costings', '/api/ingredient-prices', '/api/price-drift', '/api/margin-review',
  '/api/payment-fees', '/api/recipe-map', '/api/weekly-flash', '/api/flash-extras'];
const under = (p: string, base: string) => p === base || p.startsWith(base + '/');
const partnerAllowed = (p: string, method: string) =>
  PARTNER_PAGES.includes(p) ||
  PARTNER_APIS.some(b => under(p, b)) ||
  (method === 'GET' && PARTNER_READ_APIS.some(b => under(p, b)));

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

  if (role === 'partner' && !partnerAllowed(pathname, request.method)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|manifest.json|sw.js|icon-192.png).*)'],
};
