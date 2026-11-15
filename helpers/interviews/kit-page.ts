import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { loadInterviewKit } from "@/helpers/interviews/scorecards";
import { createClient } from "@/lib/supabase/server";

// Same path as `kitPath` in feedback-emails, which pulls in the email renderer.
const kitBase = (interviewId: string) => `/company/interviews/${interviewId}`;

/**
 * What every page of an interview kit's layout needs: the session and the kit
 * (`get_interview_kit` checks the panel and the access window). Cached for
 * the request, so the layout and the section page share one load. Null when
 * the id isn't a uuid, the viewer isn't a company member, or the kit isn't
 * theirs.
 */
export const loadKitFrame = cache(async (interviewId: string) => {
  if (!isUuid(interviewId)) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const company = user ? await getMyCompany(supabase, user) : null;
  if (!company) return null;
  const result = await loadInterviewKit(supabase, interviewId);
  if (!result.ok && result.reason === "not_found") return null;
  return { supabase, result, base: kitBase(interviewId) };
});

/**
 * For a section page that needs the full kit: the frame, or a redirect to the
 * kit's index once the kit has closed (the index then shows the scorecard).
 * The layout handles a missing or expired kit, so this never renders them.
 */
export async function requireOpenKit(interviewId: string) {
  const frame = await loadKitFrame(interviewId);
  if (!frame || !frame.result.ok) notFound();
  const { kit } = frame.result;
  if (kit.access !== "kit") redirect(frame.base);
  return { supabase: frame.supabase, base: frame.base, kit };
}
