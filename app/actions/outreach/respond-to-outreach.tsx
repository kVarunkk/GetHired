"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { render } from "react-email";
import { z } from "zod";
import OutreachReplyEmail from "@/emails/OutreachReplyEmail";
import {
  DECLINE_REASONS,
  OUTREACH_CONTACT_MAX,
  OUTREACH_NOTE_MAX,
} from "@/helpers/outreach/config";
import { mapOutreachError } from "@/helpers/outreach/errors";
import { firstName } from "@/helpers/outreach/linkify";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import { PostHogEvent } from "@/utils/types";
import type { CandidateOutreach } from "@/utils/types/outreach.types";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const inputSchema = z
  .object({
    outreachId: z.string().uuid(),
    status: z.enum(["interested", "not_interested", "reported"]),
    reason: z.enum(DECLINE_REASONS).nullable().optional(),
    note: optionalText(OUTREACH_NOTE_MAX),
    contact: optionalText(OUTREACH_CONTACT_MAX),
    block: z.boolean().optional(),
  })
  .strict();

export type RespondToOutreachInput = z.input<typeof inputSchema>;
export type RespondToOutreachResult =
  | { ok: true; outreach: CandidateOutreach }
  | { ok: false; error: string };

/**
 * SERVER ACTION (OR-TASK-002, OR-SEC-003): the candidate answers an outreach.
 * The user comes from the session and `respond_to_outreach` runs with their
 * client, so the DB decides who may answer. The sender is emailed afterwards;
 * a report goes to the admin and nothing goes to the company.
 */
export async function respondToOutreachAction(
  input: RespondToOutreachInput,
): Promise<RespondToOutreachResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in to answer." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check your answer and try again." };
  const { outreachId, status, reason, note, contact, block } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_to_outreach", {
    p_id: outreachId,
    p_status: status,
    p_reason: (reason ?? null) as string,
    p_note: (note ?? null) as string,
    p_contact: (contact ?? null) as string,
    p_block: block ?? false,
  });
  if (error || !data) return { ok: false, error: mapOutreachError(error).message };

  const outreach = data as CandidateOutreach;

  after(() => notifyAfterResponse(outreach));
  revalidatePath("/opportunities");
  revalidatePath(`/opportunities/${outreach.id}`);

  await eventCaptureServer({
    event: PostHogEvent.OutreachReplied,
    distinctId: user.id,
    // Never the note or the contact.
    properties: { status, has_reason: Boolean(outreach.decline_reason), blocked: block ?? false },
  });

  return { ok: true, outreach };
}

async function notifyAfterResponse(outreach: CandidateOutreach) {
  try {
    if (outreach.status === "reported") {
      await sendEmailForStatusUpdate(
        `Outreach ${outreach.id} from company ${outreach.company_id} was reported by candidate ${outreach.candidate_user_id}.` +
          (outreach.candidate_note ? ` Note: ${outreach.candidate_note}` : ""),
      );
      return;
    }
    if (outreach.status !== "interested" && outreach.status !== "not_interested") return;
    if (!outreach.sender_user_id) return;

    const service = createServiceRoleClient();
    const [{ data: sender }, { data: candidate }, job] = await Promise.all([
      service.auth.admin.getUserById(outreach.sender_user_id),
      service.from("user_info").select("full_name").eq("user_id", outreach.candidate_user_id).maybeSingle(),
      outreach.job_post_id
        ? service.from("job_postings").select("title").eq("id", outreach.job_post_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const toEmail = sender?.user?.email;
    if (!toEmail) return;

    const name = firstName(candidate?.full_name) ?? "The candidate";
    const email = (
      <OutreachReplyEmail
        candidateFirstName={name}
        status={outreach.status}
        subject={outreach.subject}
        jobTitle={job.data?.title ?? null}
        note={outreach.candidate_note}
        contact={outreach.candidate_contact}
        declineReason={outreach.decline_reason}
        profileUrl={`${deploymentUrl()}/company/profiles/${outreach.candidate_user_id}`}
      />
    );
    const [htmlContent, textContent] = await Promise.all([
      render(email),
      render(email, { plainText: true }),
    ]);
    await sendEmail({
      toEmail,
      subject:
        outreach.status === "interested"
          ? `${name} is interested: ${outreach.subject}`
          : `${name} replied: ${outreach.subject}`,
      htmlContent,
      textContent,
    });
  } catch (err) {
    console.error("[outreach] reply notification failed:", err);
  }
}
