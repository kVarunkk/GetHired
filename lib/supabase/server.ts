import { Database } from "@/utils/types/database.types";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

let clientCreationCount = 0;

export async function createClient() {
  clientCreationCount++;
  if (clientCreationCount % 10 === 0) {
    console.log(`[supabase] createClient called ${clientCreationCount} times`);
  }

  const cookieStore = await cookies();
  const headersList = await headers();

  // A bearer token (e.g. the browser extension) is forwarded to PostgREST.
  const authHeader = headersList.get("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "")
    : null;

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
