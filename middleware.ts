import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_TOKEN = process.env.SESSION_TOKEN;

export function middleware(request: NextRequest) {
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
