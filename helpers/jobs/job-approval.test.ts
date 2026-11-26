import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { JOB_A1, memberWith, myCompanyOf, type MemberFixture } from "@/test/utils/team";
import {
  countPendingApprovals,
  editedAfterSubmission,
  loadApprovalStatus,
  loadJobApprovalRequired,
} from "./job-approval";

vi.mock("server-only", () => ({}));

let db: SupabaseMock;
const JOB = { id: JOB_A1, company_id: COMPANY_A.id, updated_at: "2026-11-20T10:00:00.500Z" };

async function companyOf(member: MemberFixture) {
  const access = createSupabaseMock({ user: member.user });
  access.queueRpc("my_company_access", { data: member.membership, error: null });
  return (await getMyCompany(access.client, member.user))!;
}

beforeEach(() => {
  db = createSupabaseMock({ user: COMPANY_A.user });
});

describe("loadJobApprovalRequired", () => {
  it("reads the company's setting", async () => {
    db.queue("company_info", { data: { job_approval_required: true }, error: null });
    expect(await loadJobApprovalRequired(db.client, COMPANY_A.id)).toBe(true);
    expect(db.callsFor("company_info")[0].chain).toContainEqual({ method: "eq", args: ["id", COMPANY_A.id] });
  });
});

describe("editedAfterSubmission (JL-REQ-020)", () => {
  const submission = { actorUserId: "u1", at: "2026-11-20T10:00:00.000Z" };
  it("is false within a second of the submit, true after", () => {
    expect(editedAfterSubmission("2026-11-20T10:00:00.900Z", submission)).toBe(false);
    expect(editedAfterSubmission("2026-11-20T10:05:00.000Z", submission)).toBe(true);
    expect(editedAfterSubmission(null, submission)).toBe(false);
    expect(editedAfterSubmission("2026-11-20T10:05:00.000Z", null)).toBe(false);
  });
});

describe("loadApprovalStatus", () => {
  it("reads a pending job's submission and the submitter's name", async () => {
    db.queue("job_post_state_events", {
      data: {
        from_state: "draft",
        to_state: "pending_approval",
        note: null,
        actor_user_id: "u1",
        created_at: "2026-11-20T10:00:00.000Z",
      },
      error: null,
    });
    db.queue("company_members", { data: { display_name: "Pat Publisher" }, error: null });

    expect(
      await loadApprovalStatus(db.client, { ...JOB, state: "pending_approval", updated_at: "2026-11-21T00:00:00.000Z" }),
    ).toEqual({
      kind: "pending",
      submittedAt: "2026-11-20T10:00:00.000Z",
      submitterId: "u1",
      submitterName: "Pat Publisher",
      editedAfterSubmission: true,
    });
  });

  it("reads the note on a draft an approver sent back", async () => {
    db.queue("job_post_state_events", {
      data: {
        from_state: "pending_approval",
        to_state: "draft",
        note: "Add pay",
        actor_user_id: "u2",
        created_at: "2026-11-21T09:00:00.000Z",
      },
      error: null,
    });
    db.queue("company_members", { data: { display_name: "Ada" }, error: null });
    expect(await loadApprovalStatus(db.client, { ...JOB, state: "draft" })).toEqual({
      kind: "changes_requested",
      note: "Add pay",
      at: "2026-11-21T09:00:00.000Z",
      byName: "Ada",
    });
  });

  it("shows nothing for a withdrawn draft, a new draft or an open job", async () => {
    db.queue("job_post_state_events", {
      data: {
        from_state: "pending_approval",
        to_state: "draft",
        note: null,
        actor_user_id: "u1",
        created_at: "2026-11-21T09:00:00.000Z",
      },
      error: null,
    });
    expect(await loadApprovalStatus(db.client, { ...JOB, state: "draft" })).toBeNull();
    db.queue("job_post_state_events", { data: null, error: null });
    expect(await loadApprovalStatus(db.client, { ...JOB, state: "draft" })).toBeNull();
    expect(await loadApprovalStatus(db.client, { ...JOB, state: "open" })).toBeNull();
    expect(db.callsFor("job_post_state_events")).toHaveLength(2);
  });
});

describe("countPendingApprovals (JL-REQ-022)", () => {
  it("counts the company's pending jobs for an approver", async () => {
    db.queue("job_postings", { data: null, count: 3, error: null });
    expect(await countPendingApprovals(db.client, myCompanyOf(COMPANY_A))).toBe(3);
    const chain = db.callsFor("job_postings")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["state", "pending_approval"] });
    expect(chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("limits a job-scoped approver to their jobs", async () => {
    const company = await companyOf(memberWith([{ key: "jobs.approve", scope: "assigned" }], { assignedJobIds: [JOB_A1] }));
    db.queue("job_postings", { data: null, count: 1, error: null });
    expect(await countPendingApprovals(db.client, company)).toBe(1);
    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "in", args: ["id", [JOB_A1]] });
  });

  it("is 0 without jobs.approve, with no query", async () => {
    const company = await companyOf(memberWith([{ key: "jobs.view", scope: "all" }]));
    expect(await countPendingApprovals(db.client, company)).toBe(0);
    expect(db.callsFor("job_postings")).toHaveLength(0);
  });
});
