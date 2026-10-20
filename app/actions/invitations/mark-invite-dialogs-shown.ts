"use server";

import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ emails: z.array(z.string().email()).min(1).max(50) }).strict();

export type MarkInviteDialogsShownResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION (BW-F04): records that the session user saw the "invite accepted" dialog for these invitations. */
export async function markInviteDialogsShownAction(
  input: z.input<typeof inputSchema>,
): Promise<MarkInviteDialogsShownResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invitations." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("invitations")
    .update({ isDialogShown: true })
    .eq("referrer_user_id", user.id)
    .in("invited_email", parsed.data.emails);
  if (error) return { ok: false, error: "Some error occured while updating the invitations." };

  return { ok: true };
}
