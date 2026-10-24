import { NextResponse, type NextRequest } from 'next/server';

// Middleware minimo: refuerza headers de seguridad a nivel de borde.
// La auth real (next-auth) se introduce despues; aqui solo se deja la base.
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
