// Client-safe and pure: the company dashboard's headline, its "Needs
// attention" list and the setup checklist
// (plan/company-dashboard/feature-company-dashboard-spec.md, §3, §4.2, §5.4).

import { can, canAny, type CompanyAccess, type PermissionKey } from "@/helpers/companies/permissions";
import type { InterviewFollowUp } from "@/helpers/interviews/follow-ups";
import type { NeedsAttention as WaitingApplication } from "@/helpers/pipeline/funnel";
import { candidateImportPath } from "@/helpers/candidates/paths";
import { jobPostPath } from "@/helpers/jobs/paths";
import type { JobPostState } from "@/helpers/jobs/job-states";

const DAY_MS = 86_400_000;

/** Rows shown before the per-kind "View all" links take over (CD-REQ-016). */
export const COMPANY_ATTENTION_LIMIT = 8;
/** A job closing within this many days needs attention (CD-REQ-017). */
export const CLOSING_SOON_DAYS = 3;
/** A draft older than this is stale. */
export const STALE_DRAFT_DAYS = 2;
/** How long an interested reply stays in the list. */
export const OUTREACH_REPLY_DAYS = 7;
/** How recently a job opened to count as new (CD-REQ-013, CD-REQ-021). */
export const NEW_JOB_DAYS = 14;

/** The kinds, in rank order (CD-REQ-017). */
export const ATTENTION_KINDS = [
  "feedback_overdue",
  "screening_to_review",
  "outreach_reply",
  "job_pending_approval",
  "job_closing_soon",
  "waiting_in_applied",
  "awaiting_candidate",
  "stale_draft",
] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

const APPLICATIONS = "/company/applications";
const applicationHref = (id: string) => `${APPLICATIONS}/${id}`;
const jobEditHref = (id: string) => `/company/job-posts/${id}/edit`;

/** Where the rows past the limit are, per kind. */
export const ATTENTION_VIEW_ALL: Record<AttentionKind, { label: string; href: string }> = {
  feedback_overdue: { label: "Overdue scorecards", href: "/company/my-interviews" },
  screening_to_review: { label: "AI interviews to review", href: APPLICATIONS },
  outreach_reply: { label: "Outreach replies", href: "/company/outreach?status=interested" },
  job_pending_approval: { label: "Jobs waiting for approval", href: "/company/job-posts" },
  job_closing_soon: { label: "Jobs closing soon", href: "/company/job-posts" },
  waiting_in_applied: { label: "Waiting applicants", href: `${APPLICATIONS}?status=submitted` },
  awaiting_candidate: { label: "Links not booked", href: APPLICATIONS },
  stale_draft: { label: "Drafts", href: "/company/job-posts" },
};

export type ScreeningToReview = {
  interviewId: string;
  applicationId: string;
  candidateName: string;
  jobPostId: string;
  jobTitle: string;
  completedAt: string;
};

export type OutreachReply = {
  id: string;
  candidateName: string;
  jobTitle: string | null;
  respondedAt: string;
};

/** A job post that may need something: pending approval, closing soon or a draft. */
export type AttentionJob = {
  id: string;
  title: string;
  state: JobPostState;
  /** `YYYY-MM-DD`, in the company's zone. */
  closesAt: string | null;
  createdAt: string;
  /** When it was sent for approval, and whether this member sent it. */
  submittedAt: string | null;
  submittedByMe: boolean;
  /** A draft this member made. */
  createdByMe: boolean;
};

export type CompanyAttentionAction =
  | { type: "link"; label: string; href: string }
  | { type: "remind"; label: string; interviewId: string }
  | { type: "resend"; label: string; interviewId: string; templateId: string };

export type CompanyAttentionItem = {
  /** Unique across the list, so each thing appears once. */
  key: string;
  kind: AttentionKind;
  title: string;
  /** Why it's here and how long it has waited. */
  detail: string;
  href: string;
  /** What the kind is sorted by, oldest (or soonest) first. */
  sortKey: string;
  /** The member's own to do, such as their scorecard. */
  mine: boolean;
  action: CompanyAttentionAction;
  /** The AI interview "Mark reviewed" clears; set only with interviews.manage. */
  reviewInterviewId?: string;
  /** Offers the inline "Move" beside the action. */
  move: { applicationId: string; jobPostId: string } | null;
};

export type CompanyAttentionInput = {
  access: CompanyAccess;
  followUps: InterviewFollowUp[];
  screenings: ScreeningToReview[];
  replies: OutreachReply[];
  jobs: AttentionJob[];
  waiting: WaitingApplication[];
  /** The template "Resend link" sends with; null when it can't send. */
  resendTemplateId: string | null;
  /** Today's date (`YYYY-MM-DD`) in the company's zone. */
  today: string;
  now: Date;
};

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const daysSince = (iso: string, now: Date) => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS));

/** "today", "yesterday" or "N days ago". */
export function agoText(iso: string, now: Date): string {
  const days = daysSince(iso, now);
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** Whole days from one `YYYY-MM-DD` to another. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** "Closes today", "Closes tomorrow" or "Closes Friday". */
function closesText(closesAt: string, today: string): string {
  const days = daysBetween(today, closesAt);
  if (days === 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${closesAt}T00:00:00Z`),
  );
  return `Closes ${weekday}`;
}

function followUpItem(f: InterviewFollowUp, { access, resendTemplateId, now }: CompanyAttentionInput): CompanyAttentionItem {
  const canSchedule = can(access, "scheduling.manage", f.jobPostId);
  const base = { key: `interview:${f.interviewId}`, kind: f.kind, href: f.href, sortKey: f.since, move: null };

  if (f.kind === "awaiting_candidate") {
    return {
      ...base,
      title: f.candidateName,
      detail: `${f.interviewName} for ${f.jobTitle} · Link sent ${agoText(f.since, now)}, not booked`,
      mine: false,
      action:
        canSchedule && resendTemplateId
          ? { type: "resend", label: "Resend link", interviewId: f.interviewId, templateId: resendTemplateId }
          : { type: "link", label: "View", href: f.href },
    };
  }
  if (f.mine) {
    return {
      ...base,
      title: `Your scorecard for ${f.interviewName}`,
      detail: `${f.candidateName} · ${f.jobTitle} · Ended ${agoText(f.since, now)}`,
      mine: true,
      action: { type: "link", label: "Submit scorecard", href: f.href },
    };
  }
  return {
    ...base,
    title: f.candidateName,
    detail: `${f.interviewName} for ${f.jobTitle} · ${plural(f.owed, "scorecard")} overdue, ended ${agoText(f.since, now)}`,
    mine: false,
    action: canSchedule
      ? { type: "remind", label: "Remind panel", interviewId: f.interviewId }
      : { type: "link", label: "View", href: f.href },
  };
}

/** The one thing a job post needs, if any. The states don't overlap. */
function jobItem(job: AttentionJob, { access, today, now }: CompanyAttentionInput): CompanyAttentionItem | null {
  const base = { key: `job:${job.id}`, title: job.title, move: null };

  if (job.state === "pending_approval") {
    const since = job.submittedAt ?? job.createdAt;
    const approver = can(access, "jobs.approve", job.id);
    if (!approver && !job.submittedByMe) return null;
    const href = jobPostPath(job.id);
    return {
      ...base,
      kind: "job_pending_approval",
      detail: `Waiting for approval · Sent ${agoText(since, now)}`,
      href,
      sortKey: since,
      mine: !approver,
      action: { type: "link", label: approver ? "Review" : "View", href },
    };
  }

  if (job.state === "open") {
    if (!job.closesAt || !can(access, "jobs.edit", job.id)) return null;
    const days = daysBetween(today, job.closesAt);
    if (days < 0 || days > CLOSING_SOON_DAYS) return null;
    return {
      ...base,
      kind: "job_closing_soon",
      detail: closesText(job.closesAt, today),
      href: jobPostPath(job.id),
      sortKey: job.closesAt,
      mine: false,
      action: { type: "link", label: "Extend", href: jobEditHref(job.id) },
    };
  }

  if (job.state === "draft") {
    const old = now.getTime() - Date.parse(job.createdAt) > STALE_DRAFT_DAYS * DAY_MS;
    if (!old || !job.createdByMe || !can(access, "jobs.publish", job.id)) return null;
    return {
      ...base,
      kind: "stale_draft",
      detail: `Draft started ${agoText(job.createdAt, now)}`,
      href: jobEditHref(job.id),
      sortKey: job.createdAt,
      mine: true,
      action: { type: "link", label: "Finish", href: jobEditHref(job.id) },
    };
  }

  return null;
}

/**
 * CD-REQ-016..018: one ranked list. Kinds in `ATTENTION_KINDS` order, oldest
 * first within a kind (soonest first for closing jobs). Each thing appears
 * once, with one reason: an application with an AI interview to review isn't
 * also listed as waiting.
 */
export function companyAttentionItems(input: CompanyAttentionInput): CompanyAttentionItem[] {
  const { access, now } = input;
  const candidates: CompanyAttentionItem[] = [
    ...input.followUps.map((f) => followUpItem(f, input)),
    ...input.screenings.map((s): CompanyAttentionItem => {
      const href = `${applicationHref(s.applicationId)}/ai-interview`;
      return {
        key: `application:${s.applicationId}`,
        kind: "screening_to_review",
        title: s.candidateName,
        detail: `${s.jobTitle} · AI interview finished ${agoText(s.completedAt, now)}`,
        href,
        sortKey: s.completedAt,
        mine: false,
        action: { type: "link", label: "Review", href },
        ...(can(access, "interviews.manage", s.jobPostId) ? { reviewInterviewId: s.interviewId } : {}),
        move: null,
      };
    }),
    ...input.replies.map((r): CompanyAttentionItem => {
      const href = `/company/outreach/${r.id}`;
      return {
        key: `outreach:${r.id}`,
        kind: "outreach_reply",
        title: r.candidateName,
        detail: `${r.jobTitle ? `${r.jobTitle} · ` : ""}Replied interested ${agoText(r.respondedAt, now)}`,
        href,
        sortKey: r.respondedAt,
        mine: false,
        action: { type: "link", label: "Open", href },
        move: null,
      };
    }),
    ...input.jobs.flatMap((job) => jobItem(job, input) ?? []),
    ...input.waiting.map((w): CompanyAttentionItem => {
      const href = applicationHref(w.applicationId);
      return {
        key: `application:${w.applicationId}`,
        kind: "waiting_in_applied",
        title: w.name,
        detail: `${w.jobTitle} · ${plural(w.daysInApplied, "day")} in Applied`,
        href,
        // More days waiting sorts first.
        sortKey: String(1_000_000 - w.daysInApplied).padStart(7, "0"),
        mine: false,
        action: { type: "link", label: "Review", href },
        move: can(access, "pipeline.move", w.jobPostId)
          ? { applicationId: w.applicationId, jobPostId: w.jobPostId }
          : null,
      };
    }),
  ];

  const rank = (kind: AttentionKind) => ATTENTION_KINDS.indexOf(kind);
  const seen = new Set<string>();
  return candidates
    .sort((a, b) => rank(a.kind) - rank(b.kind) || a.sortKey.localeCompare(b.sortKey))
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
}

/** Whether the member's role could ever put something in the list (CD-REQ-009). */
export function couldHaveAttention(access: CompanyAccess): boolean {
  const keys: PermissionKey[] = [
    "applicants.view",
    "interviews.view",
    "outreach.view",
    "jobs.approve",
    "jobs.edit",
    "jobs.publish",
    "scheduling.view",
  ];
  return keys.some((key) => canAny(access, key));
}

/**
 * CD-REQ-012: what's waiting, joined with " · ". `waiting` is null for a
 * member who can't see applicants; the rest come from what they can see.
 */
export function companyDashboardHeadline({
  interviewsToday,
  waiting,
  items,
}: {
  interviewsToday: number;
  waiting: number | null;
  items: CompanyAttentionItem[];
}): string {
  const count = (kind: AttentionKind) => items.filter((item) => item.kind === kind).length;
  const part = (n: number, word: string, many?: string) => (n > 0 ? plural(n, word, many) : null);

  const parts = [
    part(interviewsToday, "interview today", "interviews today"),
    part(waiting ?? 0, "applicant waiting", "applicants waiting"),
    part(count("feedback_overdue"), "scorecard overdue", "scorecards overdue"),
    part(count("screening_to_review"), "AI interview to review", "AI interviews to review"),
    part(count("outreach_reply"), "new reply", "new replies"),
    part(count("job_pending_approval"), "job waiting for approval", "jobs waiting for approval"),
    part(count("job_closing_soon"), "job closing soon", "jobs closing soon"),
    part(count("awaiting_candidate"), "link not booked", "links not booked"),
    part(count("stale_draft"), "draft to finish", "drafts to finish"),
  ].filter((p): p is string => p !== null);

  return parts.length > 0 ? parts.join(" · ") : "You're all caught up";
}

/** What the setup checklist reads. Null: not loaded or not possible here, so the item is left out. */
export type SetupFacts = {
  profileComplete: boolean | null;
  hasOpenedJob: boolean | null;
  careersPublished: boolean | null;
  hasTeammate: boolean | null;
  calendarConnected: boolean | null;
  hasCandidates: boolean | null;
};

export type SetupItem = { key: keyof SetupFacts; label: string; href: string; done: boolean };

export type SetupProgress = { items: SetupItem[]; done: number; total: number };

const SETUP_ITEMS: { key: keyof SetupFacts; label: string; href: string; permission: PermissionKey | null }[] = [
  {
    key: "profileComplete",
    label: "Add your logo and description",
    href: "/get-started?company=true",
    permission: "company.profile",
  },
  { key: "hasOpenedJob", label: "Post your first job", href: "/company/job-posts/new", permission: "jobs.create" },
  {
    key: "careersPublished",
    label: "Publish your careers page",
    href: "/company/settings/careers",
    permission: "careers.edit",
  },
  { key: "hasTeammate", label: "Invite a teammate", href: "/company/settings/team", permission: "team.invite" },
  // The member's own calendar, so no permission.
  { key: "calendarConnected", label: "Connect your calendar", href: "/company/settings/my-calendar", permission: null },
  {
    key: "hasCandidates",
    label: "Bring in candidates you already have",
    href: candidateImportPath(),
    permission: "applicants.import",
  },
];

/** CD-REQ-029: the steps this member can take, and which are done. */
export function companySetupProgress(access: CompanyAccess, facts: SetupFacts): SetupProgress {
  const items = SETUP_ITEMS.flatMap(({ key, label, href, permission }) => {
    const done = facts[key];
    if (done === null || (permission && !can(access, permission))) return [];
    return [{ key, label, href, done }];
  });
  return { items, done: items.filter((item) => item.done).length, total: items.length };
}
