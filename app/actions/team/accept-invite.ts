"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { setUserAppMetadata } from "@/helpers/user/set-app-metadata";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import {
  APPLICANT_INVITE_MESSAGE,
  INVALID_INVITE_MESSAGE,
  TEAM_FALLBACK_ERROR,
  asTeamRpcResult,
  teamErrorMessage,
} from "@/helpers/team/errors";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
    displayName: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((v) => v || null),
  })
  .strict();

/**
 * SERVER ACTION (TM-REQ-003): the signed-in user accepts an invite. The RPC
 * checks the token, expiry, email, account type and seats in one transaction
 * and adds the membership. Only then is `app_metadata` set (TM-SEC-004), and
 * the session refreshed so the middleware sees the new claims.
 */
export async function acceptInviteAction(
  input: z.input<typeof inputSchema>,
): Promise<
  | { ok: true; roleName: string | null; fellBack: boolean }
  | { ok: false; error: string }
> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: teamErrorMessage("not_signed_in") };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_INVITE_MESSAGE };

  // Accounts have one type; the RPC refuses candidates too (user_info row).
  if (user.app_metadata?.type === "applicant")
    return { ok: false, error: APPLICANT_INVITE_MESSAGE };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_company_invite", {
    p_token: parsed.data.token,
    p_display_name: parsed.data.displayName ?? undefined,
  });
  console.log("error 1: ", error);
  if (error) return { ok: false, error: TEAM_FALLBACK_ERROR };
  const result = asTeamRpcResult(data);
  if (!result.ok) return { ok: false, error: teamErrorMessage(result.reason) };

  const { error: metadataError } = await setUserAppMetadata(user.id, {
    type: "company",
    onboarding_complete: true,
  });
  console.log("error 2: ", metadataError);
  if (metadataError) return { ok: false, error: TEAM_FALLBACK_ERROR };

  await supabase.auth.refreshSession();

  revalidatePath("/company", "layout");
  await eventCaptureServer({
    event: PostHogEvent.TeamInviteAccepted,
    distinctId: user.id,
  });
  // RP-REQ-007: the invite's role was deleted, so they joined with the default role.
  const role = result.role as { name?: string } | null | undefined;
  return {
    ok: true,
    roleName: role?.name ?? null,
    fellBack: Boolean(result.fell_back),
  };
}
