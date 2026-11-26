import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { UserAppMetadata } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/utils/types/database.types";

export type MiddlewareAuth = {
  /** Only what routing needs. Null when signed out. */
  user: { app_metadata: Partial<UserAppMetadata> } | null;
  /**
   * Puts a refreshed session's cookies, and the cache headers that go with
   * them, on the response the middleware returns, redirects included.
   */
  withSessionCookies: <T extends NextResponse>(response: T) => T;
};

/**
 * Whether the token's metadata is enough to route on. It's as old as the token,
 * so an account that has just been set up can still look unfinished; routing on
 * that would send it back to onboarding.
 */
function isSettled(metadata: Partial<UserAppMetadata>) {
  if (metadata.type === "applicant") return true;
  return metadata.type === "company" && metadata.onboarding_complete === true;
}

/**
 * The middleware's view of the session. `getClaims()` verifies the token
 * against the project's cached public keys (ES256), so most requests don't call
 * the Auth server, and it refreshes a session that is about to expire.
 *
 * It can't see that a session was revoked before the token expires. This only
 * decides routing: pages, actions and API routes that read or change data call
 * `getUser()` or rely on RLS.
 *
 * https://supabase.com/docs/guides/auth/server-side/nextjs
 */
export async function getMiddlewareAuth(
  request: NextRequest,
  bearerToken: string | null,
): Promise<MiddlewareAuth> {
  const cookiesToSet = new Map<string, { value: string; options: CookieOptions }>();
  let cacheHeaders: Record<string, string> = {};

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: bearerToken ? { headers: { Authorization: `Bearer ${bearerToken}` } } : undefined,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies, headers) {
          for (const { name, value, options } of cookies) {
            // So the page rendering this request reads the new session.
            request.cookies.set(name, value);
            cookiesToSet.set(name, { value, options });
          }
          cacheHeaders = { ...cacheHeaders, ...headers };
        },
      },
    },
  );

  const withSessionCookies = <T extends NextResponse>(response: T): T => {
    for (const [name, { value, options }] of cookiesToSet) {
      response.cookies.set(name, value, options);
    }
    for (const [name, value] of Object.entries(cacheHeaders)) {
      response.headers.set(name, value);
    }
    return response;
  };

  const readUser = async (): Promise<MiddlewareAuth["user"]> => {
    try {
      const { data, error } = await supabase.auth.getClaims(bearerToken ?? undefined);
      // No token at all: signed out, with nothing to ask the Auth server.
      if (!data && !error) return null;
      const metadata = data?.claims.app_metadata;
      if (metadata && isSettled(metadata)) return { app_metadata: metadata };
    } catch {
      // The keys couldn't be read; the Auth server decides below.
    }
    const { data } = await supabase.auth.getUser(bearerToken ?? undefined);
    return data.user;
  };

  const user = await readUser();
  return { user, withSessionCookies };
}
