import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_TOKEN = process.env.SESSION_TOKEN;

// Next 16 renamed the "middleware" file convention to "proxy". Same behaviour —
// this gates every route on the gdt_session cookie. The per-route requireSession()
// guards in app/lib/auth.ts back this up in case a proxy bypass ever lands.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow login page and login API through
  if (pathname.startsWith('/login') || pathname.startsWith('/api/login')) {
    return NextResponse.next();
  }

  // Check session cookie
  const session = request.cookies.get('gdt_session')?.value;

  if (!session || session !== SESSION_TOKEN) {
    // For API routes return 401 JSON — don't redirect (fetch calls can't follow HTML redirects)
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png|manifest.json).*)'],
};
