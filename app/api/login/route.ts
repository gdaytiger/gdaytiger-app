import { NextRequest, NextResponse } from 'next/server';

const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_TOKEN = process.env.SESSION_TOKEN;
// Owner username — defaults to 'jono'. Blank also accepted so saved Keychain logins keep working.
const OWNER_USERNAME = (process.env.OWNER_USERNAME || 'jono').trim().toLowerCase();

// Second login — Isola Di Capri, THE DOCUMENT only. All three must be set in
// Vercel for it to work; if any is missing the partner login is simply off.
const PARTNER_USERNAME = process.env.PARTNER_USERNAME;
const PARTNER_PASSWORD = process.env.PARTNER_PASSWORD;
const PARTNER_SESSION_TOKEN = process.env.PARTNER_SESSION_TOKEN;

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  const user = typeof username === 'string' ? username.trim().toLowerCase() : '';

  let token: string | undefined;
  let redirect = '/';

  // Owner: username 'jono' (or blank, for old saved logins) + the usual password.
  if (password && APP_PASSWORD && password === APP_PASSWORD && (user === '' || user === OWNER_USERNAME)) {
    token = SESSION_TOKEN;
  } else if (
    PARTNER_USERNAME && PARTNER_PASSWORD && PARTNER_SESSION_TOKEN &&
    user === PARTNER_USERNAME.trim().toLowerCase() &&
    password === PARTNER_PASSWORD
  ) {
    token = PARTNER_SESSION_TOKEN;
    redirect = '/document';
  }

  if (!token) {
    return NextResponse.json({ error: 'Incorrect username or password' }, { status: 401 });
  }

  const res = NextResponse.json({ success: true, redirect });

  res.cookies.set('gdt_session', token, {
    httpOnly: true,
    // Secure only in production (HTTPS on Vercel). Local dev is served over plain
    // HTTP on the LAN (e.g. http://192.168.x.x), where a secure cookie is dropped
    // and login would loop back to the password screen.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // 'strict' breaks iOS PWA home screen apps
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });

  return res;
}
