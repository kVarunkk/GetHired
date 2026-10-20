import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { MEMBER_A, OWNER_A } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { previewAgentJobDeleteAction } from "./preview-agent-job-delete";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));

const JOB = "b0000000-0000-4000-8000-000000000001";

let db: SupabaseMock;

async function signIn(member = OWNER_A) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
});

describe("previewAgentJobDeleteAction", () => {
  it("previews the job's title, status and applications within the session company", async () => {
    db.queue("job_postings", { data: { id: JOB, title: "Backend Engineer", status: "active" }, error: null });
    db.queue("applications", { data: null, count: 3, error: null });

    expect(await previewAgentJobDeleteAction({ jobPostId: JOB })).toEqual({
      ok: true,
      title: "Backend Engineer",
      status: "active",
      applications: 3,
    });
    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    // A preview deletes nothing.
    expect(db.calls.some((c) => c.chain.some((m) => m.method === "delete"))).toBe(false);
  });

  it("treats another company's job as not found", async () => {
    db.queue("job_postings", { data: null, error: null });

    expect(await previewAgentJobDeleteAction({ jobPostId: JOB })).toEqual({
      ok: false,
      error: "Job posting not found.",
    });
  });

  it("refuses without jobs.delete", async () => {
    await signIn(MEMBER_A);

    expect(await previewAgentJobDeleteAction({ jobPostId: JOB })).toEqual({
      ok: false,
      error: "Your role can't delete job posts.",
    });
    expect(db.callsFor("job_postings")).toHaveLength(0);
  });

  it("rejects input without a uuid", async () => {
    expect(await previewAgentJobDeleteAction({ jobPostId: "nope" })).toMatchObject({ ok: false });
    expect(await previewAgentJobDeleteAction(null)).toMatchObject({ ok: false });
  });
});
