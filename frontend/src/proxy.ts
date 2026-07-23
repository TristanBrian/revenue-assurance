// Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts` (the
// exported function is `proxy`, not `middleware`) — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
// and .../02-guides/upgrading/version-16.md. Writing `middleware.ts` here
// would silently do nothing in this Next.js version.
//
// This is a UX-level gate only, not the real authorization boundary — the
// FastAPI backend enforces permissions on every route regardless of what
// this redirects. Its only job is avoiding a flash of a dashboard shell
// before bouncing to /login.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TOKEN_COOKIE = "kpc_auth_token";

export function proxy(request: NextRequest) {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
