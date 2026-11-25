"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

// Interviews shared with a company before AP-REQ-040 keep showing to it, and
// can still be un-shared here. Sharing at apply time is gone. Runs with the
// session's client, so RLS decides ownership too.

const detachSchema = z.object({ attachmentId: z.string().uuid() }).strict();

export type DetachResult = { ok: true } | { ok: false; error: string };

const NOT_FOUND = "We couldn't find that to share.";

/** SERVER ACTION: un-shares an attachment, only until the company opens it. */
export async function detachFromApplicationAction(
  input: z.input<typeof detachSchema>,
): Promise<DetachResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = detachSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };

  const supabase = await createClient();
  const { data: attachment } = await supabase
    .from("application_attachments")
    .select("id, first_viewed_at, applications!inner(applicant_user_id)")
    .eq("id", parsed.data.attachmentId)
    .eq("applications.applicant_user_id", user.id)
    .maybeSingle();
  if (!attachment) return { ok: false, error: NOT_FOUND };
  if (attachment.first_viewed_at) return { ok: false, error: "The company has already opened it." };

  const { data: deleted, error } = await supabase
    .from("application_attachments")
    .delete()
    .eq("id", attachment.id)
    .is("first_viewed_at", null)
    .select("id");
  if (error) return { ok: false, error: "Couldn't remove it. Try again." };
  // Opened between the read and the delete.
  if (!deleted?.length) return { ok: false, error: "The company has already opened it." };

  revalidatePath("/jobs");
  return { ok: true };
}
