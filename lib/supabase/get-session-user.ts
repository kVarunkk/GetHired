import type { User } from "@supabase/supabase-js";
import { createClient } from "./server";

/** What the app's frame shows about the signed-in user. A `User` fits it too. */
export type SessionUser = Pick<User, "id" | "email" | "app_metadata" | "user_metadata">;

/**
 * Who is signed in, for the root layout: the sidebar and analytics. Every page
 * waits for the layout, so this reads the session token. `getClaims()` checks
 * it against the project's cached public keys (ES256), where `getUser()` asks
 * the Auth server each time.
 *
 * It can't see that a session was revoked before the token expires, and the
 * metadata is as old as the token. For display only: anything that reads or
 * changes data calls `getUser()` or relies on RLS.
 *
 * https://supabase.com/docs/reference/javascript/auth-getclaims
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.auth.getClaims();
    // No session: nothing to ask the Auth server about.
    if (!data && !error) return null;
    const claims = data?.claims;
    if (claims) {
      return {
        id: claims.sub,
        email: claims.email,
        app_metadata: claims.app_metadata ?? {},
        user_metadata: claims.user_metadata ?? {},
      };
    }
  } catch {
    // The keys couldn't be read; the Auth server decides below.
  }
  const { data } = await supabase.auth.getUser();
  return data.user;
}
