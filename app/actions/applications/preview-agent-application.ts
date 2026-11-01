"use server";

import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import {
  previewAgentApplication,
  type PreviewAgentApplicationResult,
} from "@/helpers/applications/preview-agent-application";

/**
 * SERVER ACTION: the agent's approval card for a proposed `submitApplication`
 * call (see `previewAgentApplication`). Writes nothing. The applicant comes
 * from the session.
 */
export async function previewAgentApplicationAction(input: unknown): Promise<PreviewAgentApplicationResult> {
  const user = await getUserFromRequest();
  if (!user || user.app_metadata?.type === "company") {
    return { ok: false, error: "Sign in with an applicant account to apply." };
  }

  return previewAgentApplication(await createClient(), user, input);
}
