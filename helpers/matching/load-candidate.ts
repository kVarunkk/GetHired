import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { TResumeRowContent } from "@/utils/types";

/** The job columns `buildMatchInput` / `buildScreeningInput` read. */
export const MATCH_JOB_COLUMNS =
  "id, company_id, title, description, skills, min_experience, max_experience, experience, location, job_type, salary_currency, min_salary, max_salary, salary_range, visa_sponsorship, questions";

/**
 * A candidate's profile and primary resume for a matching prompt. Call it with
 * the service role, and only after checking the company may see the
 * candidate. The prompt builders strip protected fields (MT-SEC-002).
 * With `resumeId` (an application's resume) that resume is used instead of
 * the primary one. Returns null when the profile doesn't exist.
 */
export async function loadCandidate(
  admin: SupabaseClient<Database>,
  userId: string,
  { resumeId }: { resumeId?: string | null } = {},
): Promise<{ profile: Record<string, unknown>; resume: TResumeRowContent | null } | null> {
  const { data: profile, error } = await admin
    .from("user_info")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the candidate: ${error.message}`);
  if (!profile) return null;

  const resumes = admin.from("resumes").select("content").eq("user_id", userId);
  const { data: resume } = await (resumeId
    ? resumes.eq("id", resumeId)
    : resumes.eq("is_primary", true)
  )
    .limit(1)
    .maybeSingle();

  return {
    profile: profile as Record<string, unknown>,
    resume: (resume?.content as TResumeRowContent | null | undefined) ?? null,
  };
}

/**
 * A talent-pool candidate's directory profile and scrubbed resume sections,
 * read with the company's own client through `candidate_directory` (no
 * contact columns; OR-SEC-001). Returns null when the candidate isn't in the
 * directory for this company (private, or they blocked it).
 */
export async function loadDirectoryCandidate(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ profile: Record<string, unknown>; resume: TResumeRowContent | null } | null> {
  const { data, error } = await supabase
    .from("candidate_directory")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the candidate: ${error.message}`);
  if (!data) return null;

  const { resume_sections, ...profile } = data;
  const sections = Array.isArray(resume_sections) ? resume_sections : [];
  return {
    profile,
    resume: sections.length ? ({ sections } as unknown as TResumeRowContent) : null,
  };
}
