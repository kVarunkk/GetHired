import { headers } from "next/headers";
import { createClient } from "./server";
import { hashToken } from "@/utils/edgeUtils";
import { createServiceRoleClient } from "./service-role";

export async function getUserFromRequest() {
  const headersList = await headers();
  const authHeader = headersList.get("Authorization");
  const bearerToken = authHeader?.replace("Bearer ", "");

  if (bearerToken && bearerToken.startsWith("gh_")) {
    const tokenHash = await hashToken(bearerToken);
    const serviceClient = createServiceRoleClient();
    const { data } = await serviceClient
      .from("user_api_tokens")
      .select("user_id")
      .eq("token_hash", tokenHash)
      .single();

    if (!data) return null;

    serviceClient
      .from("user_api_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("token_hash", tokenHash);

    const {
      data: { user },
    } = await serviceClient.auth.admin.getUserById(data.user_id);
    return user;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
