import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scrubPII } from "@/helpers/ai/fairness";
import { readResumeSnapshot } from "@/helpers/applications/resume-snapshot";
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

const NO_RESUME = "This application has no resume.";

const escapeRegExp =(text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  const context = SECTIONS.filter((type) => sections[type]?.trim())
    .map((type) => `${LABELS[type]}:\n${sections[type]}`)
    .join("\n\n");

  return scrubbed(context, fullName);
}

/**
 * The context for an imported candidate with no resume (BIT-103): title,
 * company, years and skills from the company's record, scrubbed the same way.
 */
export function buildShortCandidateContext(
  candidate: {
    current_title: string | null;
    current_company: string | null;
    experience_years: number | null;
    skills: readonly string[] | null;
  },
  fullName: string | null,
): { firstName: string | null; context: string } {
  const title = candidate.current_title?.trim();
  const company = candidate.current_company?.trim();
  const role = [title, company && (title ? `at ${company}` : company)].filter(Boolean).join(" ");
  const years =
    typeof candidate.experience_years === "number"
      ? `${candidate.experience_years} ${candidate.experience_years === 1 ? "year" : "years"} of experience`
      : "";
  const experience = [role, years].filter(Boolean).join(", ");
  const skills = (candidate.skills ?? []).map((s) => s.trim()).filter(Boolean).join(", ");

  const context = [experience && `Experience:\n${experience}`, skills && `Skills:\n${skills}`]
    .filter(Boolean)
    .join("\n\n");

  return scrubbed(context, fullName);
}

/** Contact details and links scrubbed, and every part of the name but the first. */
function scrubbed(text: string, fullName: string | null): { firstName: string | null; context: string } {
  let context = scrubPII(text);
  // The rest of the name (last name, middle names) wherever it appears.
  for (const part of (fullName ?? "").trim().split(/\s+/).slice(1)) {
    if (part.length < 2) continue;
    context = context.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, "gi"), "[removed]");
  }

  return { firstName: firstNameOf(fullName), context: context.slice(0, CANDIDATE_CONTEXT_MAX_CHARS) };
}

/**
 * The context for an application, from the resume the candidate applied
 * with. An imported application (claimed) has none, so it falls back to the
 * company's record: its resume, or else its title, company, years and skills
 * (BIT-103). Call with the service role, after the caller is known to be the
 * applicant.
 */
export async function loadCandidateContext(
  admin: SupabaseClient<Database>,
  applicationId: string,
): Promise<{ ok: true; firstName: string | null; context: string } | { ok: false; error: string }> {
  const { data: application, error } = await admin
    .from("applications")
    .select("resume_id, resume_snapshot, applicant_user_id, company_candidate_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load the application: ${error.message}`);
  const snapshot = readResumeSnapshot(application?.resume_snapshot);
  if (application && !snapshot && !application.resume_id && application.company_candidate_id) {
    return companyCandidateContext(admin, application.company_candidate_id);
  }
  if (!application?.applicant_user_id || (!snapshot && !application.resume_id)) {
    return { ok: false, error: NO_RESUME };
  }

  // What was sent (RE-REQ-062), or for an older application its live resume.
  let content = snapshot?.content as unknown as TResumeRowContent | null | undefined;
  if (!snapshot) {
    const { data: resume, error: resumeError } = await admin
      .from("resumes")
      .select("content")
      .eq("id", application.resume_id!)
      .eq("user_id", application.applicant_user_id)
      .maybeSingle();
    if (resumeError) throw new Error(`Couldn't load the resume: ${resumeError.message}`);
    if (!resume) return { ok: false, error: NO_RESUME };
    content = resume.content as TResumeRowContent | null;
  }

  const { data: profile } = await admin
    .from("user_info")
    .select("full_name")
    .eq("user_id", application.applicant_user_id)
    .maybeSingle();

  return { ok: true, ...buildCandidateContext(content ?? null, profile?.full_name ?? null) };
}

async function companyCandidateContext(
  admin: SupabaseClient<Database>,
  candidateId: string,
): Promise<{ ok: true; firstName: string | null; context: string } | { ok: false; error: string }> {
  // No contact details, tags or notes (BI-SEC-005).
  const { data: candidate, error } = await admin
    .from("company_candidates")
    .select("full_name, current_title, current_company, experience_years, skills, resume_content")
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load the candidate: ${error.message}`);
  if (!candidate) return { ok: false, error: NO_RESUME };

  const fromResume = buildCandidateContext(
    (candidate.resume_content as TResumeRowContent | null) ?? null,
    candidate.full_name,
  );
  const built = fromResume.context.trim() ? fromResume : buildShortCandidateContext(candidate, candidate.full_name);
  if (!built.context.trim()) return { ok: false, error: NO_RESUME };
  return { ok: true, ...built };
}
