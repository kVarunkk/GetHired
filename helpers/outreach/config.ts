import { z } from "zod";

// Outreach limits (OR-REQ-001/003/005). Client-safe: the composer and the
// respond form show the same limits the server and the DB checks enforce.

export const OUTREACH_SUBJECT_MAX = 120;
export const OUTREACH_MESSAGE_MAX = 2000;
export const OUTREACH_NOTE_MAX = 500;
export const OUTREACH_CONTACT_MAX = 120;
/** OR_MAX_PER_CANDIDATE_90D, enforced in send_candidate_outreach. */
export const OUTREACH_MAX_PER_CANDIDATE_90D = 3;
export const OUTREACH_EXPIRY_DAYS = 30;
export const OUTREACH_PAGE_SIZE = 25;
/** OR-GUD-001: free AI drafts per company per day. */
export const OUTREACH_DRAFTS_PER_DAY = 20;
export const OUTREACH_DRAFT_MAX_WORDS = 120;
/** OR-REQ-021: the window of the candidate's "companies viewed your profile" count. */
export const PROFILE_VIEW_WINDOW_DAYS = 30;

export const DECLINE_REASONS = [
  "not_looking",
  "role_mismatch",
  "location",
  "compensation",
  "company",
  "other",
] as const;

export const DECLINE_REASON_OPTIONS: { value: (typeof DECLINE_REASONS)[number]; label: string }[] = [
  { value: "not_looking", label: "Not looking right now" },
  { value: "role_mismatch", label: "The role isn't a fit" },
  { value: "location", label: "Location" },
  { value: "compensation", label: "Compensation" },
  { value: "company", label: "The company" },
  { value: "other", label: "Other" },
];

/** The company-side page of one outreach. */
export const outreachPath = (id: string) => `/company/outreach/${id}`;

export const OUTREACH_STATUSES = [
  "sent",
  "interested",
  "not_interested",
  "expired",
  "withdrawn",
  "reported",
] as const;

/** What a company sends (OR-REQ-001). `source` and the company never come from input. */
export const sendOutreachSchema = z
  .object({
    candidateId: z.string().uuid(),
    jobPostId: z.string().uuid().nullable().optional(),
    subject: z.string().trim().min(1).max(OUTREACH_SUBJECT_MAX),
    message: z.string().trim().min(1).max(OUTREACH_MESSAGE_MAX),
  })
  .strict();

export type SendOutreachInput = z.input<typeof sendOutreachSchema>;
