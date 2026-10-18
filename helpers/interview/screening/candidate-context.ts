import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scrubPII } from "@/helpers/ai/fairness";
import { firstName as firstNameOf } from "@/helpers/outreach/linkify";
import { extractSectionText } from "@/utils/extract-resume-content";
import type { TResumeRowContent } from "@/utils/types";
import type { Database } from "@/utils/types/database.types";

export const CANDIDATE_CONTEXT_MAX_CHARS = 8000;

const SECTIONS = ["experience", "skills", "projects", "education"] as const;
const LABELS: Record<(typeof SECTIONS)[number], string> = {
  experience: "Experience",
  skills: "Skills",
  projects: "Projects",
  education: "Education",
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What the voice interviewer knows about the candidate (SI-REQ-022): four
 * resume sections, contact details and links scrubbed, no name but the first
 * (for the greeting). No user_info preferences (salary, visa, location).
 */
export function buildCandidateContext(
  content: TResumeRowContent | null,
  fullName: string | null,
): { firstName: string | null; context: string } {
  const sections = extractSectionText([...SECTIONS], content ?? undefined);
  let context = SECTIONS.filter((type) => sections[type]?.trim())
    .map((type) => `${LABELS[type]}:\n${sections[type]}`)
    .join("\n\n");

  context = scrubPII(context);
  // The rest of the name (last name, middle names) wherever it appears.
  for (const part of (fullName ?? "").trim().split(/\s+/).slice(1)) {
    if (part.length < 2) continue;
    context = context.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, "gi"), "[removed]");
  }

  return { firstName: firstNameOf(fullName), context: context.slice(0, CANDIDATE_CONTEXT_MAX_CHARS) };
}

/**
 * The context for an application, from the resume the candidate applied
 * with. Call with the service role, after the caller is known to be the
 * applicant.
 */
export async function loadCandidateContext(
  admin: SupabaseClient<Database>,
  applicationId: string,
): Promise<{ ok: true; firstName: string | null; context: string } | { ok: false; error: string }> {
  const { data: application, error } = await admin
    .from("applications")
    .select("resume_id, applicant_user_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load the application: ${error.message}`);
  if (!application?.resume_id || !application.applicant_user_id) {
    return { ok: false, error: "This application has no resume." };
  }

  const { data: resume, error: resumeError } = await admin
    .from("resumes")
    .select("content")
    .eq("id", application.resume_id)
    .eq("user_id", application.applicant_user_id)
    .maybeSingle();
  if (resumeError) throw new Error(`Couldn't load the resume: ${resumeError.message}`);
  if (!resume) return { ok: false, error: "This application has no resume." };

  const { data: profile } = await admin
    .from("user_info")
    .select("full_name")
    .eq("user_id", application.applicant_user_id)
    .maybeSingle();

  return {
    ok: true,
    ...buildCandidateContext((resume.content as TResumeRowContent | null) ?? null, profile?.full_name ?? null),
  };
}
