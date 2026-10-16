"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

// OR-REQ-030 / OR-TEST-006: an applicant shares one completed mock interview
// session and/or one completed resume review with the company of one of
// their applications. Everything runs with the session's client: RLS and the
// application_attachments_check trigger decide ownership too, and the
// checks here only give a clear answer before the insert.

const attachSchema = z.discriminatedUnion("kind", [
  z
    .object({
      applicationId: z.string().uuid(),
      kind: z.literal("interview_session"),
      interviewSessionId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      applicationId: z.string().uuid(),
      kind: z.literal("resume_review"),
      resumeReviewId: z.string().uuid(),
    })
    .strict(),
]);
const detachSchema = z.object({ attachmentId: z.string().uuid() }).strict();

export type AttachInput = z.input<typeof attachSchema>;
export type AttachResult =
  | { ok: true; attachmentId: string; analysisQueued: boolean }
  | { ok: false; error: string };
export type DetachResult = { ok: true } | { ok: false; error: string };

export type ShareableSignals = {
  sessions: { id: string; label: string; endedAt: string | null }[];
  reviews: { id: string; label: string; score: number | null }[];
};

const NOT_FOUND = "We couldn't find that to share.";

/** SERVER ACTION: the session user's completed interview sessions and resume reviews. */
export async function listShareableSignalsAction(): Promise<ShareableSignals> {
  const user = await getUserFromRequest();
  if (!user) return { sessions: [], reviews: [] };

  const supabase = await createClient();
  const [{ data: sessions }, { data: reviews }] = await Promise.all([
    supabase
      .from("interview_sessions")
      .select("id, ended_at, started_at, interviews!inner(name, user_id)")
      .eq("interviews.user_id", user.id)
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(10),
    supabase
      .from("resume_reviews")
      .select("id, name, score, created_at")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return {
    sessions: (sessions ?? []).map((s) => ({
      id: s.id,
      label: s.interviews?.name || "Mock interview",
      endedAt: s.ended_at ?? s.started_at,
    })),
    reviews: (reviews ?? []).map((r) => ({
      id: r.id,
      label: r.name || "Resume review",
      score: r.score,
    })),
  };
}

/** SERVER ACTION: shares a session or review with the company of one of the user's applications. */
export async function attachToApplicationAction(input: AttachInput): Promise<AttachResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = attachSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: NOT_FOUND };
  const data = parsed.data;

  const supabase = await createClient();

  const { data: application } = await supabase
    .from("applications")
    .select("id")
    .eq("id", data.applicationId)
    .eq("applicant_user_id", user.id)
    .maybeSingle();
  if (!application) return { ok: false, error: NOT_FOUND };

  if (data.kind === "interview_session") {
    const { data: session } = await supabase
      .from("interview_sessions")
      .select("id, interviews!inner(user_id)")
      .eq("id", data.interviewSessionId)
      .eq("interviews.user_id", user.id)
      .eq("status", "completed")
      .maybeSingle();
    if (!session) return { ok: false, error: NOT_FOUND };
  } else {
    const { data: review } = await supabase
      .from("resume_reviews")
      .select("id")
      .eq("id", data.resumeReviewId)
      .eq("user_id", user.id)
      .eq("status", "completed")
      .maybeSingle();
    if (!review) return { ok: false, error: NOT_FOUND };
  }

  const { data: inserted, error } = await supabase
    .from("application_attachments")
    .insert({
      application_id: data.applicationId,
      kind: data.kind,
      interview_session_id: data.kind === "interview_session" ? data.interviewSessionId : null,
      resume_review_id: data.kind === "resume_review" ? data.resumeReviewId : null,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    if (error?.code === "23505") {
      return {
        ok: false,
        error:
          data.kind === "interview_session"
            ? "You've already shared an interview with this application."
            : "You've already shared a resume review with this application.",
      };
    }
    return { ok: false, error: NOT_FOUND };
  }

  // The company report: inserted and queued once per session, however many
  // applications share it (enqueue_company_interview_analysis).
  let analysisQueued = false;
  if (data.kind === "interview_session") {
    const { data: queued, error: queueError } = await supabase.rpc("enqueue_company_interview_analysis", {
      p_session: data.interviewSessionId,
    });
    if (queueError) {
      console.error("[attachments] couldn't queue the company analysis", queueError.message);
    } else {
      analysisQueued = (queued as { queued?: boolean } | null)?.queued === true;
    }
  }

  revalidatePath("/jobs");
  return { ok: true, attachmentId: inserted.id, analysisQueued };
}

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
