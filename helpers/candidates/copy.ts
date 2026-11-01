// Copy for the bulk import functions' reasons (supabase/migrations/
// 20261025120000_bulk_import.sql). Client-safe, so the forms show the same
// words as the actions. Names the missing permission, never a role
// (test/no-role-names-in-copy.test.ts).

export const IMPORT_MESSAGES: Record<string, string> = {
  not_found: "Not found. It may have been deleted.",
  forbidden: "Your role can't import applicants here.",
  already_confirmed: "This import was already confirmed.",
  not_attested: "Confirm you have a lawful basis to process these people's data first.",
  invalid: "Something in the request wasn't valid. Reload the page and try again.",
  invalid_stage: "Pick one of your pipeline stages.",
  no_rows: "There's nobody to add.",
  too_many: "That's too many at once.",
  rate_limited: "You've added a lot of candidates in the last hour. Try again later.",
  import_limit_hour: "You've started 5 imports in the last hour. Try again in a little while.",
  import_limit_day: "You've started 20 imports today. Try again tomorrow.",
  duplicate_email: "Another candidate already has this email.",
  no_email: "Add an email first: everyone in a job needs one.",
  known_user: "They're already on GetHired and in your pipeline.",
  // Resume imports (20261025130000_bulk_import_resumes.sql).
  already_submitted: "These resumes are already being read.",
  parsing_limit: "Two resume imports are already being read. Wait for one to finish.",
  not_parsed: "This file hasn't been read yet.",
  not_failed: "Only a failed file can be tried again.",
  missing_email: "Add an email for every person, or remove them: everyone in a job needs one.",
  no_files_uploaded: "None of the files finished uploading. Try again.",
  // Candidate pool imports (20261026120000_candidate_pool_imports.sql).
  invite_needs_job: "Pick a job to invite people to its AI interview.",
};

export const importMessage = (reason: string | null | undefined) =>
  (reason && IMPORT_MESSAGES[reason]) ?? "Couldn't save. Try again.";

/** The counts the confirm and add-to-job RPCs return. */
export type ImportCounts = {
  created: number;
  updated: number;
  skipped: number;
  known: number;
  added_to_job: number;
  already_in_job: number;
  needs_outreach: number;
  no_email: number;
  added_to_list: number;
  not_found: number;
};

export function importCountsOf(raw: unknown): ImportCounts {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = (k: keyof ImportCounts) => (typeof o[k] === "number" ? (o[k] as number) : 0);
  return {
    created: n("created"),
    updated: n("updated"),
    skipped: n("skipped"),
    known: n("known"),
    added_to_job: n("added_to_job"),
    already_in_job: n("already_in_job"),
    needs_outreach: n("needs_outreach"),
    no_email: n("no_email"),
    added_to_list: n("added_to_list"),
    not_found: n("not_found"),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "1 added to the job · 2 already in the job · 1 has no email", for a toast or the result step. */
export function describeAddToJob(counts: ImportCounts): string {
  return [
    counts.added_to_job ? `${plural(counts.added_to_job, "candidate", "candidates")} added to the job` : null,
    counts.already_in_job ? `${counts.already_in_job} already in the job` : null,
    counts.no_email ? `${plural(counts.no_email, "has", "have")} no email` : null,
    counts.not_found ? `${counts.not_found} not found` : null,
  ]
    .filter(Boolean)
    .join(" · ") || "Nothing changed.";
}

// claim_company_candidate's reasons (20261025140000_bulk_import_claims.sql),
// for the claim page (BI-REQ-041).
export const CLAIM_MESSAGES: Record<string, string> = {
  not_signed_in: "Sign in or create an account first.",
  invalid: "This link isn't valid. Use the link from the latest email you got.",
  used: "This link was already used by another account.",
  expired: "This link has expired. Ask the company to invite you again.",
  company_account: "This is a company account. Sign in with an applicant account to take the interview.",
  no_profile: "Your account has no applicant profile yet. Finish setting it up, then open this link again.",
};

export const claimMessage = (reason: string | null | undefined) =>
  (reason && CLAIM_MESSAGES[reason]) ?? "Couldn't connect your account. Try again.";
