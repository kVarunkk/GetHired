/**
 * What the user is asked to confirm before a confirm tool runs (MCP spec
 * §4.6): one builder per tool. They only read, spend no credits, and return
 * an error instead of a preview when the call would fail anyway, so the user
 * isn't asked about something that can't happen.
 */
import "server-only";
import { previewAgentApplication } from "@/helpers/applications/preview-agent-application";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { PREFERENCE_COLUMNS } from "@/helpers/agent/tools/profile";
import type { AgentToolContext } from "@/helpers/agent/tools/shared";
import { previewResumeEdit, type ResumeEditTool } from "@/helpers/resumes/preview-resume-edit";
import { deploymentUrl } from "@/utils/formatters";
import { TAICredits } from "@/utils/types";

export type McpPreview =
  | { ok: true; summary: string; details: { label: string; value: string }[] }
  | { ok: false; error: string };

/** A confirm tool's preview of a validated input (without the confirmation_token). */
export type McpPreviewBuilder<TCtx extends AgentToolContext = AgentToolContext> = (
  ctx: TCtx,
  input: Record<string, unknown>,
) => Promise<McpPreview>;

/** The preview as one message: the question, then a line per detail. */
export function previewText(preview: Extract<McpPreview, { ok: true }>) {
  return [preview.summary, ...preview.details.map(({ label, value }) => `- ${label}: ${value}`)].join("\n");
}

/** Profile fields as the onboarding form names them. */
const FIELD_LABELS: Record<string, string> = {
  fullName: "Full name",
  desiredRoles: "Desired roles",
  jobTypes: "Job types",
  salaryCurrency: "Salary currency",
  minSalary: "Minimum salary",
  maxSalary: "Maximum salary",
  preferredLocations: "Preferred locations",
  experienceYears: "Years of experience",
  topSkills: "Top skills",
  workStylePreferences: "Work style",
  companySizePreference: "Company size",
  linkedinUrl: "LinkedIn",
  githubUrl: "GitHub",
  industryPreferences: "Industries",
  careerGoalsShortTerm: "Short-term goals",
  careerGoalsLongTerm: "Long-term goals",
  visaSponsorshipRequired: "Visa sponsorship required",
};

export function display(value: unknown): string {
  if (value === undefined || value === null || value === "") return "not set";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "none";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

const jobLabel = (title: string | null, company: string | null) =>
  title && company ? `${title} at ${company}` : (title ?? company ?? "this job");

const credits = (n: number) => `${n} AI ${n === 1 ? "credit" : "credits"}`;

/** The resume problems the tools themselves refuse, in their words. */
function resumeProblem(resume: { content: unknown; parsing_failed: boolean | null }) {
  if (resume.parsing_failed) return "This resume couldn't be read. Ask the user to upload it again.";
  if (!resume.content) return "This resume is still being processed. Try again in a minute.";
  return null;
}

export const previewSubmitApplication: McpPreviewBuilder = async (ctx, input) => {
  const preview = await previewAgentApplication(ctx.supabase, ctx.user, input);
  if (!preview.ok) {
    const fields = (preview.fieldErrors ?? []).map(({ label, error }) => `${label}: ${error}`);
    return { ok: false, error: [preview.error, fields.join("; ")].filter(Boolean).join(" ") };
  }
  return {
    ok: true,
    summary: `Send this application? It uses ${credits(TAICredits.JOB_APPLICATION)}, and the company sees these answers.`,
    details: [
      { label: "Job", value: jobLabel(preview.job.title, preview.job.company) },
      { label: "Resume", value: preview.resume ?? "none" },
      ...preview.answers.map(({ label, text }) => ({ label, value: text ?? "no answer" })),
    ],
  };
};

/** One builder per resume tool: the agent's approval card, as a confirmation (RE-REQ-082). */
const resumeEditPreview =
  (tool: ResumeEditTool): McpPreviewBuilder =>
  async (ctx, input) => {
    const preview = await previewResumeEdit(ctx.supabase, ctx.user, tool, input);
    if (!preview.ok) return preview;
    return {
      ok: true,
      summary: preview.summary,
      details: preview.changes.map(({ label, before, after }) => ({
        label,
        value: `${display(before)} → ${display(after)}`,
      })),
    };
  };

export const previewCreateResume = resumeEditPreview("createResume");
export const previewUpdateResume = resumeEditPreview("updateResume");
export const previewDeleteResume = resumeEditPreview("deleteResume");
export const previewApplySuggestions = resumeEditPreview("applyReviewSuggestions");

export const previewResumeReview: McpPreviewBuilder = async (ctx, input) => {
  const { resumeId, jobId, jobDescription, name } = input as {
    resumeId: string;
    jobId?: string;
    jobDescription?: string;
    name?: string;
  };

  const { data: resume, error } = await ctx.supabase
    .from("resumes")
    .select("name, content, parsing_failed")
    .eq("id", resumeId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!resume) return { ok: false, error: "Resume not found." };
  const problem = resumeProblem(resume);
  if (problem) return { ok: false, error: problem };

  let job = `the pasted job description (${jobDescription?.length ?? 0} characters)`;
  if (jobId) {
    const { data, error: jobError } = await ctx.supabase
      .from("all_jobs")
      .select("job_name, company_name")
      .eq("id", jobId)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!data) return { ok: false, error: "Job not found." };
    job = jobLabel(data.job_name, data.company_name);
  }

  return {
    ok: true,
    summary: `Start a resume review? This uses ${credits(TAICredits.AI_SEARCH_ASK_AI_RESUME)} once the analysis succeeds.`,
    details: [
      { label: "Resume", value: resume.name ?? "Your resume" },
      { label: "Job", value: job },
      ...(name ? [{ label: "Review name", value: name }] : []),
    ],
  };
};

export const previewUpdatePreferences: McpPreviewBuilder = async (ctx, input) => {
  const after = { ...input };
  if (Array.isArray(after.preferredLocations)) {
    after.preferredLocations = await canonicalizeLocations(after.preferredLocations as string[]);
  }
  const fields = Object.keys(after).filter(
    (field): field is keyof typeof PREFERENCE_COLUMNS => field in PREFERENCE_COLUMNS,
  );

  const { data: profile, error } = await ctx.supabase
    .from("user_info")
    .select(fields.map((field) => PREFERENCE_COLUMNS[field]).join(", "))
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!profile) {
    return {
      ok: false,
      error: "Profile not found. Ask the user to complete onboarding with complete_onboarding.",
    };
  }

  const before = profile as unknown as Record<string, unknown>;
  return {
    ok: true,
    summary: "Update your job preferences?",
    details: fields.map((field) => ({
      label: FIELD_LABELS[field],
      value: `${display(before[PREFERENCE_COLUMNS[field]])} → ${display(after[field])}`,
    })),
  };
};

export const previewCompleteOnboarding: McpPreviewBuilder = async (ctx, input) => {
  const { resumeId, ...fields } = input as { resumeId?: string } & Record<string, unknown>;

  const { data: profile, error } = await ctx.supabase
    .from("user_info")
    .select("filled")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error) throw error;
  if (profile?.filled) {
    return {
      ok: false,
      error: "The user is already onboarded. Use update_my_preferences to change their profile.",
    };
  }

  // The tool's own choice: the given resume, else the primary one.
  const resumes = ctx.supabase
    .from("resumes")
    .select("name, content, parsing_failed")
    .eq("user_id", ctx.user.id);
  const { data: resume, error: resumeError } = await (
    resumeId ? resumes.eq("id", resumeId) : resumes.eq("is_primary", true)
  ).maybeSingle();
  if (resumeError) throw resumeError;
  if (!resume) {
    return {
      ok: false,
      error: `Onboarding needs a resume. The user can upload one at ${deploymentUrl()}/resume, then call this tool again with its resumeId.`,
    };
  }
  const problem = resumeProblem(resume);
  if (problem) return { ok: false, error: problem };

  if (Array.isArray(fields.preferredLocations)) {
    fields.preferredLocations = await canonicalizeLocations(fields.preferredLocations as string[]);
  }
  return {
    ok: true,
    summary: "Set up your profile with these details?",
    details: [
      ...Object.entries(fields)
        .filter(([field, value]) => field in FIELD_LABELS && value !== undefined)
        .map(([field, value]) => ({ label: FIELD_LABELS[field], value: display(value) })),
      { label: "Resume", value: resume.name ?? "Your resume" },
    ],
  };
};
