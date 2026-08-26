import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/server/session'
import { assertSameOrigin } from '@/lib/server/auth'

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return NextResponse.json({ error: 'invalid_origin' }, { status: 403 })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
