import { createClient } from "./server";

export async function getUserFromRequest() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
