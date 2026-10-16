import type { TResumeRowContent } from "@/utils/types";
import type { Database } from "./database.types";

type Tables = Database["public"]["Tables"];

export type CandidateOutreach = Tables["candidate_outreach"]["Row"];

export type OutreachStatus =
  | "sent"
  | "interested"
  | "not_interested"
  | "expired"
  | "withdrawn"
  | "reported";

export type OutreachResponseStatus = "interested" | "not_interested" | "reported";

export type DeclineReason =
  | "not_looking"
  | "role_mismatch"
  | "location"
  | "compensation"
  | "company"
  | "other";

export type OutreachSource = "manual" | "agent";

/**
 * The scrubbed resume sections `candidate_directory` returns: only experience,
 * skills, projects and education, with emails, phones and URLs redacted from
 * bullets (difference 3).
 */
export type ResumeSectionsPublic = NonNullable<TResumeRowContent["sections"]>;
