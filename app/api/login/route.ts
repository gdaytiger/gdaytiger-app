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
    secure: true,
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  return res;
}
