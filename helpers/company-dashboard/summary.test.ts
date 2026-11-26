import { describe, expect, it } from "vitest";
import { OWNER_ACCESS, accessOf } from "@/test/utils/team";
import type { InterviewFollowUp } from "@/helpers/interviews/follow-ups";
import {
  companyAttentionItems,
  companyDashboardHeadline,
  companySetupProgress,
  couldHaveAttention,
  type AttentionJob,
  type CompanyAttentionInput,
  type SetupFacts,
} from "./summary";

const NOW = new Date("2026-11-26T10:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const followUp = (over: Partial<InterviewFollowUp> = {}): InterviewFollowUp => ({
  kind: "feedback_overdue",
  interviewId: "iv-1",
  interviewName: "Tech screen",
  candidateName: "Priya",
  jobPostId: "job-1",
  jobTitle: "Backend Engineer",
  since: ago(2),
  owed: 2,
  mine: false,
  href: "/company/applications/app-1/interviews",
  ...over,
});

const job = (over: Partial<AttentionJob> = {}): AttentionJob => ({
  id: "job-1",
  title: "Backend Engineer",
  state: "open",
  closesAt: null,
  createdAt: ago(10),
  submittedAt: null,
  submittedByMe: false,
  createdByMe: false,
  ...over,
});

const waiting = (id: string, days: number) => ({
  applicationId: id,
  name: id,
  jobPostId: "job-1",
  jobTitle: "Backend Engineer",
  daysInApplied: days,
});

const items = (over: Partial<CompanyAttentionInput> = {}) =>
  companyAttentionItems({
    access: OWNER_ACCESS,
    followUps: [],
    screenings: [],
    replies: [],
    jobs: [],
    waiting: [],
    resendTemplateId: "tpl-1",
    today: "2026-11-26",
    now: NOW,
    ...over,
  });

describe("companyAttentionItems (CD-REQ-016..018)", () => {
  it("ranks by kind, then oldest first, with closing jobs soonest first", () => {
    const list = items({
      waiting: [waiting("w-new", 4), waiting("w-old", 12)],
      jobs: [
        job({ id: "j-later", closesAt: "2026-11-29" }),
        job({ id: "j-soon", closesAt: "2026-11-26" }),
        job({ id: "j-draft", state: "draft", createdByMe: true }),
        job({ id: "j-pending", state: "pending_approval", submittedAt: ago(1) }),
      ],
      followUps: [followUp({ interviewId: "iv-link", kind: "awaiting_candidate" }), followUp()],
      replies: [{ id: "o-1", candidateName: "Ravi", jobTitle: null, respondedAt: ago(1) }],
      screenings: [
        {
          interviewId: "s-1",
          applicationId: "app-s",
          candidateName: "Sara",
          jobPostId: "job-1",
          jobTitle: "Backend Engineer",
          completedAt: ago(1),
        },
      ],
    });
    expect(list.map((i) => i.key)).toEqual([
      "interview:iv-1",
      "application:app-s",
      "outreach:o-1",
      "job:j-pending",
      "job:j-soon",
      "job:j-later",
      "application:w-old",
      "application:w-new",
      "interview:iv-link",
      "job:j-draft",
    ]);
    expect(list.find((i) => i.key === "job:j-soon")!.detail).toBe("Closes today");
    expect(list.find((i) => i.key === "job:j-later")!.detail).toBe("Closes Sunday");
  });

  it("lists an application once, under its higher kind", () => {
    const list = items({
      waiting: [waiting("app-1", 6)],
      screenings: [
        {
          interviewId: "s-1",
          applicationId: "app-1",
          candidateName: "Sara",
          jobPostId: "job-1",
          jobTitle: "Backend Engineer",
          completedAt: ago(1),
        },
      ],
    });
    expect(list.map((i) => i.kind)).toEqual(["screening_to_review"]);
  });

  it("offers Mark reviewed only with interviews.manage", () => {
    const screenings = [
      {
        interviewId: "ai-1",
        applicationId: "app-1",
        candidateName: "Sara",
        jobPostId: "job-1",
        jobTitle: "Backend Engineer",
        completedAt: ago(1),
      },
    ];
    expect(items({ screenings })[0].reviewInterviewId).toBe("ai-1");
    expect(items({ screenings, access: accessOf() })[0].reviewInterviewId).toBeUndefined();
  });

  it("leaves out jobs that need nothing, or nothing from this member", () => {
    expect(
      items({
        jobs: [
          job({ id: "a", closesAt: "2026-11-30" }),
          job({ id: "b", closesAt: "2026-11-25" }),
          job({ id: "c", state: "draft", createdByMe: false }),
          job({ id: "d", state: "draft", createdByMe: true, createdAt: ago(1) }),
        ],
      }),
    ).toEqual([]);
    expect(items({ access: accessOf(), jobs: [job({ state: "pending_approval" })] })).toEqual([]);
  });

  it("offers inline actions only with the permission, and links otherwise", () => {
    const viewer = accessOf({ grants: ["applicants.view"] });
    const input = {
      followUps: [followUp(), followUp({ interviewId: "iv-2", kind: "awaiting_candidate" })],
      waiting: [waiting("w", 5)],
    };
    expect(items(input).map((i) => i.action.type)).toEqual(["remind", "link", "resend"]);
    expect(items(input).find((i) => i.kind === "waiting_in_applied")!.move).toEqual({
      applicationId: "w",
      jobPostId: "job-1",
    });
    const limited = items({ ...input, access: viewer });
    expect(limited.map((i) => i.action.type)).toEqual(["link", "link", "link"]);
    expect(limited.find((i) => i.kind === "waiting_in_applied")!.move).toBeNull();
    expect(items({ ...input, resendTemplateId: null })[2].action).toMatchObject({ type: "link", label: "View" });
  });

  it("marks the member's own scorecard", () => {
    const [own] = items({ followUps: [followUp({ mine: true, href: "/company/interviews/iv-1" })] });
    expect(own).toMatchObject({
      mine: true,
      title: "Your scorecard for Tech screen",
      action: { label: "Submit scorecard", href: "/company/interviews/iv-1" },
    });
  });

  it("asks an approver to review, and shows a submitter their own pending job", () => {
    const pending = job({ state: "pending_approval", submittedAt: ago(1), submittedByMe: true });
    expect(items({ jobs: [pending] })[0].action).toMatchObject({ label: "Review" });
    expect(items({ jobs: [pending], access: accessOf({ grants: ["jobs.view"] }) })[0]).toMatchObject({
      mine: true,
      action: { label: "View" },
    });
  });
});

describe("couldHaveAttention", () => {
  it("is false for a role that grants nothing", () => {
    expect(couldHaveAttention(accessOf())).toBe(false);
    expect(couldHaveAttention(accessOf({ grants: ["applicants.view"] }))).toBe(true);
  });
});

describe("companyDashboardHeadline (CD-REQ-012)", () => {
  it("joins what's waiting, in the singular and plural", () => {
    expect(
      companyDashboardHeadline({ interviewsToday: 2, waiting: 5, items: items({ followUps: [followUp()] }) }),
    ).toBe("2 interviews today · 5 applicants waiting · 1 scorecard overdue");
    expect(companyDashboardHeadline({ interviewsToday: 1, waiting: 1, items: [] })).toBe(
      "1 interview today · 1 applicant waiting",
    );
  });

  it("hides applicants from a member who can't see them, and says when nothing waits", () => {
    expect(companyDashboardHeadline({ interviewsToday: 0, waiting: null, items: [] })).toBe("You're all caught up");
    expect(companyDashboardHeadline({ interviewsToday: 0, waiting: 0, items: [] })).toBe("You're all caught up");
  });
});

describe("companySetupProgress (CD-REQ-029)", () => {
  const facts: SetupFacts = {
    profileComplete: true,
    hasOpenedJob: false,
    careersPublished: false,
    hasTeammate: false,
    calendarConnected: false,
    hasCandidates: false,
  };

  it("gives an owner every step", () => {
    expect(companySetupProgress(OWNER_ACCESS, facts)).toMatchObject({ done: 1, total: 6 });
  });

  it("keeps only the steps the member can take", () => {
    expect(companySetupProgress(accessOf({ grants: ["jobs.create"] }), facts).items.map((i) => i.key)).toEqual([
      "hasOpenedJob",
      "calendarConnected",
    ]);
  });

  it("leaves out a step whose fact isn't known", () => {
    expect(companySetupProgress(OWNER_ACCESS, { ...facts, calendarConnected: null }).total).toBe(5);
  });
});
