/**
 * What a resume review was aimed at: a job, a pasted job description, what the
 * user asked for in their words, or none of these. Client-safe.
 */
export type ReviewTarget = {
  job: { id: string; title: string | null; company: string | null } | null;
  pastedJob: boolean;
  focus: string | null;
};

type ReviewTargetRow = {
  job_id: string | null;
  target_jd: string | null;
  focus: string | null;
  all_jobs: { job_name: string | null; company_name: string | null } | null;
};

export function reviewTarget({ job_id, target_jd, focus, all_jobs }: ReviewTargetRow): ReviewTarget {
  return {
    job: job_id ? { id: job_id, title: all_jobs?.job_name ?? null, company: all_jobs?.company_name ?? null } : null,
    pastedJob: !job_id && Boolean(target_jd?.trim()),
    focus: focus?.trim() || null,
  };
}

/** The job as one line, e.g. "AI Engineer at Acme". */
export const reviewJobLabel = ({ title, company }: NonNullable<ReviewTarget["job"]>) =>
  title && company ? `${title} at ${company}` : (title ?? company ?? "this job");

/** What the review was for, in a sentence, for the model to repeat to the user. */
export function reviewTargetText(target: ReviewTarget): string {
  const aim = target.job
    ? `the job ${reviewJobLabel(target.job)} (/jobs/${target.job.id})`
    : target.pastedJob
      ? "the job description the user pasted"
      : null;
  if (aim && target.focus) return `Tailored for ${aim}, with the focus "${target.focus}".`;
  if (aim) return `Tailored for ${aim}.`;
  if (target.focus) return `No job: reviewed for "${target.focus}".`;
  return "No job: the resume was reviewed on its own.";
}
