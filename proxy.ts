import { NextResponse, type NextRequest } from 'next/server';

// Auth.js adds the __Secure- prefix whenever the site URL is HTTPS, so local
// development and every deployment use different names for the same cookie.
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token'];

// Routing, not authorisation. This only saves a wasted render — a stale or
// forged cookie passes here and is rejected by auth() in the (app) layout.
// It imports nothing from lib/ on purpose: Next's proxy docs warn against
// relying on shared modules, and lib/db holds a connection pool.
export function proxy(request: NextRequest) {
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) {
    return NextResponse.next();
  }

  const signin = new URL('/signin', request.url);
  signin.searchParams.set('callbackUrl', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(signin);
}

export const config = { matcher: '/boards/:path*' };
