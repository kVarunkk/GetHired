import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { TResumeRowContent } from "@/utils/types";
import { hasScreenableDetail } from "@/helpers/candidates/screenable";

/**
 * The company candidate columns a screening prompt may use (BI-REQ-031).
 * Never tags or notes (BI-SEC-005), and no contact details.
 */
const PROMPT_COLUMNS =
  "id, full_name, current_title, current_company, location, experience_years, skills, resume_content";

/**
 * A company candidate as `buildScreeningInput` takes a profile and resume,
 * beside `loadCandidate` for GetHired applicants. `full_name` is only there
 * so the prompt builder can scrub it. `screenable` is `hasScreenableDetail`.
 * Call it with the service role. Null when the candidate is gone.
 */
export async function loadCompanyCandidate(
  admin: SupabaseClient<Database>,
  candidateId: string,
): Promise<{ profile: Record<string, unknown>; resume: TResumeRowContent | null; screenable: boolean } | null> {
  const { data, error } = await admin
    .from("company_candidates")
    .select(PROMPT_COLUMNS)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the candidate: ${error.message}`);
  if (!data) return null;

  return {
    profile: {
      full_name: data.full_name,
      current_title: data.current_title,
      current_company: data.current_company,
      location: data.location,
      experience_years: data.experience_years,
      top_skills: data.skills,
    },
    resume: (data.resume_content as TResumeRowContent | null) ?? null,
    screenable: hasScreenableDetail(data),
  };
}
