import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Merges `dataToUpdate` into a user's `app_metadata` with the service-role
 * client. Server-only and deliberately NOT a server action (SEC-008): callers
 * must have decided, on the server, that they may act on `userId` (e.g. a user
 * they just created). Never pass it ids or data that came from the browser.
 */
export async function setUserAppMetadata(
  userId: string,
  dataToUpdate: Record<string, string | boolean>,
): Promise<{ error: string | null }> {
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
    return { error: null };
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
    return { error };
  }
}
