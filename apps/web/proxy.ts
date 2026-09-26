import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseConfig } from "@/lib/supabase/config";

const PUBLIC_PREFIXES = ["/login", "/auth/", "/api/webhooks/", "/api/v1/", "/api/public/", "/api/health", "/api/openapi", "/chat/", "/widget.js", "/robots.txt", "/sitemap.xml"];
/** Public commercial website: exact page or its sub-pages (not arbitrary prefixes like "/demonios"). */
const PUBLIC_PAGES = ["/soluciones", "/sectores", "/precios", "/casos-de-uso", "/demo", "/contacto", "/privacidad", "/aviso-legal"];

export function isPublicPath(path: string): boolean {
  if (path === "/") return true;
  if (PUBLIC_PAGES.some((p) => path === p || path.startsWith(`${p}/`))) return true;
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);

  let response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);

  const cfg = supabaseConfig();
  if (!cfg) return response; // setup mode: pages render the configuration checklist

  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers } });
        response.headers.set("x-request-id", requestId);
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // Refreshes the session cookie when needed. Must run before any redirect.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = isPublicPath(path);
  if (!user && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "x-request-id": requestId } });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
