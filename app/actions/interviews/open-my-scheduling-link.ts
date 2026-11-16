"use server";

import { isUuid } from "@/helpers/agent/auth";
import { requireApplicant } from "@/helpers/interview/screening/applicant-rpc";
import { openMySchedulingLink } from "@/helpers/interviews/my-scheduled-interviews";

/**
 * SERVER ACTION (IVT-064, IV-REQ-043): the session applicant's
 * self-scheduling page for one of their interviews, to pick or move its
 * time. rotate_my_scheduling_link checks that it's theirs and still open.
 */
export async function openMySchedulingLinkAction({
  interviewId,
}: {
  interviewId: string;
}): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const auth = await requireApplicant();
  if (!auth.ok) return auth;
  if (!isUuid(interviewId)) return { ok: false, error: "Interview not found." };
  return openMySchedulingLink(auth.supabase, interviewId);
}
