import { createClient } from "@supabase/supabase-js";
import { Database } from "@/utils/types/database.types";

let _publicClient: ReturnType<typeof createClient<Database>> | null = null;

export function createPublicClient() {
  if (_publicClient) return _publicClient;

  _publicClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  return _publicClient;
}
