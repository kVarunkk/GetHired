"use server";

import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function updateUserAppMetadata(
  userId: string,
  dataToUpdate: Record<string, string | boolean>,
) {
  try {
    if (!userId || !dataToUpdate)
      throw new Error("User id or updation data not found.");
    const serviceRoleSupabase = createServiceRoleClient();
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
  } catch (err) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while updating user metadata.";
    await eventCaptureServerException({
      error: err,
      distinctId: userId,
      properties: { flow: "update_user_metadata" },
    });

    return {
      error,
    };
  }
}
