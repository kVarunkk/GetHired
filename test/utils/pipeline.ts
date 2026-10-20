import { Constants, type Database, type Enums } from "@/utils/types/database.types";
import type { TemplatePurpose } from "@/helpers/pipeline/templates";
import {
  COMPANY_A,
  PUBLIC_APPLICANT,
  applicationOf,
  jobPostingOf,
} from "./recruiter";

type Tables = Database["public"]["Tables"];
type ApplicationRow = Tables["applications"]["Row"];

export const PIPELINE_STAGE_KINDS = Constants.public.Enums.pipeline_stage_kind;
export type PipelineStageKind = Enums<"pipeline_stage_kind">;
export type CandidateRating = Enums<"candidate_rating">;
export type { TemplatePurpose } from "@/helpers/pipeline/templates";
export type ApplicationSource = "applied" | "outreach" | "imported" | "agent";
export type ApplicationEventType =
  | "applied"
  | "stage_changed"
  | "email_sent"
  | "note_added"
  | "screened"
  | "outreach_sent"
  | "outreach_replied";

export type PipelineStageRow = Tables["pipeline_stages"]["Row"];

export type CompanyEmailTemplateRow = Tables["company_email_templates"]["Row"];

export type CandidateNoteRow = Tables["candidate_notes"]["Row"];

export type ApplicationEventRow = Tables["application_events"]["Row"] & {
  type: ApplicationEventType;
};

export type PipelineApplication = ApplicationRow & {
  user_info: { full_name: string | null; email: string | null };
  job_postings: {
    id: string;
    company_id: string;
    title: string;
    company_info: { name: string | null; email: string | null };
  };
};

const CREATED_AT = "2026-01-01T00:00:00.000Z";

const seqId = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const STAGE_NAMES: Record<PipelineStageKind, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  on_hold: "On hold",
};

/** PL-REQ-001's defaults for COMPANY_A, as `seed_default_pipeline` creates them. */
export const DEFAULT_STAGES: readonly PipelineStageRow[] = PIPELINE_STAGE_KINDS.map(
  (kind, position) => ({
    id: seqId("5a000000", position + 1),
    company_id: COMPANY_A.id,
    name: STAGE_NAMES[kind],
    kind,
    position,
    archived: false,
    created_at: CREATED_AT,
  }),
);

/** COMPANY_A's default stage of `kind`; the same object unless overridden. */
export function stageOf(
  kind: PipelineStageKind,
  overrides: Partial<PipelineStageRow> = {},
): PipelineStageRow {
  const stage = DEFAULT_STAGES.find((s) => s.kind === kind)!;
  return Object.keys(overrides).length === 0 ? stage : { ...stage, ...overrides };
}

/** The posting every `pipelineAppOf` application belongs to, unless overridden. */
export const PIPELINE_JOB = jobPostingOf(COMPANY_A, {
  title: "Founding Backend Engineer",
  status: "active",
});

let appSeq = 0;

/**
 * An application to COMPANY_A's `PIPELINE_JOB`, in the Applied stage, with the
 * joins `moveApplications` selects (the candidate's email and the job's
 * company) so email tests can check the recipient comes from the DB.
 */
export function pipelineAppOf(
  overrides: Partial<PipelineApplication> = {},
): PipelineApplication {
  appSeq += 1;
  const base = applicationOf(PUBLIC_APPLICANT, PIPELINE_JOB, {
    id: seqId("ab000000", appSeq),
  });
  return {
    ...base,
    stage_id: stageOf("applied").id,
    stage_entered_at: CREATED_AT,
    source: "applied",
    user_info: {
      full_name: PUBLIC_APPLICANT.info.full_name,
      email: PUBLIC_APPLICANT.info.email,
    },
    job_postings: {
      id: PIPELINE_JOB.id,
      company_id: COMPANY_A.id,
      title: PIPELINE_JOB.title,
      company_info: { name: COMPANY_A.info.name, email: COMPANY_A.info.email },
    },
    ...overrides,
  };
}

const TEMPLATE_DEFAULTS: Record<TemplatePurpose, { subject: string; body_md: string }> = {
  rejection: {
    subject: "Your application for {{job_title}} at {{company_name}}",
    body_md:
      "Hi {{candidate_first_name}},\n\nThank you for applying for {{job_title}}. " +
      "We've decided not to move forward this time.\n\n{{sender_name}}",
  },
  advance: {
    subject: "Next steps for {{job_title}}",
    body_md: "Hi {{candidate_first_name}},\n\nWe'd like to move you forward.\n\n{{sender_name}}",
  },
  interview_invite: {
    subject: "Interview for {{job_title}} at {{company_name}}",
    body_md:
      "Hi {{candidate_first_name}},\n\nPlease pick a time: {{scheduling_link}}\n\n{{sender_name}}",
  },
  offer: {
    subject: "An offer for {{job_title}}",
    body_md: "Hi {{candidate_first_name}},\n\nWe're delighted to offer you the role.\n\n{{sender_name}}",
  },
  on_hold: {
    subject: "An update on your application for {{job_title}}",
    body_md: "Hi {{candidate_first_name}},\n\nWe're pausing our review for now.\n\n{{sender_name}}",
  },
  reopen: {
    subject: "An update on your application for {{job_title}}",
    body_md: "Hi {{candidate_first_name}},\n\nYour application is back under review.\n\n{{sender_name}}",
  },
  custom: { subject: "A message from {{company_name}}", body_md: "Hi {{candidate_first_name}},\n\n" },
};

const PURPOSE_INDEX: Record<TemplatePurpose, number> = {
  rejection: 1,
  advance: 2,
  interview_invite: 3,
  offer: 4,
  custom: 5,
  on_hold: 6,
  reopen: 7,
};

/** COMPANY_A's seeded default template for `purpose`. */
export function templateOf(
  purpose: TemplatePurpose,
  overrides: Partial<CompanyEmailTemplateRow> = {},
): CompanyEmailTemplateRow {
  return {
    id: seqId("7e700000", PURPOSE_INDEX[purpose]),
    company_id: COMPANY_A.id,
    purpose,
    name: purpose.replace("_", " "),
    ...TEMPLATE_DEFAULTS[purpose],
    is_default: true,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

let noteSeq = 0;

/** An unrated note by COMPANY_A's owner on PUBLIC_APPLICANT. */
export function noteOf(overrides: Partial<CandidateNoteRow> = {}): CandidateNoteRow {
  noteSeq += 1;
  return {
    id: seqId("70e00000", noteSeq),
    company_id: COMPANY_A.id,
    candidate_user_id: PUBLIC_APPLICANT.id,
    application_id: null,
    author_user_id: COMPANY_A.user.id,
    author_name: COMPANY_A.info.name,
    body: "Strong systems design answers.",
    rating: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

let eventSeq = 0;

/** A COMPANY_A event by its owner on PUBLIC_APPLICANT. */
export function eventOf(
  type: ApplicationEventType,
  overrides: Partial<ApplicationEventRow> = {},
): ApplicationEventRow {
  eventSeq += 1;
  return {
    id: seqId("e7e00000", eventSeq),
    company_id: COMPANY_A.id,
    application_id: null,
    candidate_user_id: PUBLIC_APPLICANT.id,
    actor_user_id: COMPANY_A.user.id,
    actor_name: COMPANY_A.info.name,
    type,
    payload: {},
    created_at: CREATED_AT,
    ...overrides,
  };
}
