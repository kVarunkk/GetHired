import { Database } from "@/utils/types/database.types";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { createServiceRoleClient } from "./service-role";
import { hashToken } from "@/utils/edgeUtils";

let clientCreationCount = 0;

export async function createClient() {
  clientCreationCount++;
  if (clientCreationCount % 10 === 0) {
    console.log(`[supabase] createClient called ${clientCreationCount} times`);
  }

  const cookieStore = await cookies();
  const headersList = await headers();

  // Check for Bearer token (MCP / API key clients)
  const authHeader = headersList.get("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "")
    : null;

  if (bearerToken?.startsWith("gh_")) {
    const tokenHash = await hashToken(bearerToken);
    const serviceClient = createServiceRoleClient();

    const { data: tokenRow } = await serviceClient
      .from("user_api_tokens")
      .select("user_id")
      .eq("token_hash", tokenHash)
      .single();

    if (!tokenRow) {
      // Return unauthenticated client — routes will get null from getUserFromRequest
      return createServerClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => [], setAll: () => {} } },
      );
    }

    // Fire and forget — don't await
    serviceClient
      .from("user_api_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("token_hash", tokenHash);

    return serviceClient; // caller uses user_id from getUserFromRequest
  }

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
      },
      global: bearerToken
        ? { headers: { Authorization: `Bearer ${bearerToken}` } }
        : undefined,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    },
  );
}
