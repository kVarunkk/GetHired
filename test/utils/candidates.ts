import type { Database } from "@/utils/types/database.types";
import type { CompanyFixture } from "./recruiter";
import { OWNER_A } from "./team";

// Bulk import fixtures (BIT-006): company candidates, import batches, a
// spreadsheet row and an imported application. Ids are stable per call
// order: `cc…` candidates, `cb…` batches, `ea…` applications.

type Tables = Database["public"]["Tables"];
export type CompanyCandidateRow = Tables["company_candidates"]["Row"];
export type ImportBatchRow = Tables["candidate_import_batches"]["Row"];
export type ApplicationRow = Tables["applications"]["Row"];
type JobPostingRow = Tables["job_postings"]["Row"];

const CREATED_AT = "2026-10-25T00:00:00.000Z";

const seqId = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

let candidateSeq = 0;
let batchSeq = 0;
let applicationSeq = 0;

/** A `company_candidates` row of `company`: a name and an email, nothing else. */
export function candidateOf(company: CompanyFixture, overrides: Partial<CompanyCandidateRow> = {}): CompanyCandidateRow {
  candidateSeq += 1;
  return {
    id: seqId("cc000000", candidateSeq),
    company_id: company.id,
    full_name: `Candidate ${candidateSeq}`,
    email: `candidate${candidateSeq}@mail.test`,
    phone: null,
    location: null,
    current_title: null,
    current_company: null,
    experience_years: null,
    links: {},
    skills: [],
    tags: [],
    notes: null,
    resume_path: null,
    resume_content: null,
    source_batch_id: null,
    email_opted_out_at: null,
    embedding: null,
    embedding_stale: true,
    embedding_updated_at: null,
    search_text: "",
    claimed_user_id: null,
    claimed_at: null,
    created_by: OWNER_A.user.id,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

/** A draft spreadsheet batch of `company`. */
export function batchOf(company: CompanyFixture, overrides: Partial<ImportBatchRow> = {}): ImportBatchRow {
  batchSeq += 1;
  return {
    id: seqId("cb000000", batchSeq),
    company_id: company.id,
    kind: "spreadsheet",
    job_post_id: null,
    opened_from: "job",
    stage_id: null,
    talent_list_id: null,
    stage_map: null,
    auto_invite: false,
    status: "draft",
    file_name: "people.csv",
    duplicate_action: "skip",
    lawful_basis_attested_by: null,
    lawful_basis_attested_at: null,
    lawful_basis_note: null,
    counts: {},
    created_by: OWNER_A.user.id,
    created_at: CREATED_AT,
    confirmed_at: null,
    expires_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

/** One spreadsheet row as the preview sends it: text cells, keyed by field. */
export function importRowOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { full_name: "Asha Rao", email: "asha@mail.test", ...overrides };
}

/** An imported application (`source = 'imported'`, no applicant) of `candidate` to `posting`. */
export function importedApplicationOf(
  candidate: CompanyCandidateRow,
  posting: JobPostingRow,
  overrides: Partial<ApplicationRow> = {},
): ApplicationRow {
  applicationSeq += 1;
  return {
    id: seqId("ea000000", applicationSeq),
    applicant_user_id: null,
    company_candidate_id: candidate.id,
    import_batch_id: candidate.source_batch_id,
    merged_into_application_id: null,
    job_post_id: posting.id,
    all_jobs_id: posting.job_id,
    answers: [],
    answers_v2: null,
    form_snapshot: null,
    source_detail: null,
    resume_id: null,
    resume_path: null,
    resume_url: null,
    source: "imported",
    stage_entered_at: CREATED_AT,
    stage_id: null,
    status: "submitted",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}
