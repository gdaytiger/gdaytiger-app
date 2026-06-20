import { NextRequest, NextResponse } from 'next/server';

const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_TOKEN = process.env.SESSION_TOKEN;

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!password || password !== APP_PASSWORD) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });

  res.cookies.set('gdt_session', SESSION_TOKEN!, {
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
