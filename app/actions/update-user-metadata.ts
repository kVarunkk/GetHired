"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function updateUserAppMetadata(
  userId: string,
  dataToUpdate: Record<string, string | boolean>
) {
  try {
    if (!userId || !dataToUpdate)
      throw new Error("User id or updation data not found.");
    const serviceRoleSupabase = createServiceRoleClient();
    // const { data, error } = await serviceRoleSupabase.auth.getUser();
    const { data, error } =
      await serviceRoleSupabase.auth.admin.getUserById(userId);
    if (!data.user || error) throw new Error("Error retrieving User.");
    const { error: updateAppMetaError } =
      await serviceRoleSupabase.auth.admin.updateUserById(userId, {
        app_metadata: {
          ...data.user.app_metadata,
          ...dataToUpdate,
        },
      });
    if (updateAppMetaError) throw new Error("Error updating user metadata.");
    return {
      error: null,
    };
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "Unexpected error occured while updating user metadata",
    };
  }
}
