"use server";

import { setPrimaryResume } from "@/helpers/resumes/set-primary-resume";
import { createClient } from "@/lib/supabase/server";

/**
 * Server action to update the user's primary resume. It refreshes the
 * embedding and queues new matches (setPrimaryResume).
 */
export async function setPrimaryResumeAction(resumeId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized access." };
  }

  return setPrimaryResume(user, resumeId);
}
