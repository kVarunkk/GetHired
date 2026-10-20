import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LONG_TEXT_MAX,
  MAX_OPTIONS,
  MAX_OPTION_CHARS,
  readApplicationForm,
  type ApplicationForm,
} from "@/helpers/jobs/application-form-schema";
import { publicApplicationForm } from "@/helpers/jobs/public-application-form";
import type { Database } from "@/utils/types/database.types";
import { fieldsOf, type Answers } from "./validate-answers";

// The agent's Easy Apply (submitApplication tool and its approval preview).
// The model answers each field as text (or a list of choices for multiple
// choice), which Gemini's tool schemas handle better than a union per type;
// toFormAnswers turns that into the typed answers validateAnswers expects.
// Only the public form is read here: knockout rules never reach the agent
// (AF-SEC-003).

export const agentAnswerInput = z.object({
  key: z.string().min(1).max(80).describe("The field's key, exactly as getApplicationForm returned it."),
  value: z
    .string()
    .max(LONG_TEXT_MAX)
    .optional()
    .describe(
      "The answer as text: yes/no for yes_no, digits for number, YYYY-MM-DD for date, an http(s) link for url, one of the options for single_select, and amount plus 3-letter currency for salary (e.g. 1500000 INR).",
    ),
  choices: z
    .array(z.string().max(MAX_OPTION_CHARS))
    .max(MAX_OPTIONS)
    .optional()
    .describe("For multi_select fields only: the chosen options."),
});

export const agentApplicationInput = z.object({
  jobId: z.string().uuid().describe("The job id, exactly as returned by another tool."),
  resumeId: z
    .string()
    .uuid()
    .optional()
    .describe("The resume to send, from listResumes. Leave out to send the primary resume."),
  answers: z
    .array(agentAnswerInput)
    .max(40)
    .describe("One entry per field you answer. Leave out optional fields the user has nothing for."),
});

export type AgentAnswer = z.infer<typeof agentAnswerInput>;
export type AgentApplicationInput = z.infer<typeof agentApplicationInput>;

const SALARY_RE = /^\s*([\d][\d,]*(?:\.\d+)?)\s*([A-Za-z]{3})\s*$/;

function toValue(kind: string, answer: AgentAnswer): unknown {
  if (kind === "multi_select") return answer.choices ?? (answer.value ? [answer.value] : undefined);
  const text = answer.value?.trim();
  if (text === undefined || text === "") return undefined;
  switch (kind) {
    case "yes_no": {
      const lower = text.toLowerCase();
      if (lower === "yes" || lower === "true") return true;
      if (lower === "no" || lower === "false") return false;
      return text;
    }
    case "number": {
      const n = Number(text.replace(/,/g, ""));
      return Number.isFinite(n) ? n : text;
    }
    case "salary": {
      const m = SALARY_RE.exec(text);
      return m ? { amount: Number(m[1].replace(/,/g, "")), currency: m[2].toUpperCase() } : text;
    }
    default:
      return text;
  }
}

/**
 * The model's answers as the form's typed answers. Values that don't parse
 * are passed on as text, so validateAnswers gives the field's own message;
 * unknown keys are kept, so it rejects them too.
 */
export function toFormAnswers(form: ApplicationForm, answers: AgentAnswer[]): Record<string, unknown> {
  const kinds = new Map(fieldsOf(form).map((f) => [f.key, f.kind]));
  const out: Record<string, unknown> = {};
  for (const answer of answers) {
    const value = toValue(kinds.get(answer.key) ?? "short_text", answer);
    if (value !== undefined) out[answer.key] = value;
  }
  return out;
}

/** Typed answers (e.g. a profile prefill) in the model's text format. */
export function toAgentAnswers(answers: Answers): AgentAnswer[] {
  return Object.entries(answers).map(([key, value]) => {
    if (Array.isArray(value)) return { key, choices: value };
    if (typeof value === "boolean") return { key, value: value ? "yes" : "no" };
    if (typeof value === "object") return { key, value: `${value.amount} ${value.currency}` };
    return { key, value: String(value) };
  });
}

export type ApplicationTarget = {
  jobId: string;
  title: string | null;
  company: string | null;
  /** The public form: no knockout rules, no archived questions. */
  form: ApplicationForm;
  open: boolean;
  alreadyApplied: boolean;
  resume: { id: string; name: string | null } | null;
};

/**
 * Loads what applying to `jobId` needs, as the user (job_postings is
 * world-readable; resumes and applications are the user's own by RLS):
 * the job, its public form, whether it's open, whether they applied, and
 * the resume (the chosen one, else the primary one).
 */
export async function loadApplicationTarget(
  supabase: SupabaseClient<Database>,
  userId: string,
  { jobId, resumeId }: { jobId: string; resumeId?: string },
): Promise<{ ok: true; target: ApplicationTarget } | { ok: false; error: string }> {
  const [{ data: job, error: jobError }, { data: posting, error: postingError }] = await Promise.all([
    supabase.from("all_jobs").select("id, job_name, company_name, is_platform_job").eq("id", jobId).maybeSingle(),
    supabase.from("job_postings").select("status, questions, application_form").eq("job_id", jobId).maybeSingle(),
  ]);
  if (jobError) throw jobError;
  if (postingError) throw postingError;
  if (!job) return { ok: false, error: "Job not found." };
  if (!job.is_platform_job || !posting) {
    return {
      ok: false,
      error: "This job isn't on GetHired, so it can't be applied to here. The user applies on the company's site.",
    };
  }

  let resumeQuery = supabase.from("resumes").select("id, name").eq("user_id", userId);
  resumeQuery = resumeId ? resumeQuery.eq("id", resumeId) : resumeQuery.eq("is_primary", true);
  const [{ data: resume, error: resumeError }, { data: existing, error: existingError }] = await Promise.all([
    resumeQuery.limit(1).maybeSingle(),
    supabase.from("applications").select("id").eq("all_jobs_id", jobId).eq("applicant_user_id", userId).limit(1),
  ]);
  if (resumeError) throw resumeError;
  if (existingError) throw existingError;
  if (resumeId && !resume) return { ok: false, error: "Resume not found." };

  return {
    ok: true,
    target: {
      jobId,
      title: job.job_name,
      company: job.company_name,
      form: publicApplicationForm(readApplicationForm(posting.application_form, posting.questions)),
      open: posting.status === "active",
      alreadyApplied: (existing ?? []).length > 0,
      resume: resume ?? null,
    },
  };
}

/** Why the target can't be applied to yet, or null. */
export function notReadyReason(target: ApplicationTarget): string | null {
  if (!target.open) return "This job isn't taking applications.";
  if (target.alreadyApplied) return "You've already applied to this job.";
  if (!target.resume) return "There's no resume to send. Upload one first.";
  return null;
}
