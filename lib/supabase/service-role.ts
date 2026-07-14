// import { Database } from "@/utils/types/database.types";
// import { createClient } from "@supabase/supabase-js";

// export const createServiceRoleClient = () => {
//   const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
//   const supabaseServiceKey = process.env.SERVICE_ROLE_KEY!;

//   return createClient<Database>(supabaseUrl, supabaseServiceKey, {
//     auth: {
//       persistSession: false,
//     },
//   });
// };

import { Database } from "@/utils/types/database.types";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient<Database> | null = null;

export const createServiceRoleClient = () => {
  if (_client) return _client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SERVICE_ROLE_KEY!;

  _client = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return _client;
};
