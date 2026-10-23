import { NextResponse, type NextRequest } from "next/server";
import { AUTH_ROUTES, SESSION_COOKIE, isAppRoute } from "@/lib/routes";

// A presence check only: it keeps signed-out visitors off app pages. The backend still
// verifies the JWT on every API call, which is where real authorization happens.
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const signedIn = req.cookies.has(SESSION_COOKIE);

  if (!signedIn && isAppRoute(pathname)) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (signedIn && AUTH_ROUTES.includes(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|api/|favicon.ico|.*\\..*).*)"],
};
