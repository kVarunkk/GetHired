import { reportError } from "@/helpers/posthog/report-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

// The applicant's own screening interviews, read through
// my_screening_interviews(): no questions or competency descriptions
// (difference 18, SI-REQ-020).

export type MyScreeningInterview = Database["public"]["Functions"]["my_screening_interviews"]["Returns"][number];

/** What the apply form's success card needs (SIT-050). */
export type ScreeningInviteSummary = { id: string; durationMinutes: number; deadlineAt: string };

export async function listMyScreeningInterviews(supabase: SupabaseClient<Database>): Promise<MyScreeningInterview[]> {
  const { data, error } = await supabase.rpc("my_screening_interviews");
  if (error) {
    reportError("[screening] couldn't list my interviews", error.message);
    return [];
  }
  return data ?? [];
}

export async function getMyScreeningInterview(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<MyScreeningInterview | null> {
  const { data } = await supabase.rpc("my_screening_interviews").eq("id", id).maybeSingle();
  return data ?? null;
}

/** The interview of one application, when the applicant has been invited. */
export async function getScreeningInviteForApplication(
  supabase: SupabaseClient<Database>,
  applicationId: string,
): Promise<ScreeningInviteSummary | null> {
  const { data } = await supabase
    .rpc("my_screening_interviews")
    .eq("application_id", applicationId)
    .eq("status", "invited")
    .maybeSingle();
  return data ? { id: data.id, durationMinutes: data.duration_minutes, deadlineAt: data.deadline_at } : null;
}
