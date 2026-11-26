import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/utils/email";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { sendApprovalEmails, type ApprovalMove } from "./job-approval-emails";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ deploymentUrl: () => "https://app.test" }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const POST = "b0000000-0000-4000-8000-000000000001";
const SUBMITTER = "u-submitter";
const APPROVER = "u-approver";
const SCOPED = "u-scoped";
const OWNER = "u-owner";
const EMAILS: Record<string, string> = {
  [SUBMITTER]: "pat@acme.test",
  [APPROVER]: "ada@acme.test",
  [SCOPED]: "sue@acme.test",
  [OWNER]: "owner@acme.test",
};
const APPROVER_ROLE = "r-approver";
const SCOPED_ROLE = "r-scoped";
const PUBLISHER_ROLE = "r-publisher";

let db: SupabaseMock;
const getUserById = vi.fn();
const sentTo = () => vi.mocked(sendEmail).mock.calls.map(([args]) => [args.toEmail, args.subject]);

const move = (overrides: Partial<ApprovalMove>): ApprovalMove => ({
  companyId: COMPANY,
  postId: POST,
  title: "Backend Engineer",
  from: "draft",
  to: "pending_approval",
  actorId: SUBMITTER,
  note: null,
  ...overrides,
});

/** The team: an owner, an approver for every job, one scoped to `assigned`, and the submitter. */
function team({ approvers = true, assigned = [SCOPED] }: { approvers?: boolean; assigned?: string[] } = {}) {
  db.queue("company_members", {
    data: [
      { user_id: OWNER, is_owner: true, role_id: null },
      { user_id: SUBMITTER, is_owner: false, role_id: PUBLISHER_ROLE },
      ...(approvers
        ? [
            { user_id: APPROVER, is_owner: false, role_id: APPROVER_ROLE },
            { user_id: SCOPED, is_owner: false, role_id: SCOPED_ROLE },
          ]
        : []),
    ],
    error: null,
  });
  db.queue("company_role_permissions", {
    data: approvers
      ? [
          { role_id: APPROVER_ROLE, scope: "all" },
          { role_id: SCOPED_ROLE, scope: "assigned" },
        ]
      : [],
    error: null,
  });
  db.queue("company_job_assignments", { data: assigned.map((user_id) => ({ user_id })), error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  (db.client.auth as unknown as { admin: unknown }).admin = { getUserById };
  getUserById.mockImplementation(async (id: string) => ({ data: { user: { email: EMAILS[id] } }, error: null }));
  vi.mocked(sendEmail).mockResolvedValue(undefined);
});

describe("sendApprovalEmails: submitted (JLT-054, JL-REQ-021)", () => {
  it("emails the job's approvers, not the submitter or the owners", async () => {
    team();
    db.queue("company_members", { data: { display_name: "Pat Publisher" }, error: null });

    await sendApprovalEmails(db.client, move({}));

    expect(sentTo().sort()).toEqual([
      ["ada@acme.test", "Backend Engineer is waiting for your approval"],
      ["sue@acme.test", "Backend Engineer is waiting for your approval"],
    ]);
    const { textContent } = vi.mocked(sendEmail).mock.calls[0][0];
    expect(textContent).toContain("Pat Publisher submitted Backend Engineer for approval.");
    expect(textContent).toContain(`https://app.test/company/job-posts/${POST}`);
  });

  it("leaves out an approver scoped to other jobs", async () => {
    team({ assigned: [] });
    db.queue("company_members", { data: { display_name: "Pat" }, error: null });

    await sendApprovalEmails(db.client, move({}));

    expect(sentTo().map(([to]) => to)).toEqual(["ada@acme.test"]);
  });

  it("emails the owners when nobody else can approve", async () => {
    team({ approvers: false });
    db.queue("company_members", { data: { display_name: "Pat" }, error: null });

    await sendApprovalEmails(db.client, move({}));

    expect(sentTo().map(([to]) => to)).toEqual(["owner@acme.test"]);
  });
});

describe("sendApprovalEmails: decisions (JLT-054)", () => {
  function submittedBy(actor: string | null) {
    db.queue("job_post_state_events", { data: actor ? { actor_user_id: actor } : null, error: null });
  }

  it("tells the submitter it was approved", async () => {
    submittedBy(SUBMITTER);
    db.queue("company_members", { data: { display_name: "Ada Approver" }, error: null });

    await sendApprovalEmails(db.client, move({ from: "pending_approval", to: "open", actorId: APPROVER }));

    expect(sentTo()).toEqual([["pat@acme.test", "Backend Engineer was approved"]]);
    expect(vi.mocked(sendEmail).mock.calls[0][0].textContent).toContain("Ada Approver approved Backend Engineer.");
  });

  it("sends the submitter the approver's note when changes were requested", async () => {
    submittedBy(SUBMITTER);
    db.queue("company_members", { data: { display_name: "Ada Approver" }, error: null });

    await sendApprovalEmails(
      db.client,
      move({ from: "pending_approval", to: "draft", actorId: APPROVER, note: "Add the salary range" }),
    );

    expect(sentTo()).toEqual([["pat@acme.test", "Changes requested on Backend Engineer"]]);
    const { textContent } = vi.mocked(sendEmail).mock.calls[0][0];
    expect(textContent).toContain("Add the salary range");
    expect(textContent).toContain(`https://app.test/company/job-posts/${POST}/edit`);
  });

  it("sends nothing when the submitter withdraws their own job", async () => {
    submittedBy(SUBMITTER);
    await sendApprovalEmails(db.client, move({ from: "pending_approval", to: "draft", actorId: SUBMITTER }));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing for moves outside approval", async () => {
    await sendApprovalEmails(db.client, move({ from: "open", to: "paused" }));
    await sendApprovalEmails(db.client, move({ from: "draft", to: "open" }));
    expect(db.calls).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never throws when a send fails", async () => {
    submittedBy(SUBMITTER);
    db.queue("company_members", { data: null, error: null });
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("resend down"));
    await expect(
      sendApprovalEmails(db.client, move({ from: "pending_approval", to: "open", actorId: APPROVER })),
    ).resolves.toBeUndefined();
  });
});
