import type { Database } from "@/utils/types/database.types";
import { answersView } from "@/helpers/applications/answers-view";
import type { TResumeRowContent } from "@/utils/types";
import { wrapInSandbox } from "@/helpers/ai/security";
import { scrubPII, stripProtected } from "@/helpers/ai/fairness";
import { extractSectionText } from "@/utils/extract-resume-content";
import { MATCH_CANDIDATE_TEXT_MAX_CHARS, MATCH_JOB_DESCRIPTION_MAX_CHARS } from "./config";

type Tables = Database["public"]["Tables"];
type JobPosting = Pick<
  Tables["job_postings"]["Row"],
  | "title"
  | "description"
  | "skills"
  | "min_experience"
  | "max_experience"
  | "experience"
  | "location"
  | "job_type"
  | "salary_currency"
  | "min_salary"
  | "max_salary"
  | "salary_range"
  | "visa_sponsorship"
  | "questions"
>;
type Application = Pick<Tables["applications"]["Row"], "answers"> &
  Partial<Pick<Tables["applications"]["Row"], "answers_v2" | "form_snapshot">>;
/** A `user_info` row, possibly with extra keys; protected ones are dropped. */
type Profile = Record<string, unknown>;

/**
 * The candidate fields a model may see (MT-SEC-002). Anything else on the
 * profile is left out, and these pass through `stripProtected` as well.
 */
const PROFILE_FIELDS = [
  "desired_roles",
  "experience_years",
  "top_skills",
  "preferred_locations",
  "work_style_preferences",
  "job_type",
  "salary_currency",
  "min_salary",
  "max_salary",
  "company_size_preference",
  "industry_preferences",
  "visa_sponsorship_required",
] as const;

const MISSING = "[missing]";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Scrubs contact details and the candidate's name (each part of it) from
 * free text, and caps its length.
 */
function cleanText(text: string, fullName: unknown): string {
  let cleaned = scrubPII(text);
  if (typeof fullName === "string") {
    const parts = fullName.split(/\s+/).filter((part) => part.length >= 2);
    for (const part of [fullName.trim(), ...parts]) {
      if (!part) continue;
      cleaned = cleaned.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, "gi"), "[candidate]");
    }
  }
  return cleaned.slice(0, MATCH_CANDIDATE_TEXT_MAX_CHARS);
}

function experienceOf(job: JobPosting): string {
  const { min_experience: min, max_experience: max } = job;
  if (min !== null && max !== null) return `${min}–${max} years`;
  if (min !== null) return `${min}+ years`;
  if (max !== null) return `up to ${max} years`;
  return job.experience || "Not specified";
}

function salaryOf(job: JobPosting): string {
  if (job.min_salary || job.max_salary) {
    const currency = job.salary_currency ?? "";
    return `${currency}${job.min_salary ?? "?"} – ${currency}${job.max_salary ?? "?"}`;
  }
  return job.salary_range || "Not specified";
}

/** The job, written by the company. Sandboxed too, since it's free text. */
function jobSection(job: JobPosting): string {
  const details = [
    `Title: ${job.title}`,
    `Required skills: ${job.skills?.length ? job.skills.join(", ") : "Not specified"}`,
    `Experience: ${experienceOf(job)}`,
    `Location: ${job.location?.length ? job.location.join(", ") : "Not specified"}`,
    `Job type: ${job.job_type || "Not specified"}`,
    `Salary: ${salaryOf(job)}`,
    `Visa sponsorship: ${job.visa_sponsorship || "Not specified"}`,
  ].join("\n");
  const description = (job.description ?? "").slice(0, MATCH_JOB_DESCRIPTION_MAX_CHARS);

  return `## Job\n${details}\n\n${wrapInSandbox("job_description", description || "Not provided")}`;
}

function candidateSection(profile: Profile, resume: TResumeRowContent | null): string {
  const fullName = profile.full_name;
  const safe = stripProtected(profile);

  const preferences = Object.fromEntries(
    PROFILE_FIELDS.filter((key) => key in safe && safe[key] !== null && safe[key] !== undefined).map(
      (key) => {
        const value = safe[key];
        if (typeof value === "string") return [key, cleanText(value, fullName)];
        if (Array.isArray(value)) {
          return [key, value.map((v) => (typeof v === "string" ? cleanText(v, fullName) : v))];
        }
        return [key, value];
      },
    ),
  );

  const goals = [safe.career_goals_short_term, safe.career_goals_long_term]
    .filter((goal): goal is string => typeof goal === "string" && !!goal.trim())
    .map((goal) => cleanText(goal, fullName))
    .join("\n");

  const parts = [
    "## Candidate",
    wrapInSandbox("candidate_profile", JSON.stringify(preferences, null, 2)),
    wrapInSandbox("candidate_career_goals", goals || "Not provided"),
  ];

  if (!resume?.sections?.length) {
    parts.push("No resume on file.");
  } else {
    const { experience, skills, projects } = extractSectionText(
      ["experience", "skills", "projects"],
      resume,
    );
    parts.push(
      wrapInSandbox("resume_experience", cleanText(experience ?? "", fullName) || "Not provided"),
      wrapInSandbox("resume_skills", cleanText(skills ?? "", fullName) || "Not provided"),
      wrapInSandbox("resume_projects", cleanText(projects ?? "", fullName) || "Not provided"),
    );
  }

  return parts.join("\n\n");
}

function answersSection(job: JobPosting, application: Application, fullName: unknown): string {
  // AF-REQ-009: typed answers with the labels the candidate saw; old rows by position.
  const answers = answersView(application, job.questions);
  if (answers.length === 0) return "## Screening answers\nNo screening questions.";

  const pairs = answers
    .map(({ label, text }, i) => `Q${i + 1}: ${label}\nA${i + 1}: ${text ? cleanText(text, fullName) : MISSING}`)
    .join("\n\n");

  return `## Screening answers\n${wrapInSandbox("screening_answers", pairs)}`;
}

/**
 * The user message for a match explanation (MT-TASK-010): the job and the
 * candidate, with protected data removed (MT-SEC-002) and candidate text
 * sandboxed (MT-SEC-001).
 */
export function buildMatchInput(
  job: JobPosting,
  profile: Profile,
  resume: TResumeRowContent | null,
): string {
  return [jobSection(job), candidateSection(profile, resume)].join("\n\n");
}

/** The user message for screening an application: as above, plus the answers. */
export function buildScreeningInput(
  job: JobPosting,
  application: Application,
  profile: Profile,
  resume: TResumeRowContent | null,
): string {
  return [
    jobSection(job),
    answersSection(job, application, profile.full_name),
    candidateSection(profile, resume),
  ].join("\n\n");
}
