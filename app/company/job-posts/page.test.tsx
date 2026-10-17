import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { HIRING_MANAGER_A, JOB_A1, MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import CompanyJobPostsPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/components/CreateJobPostingDialog", () => ({
  default: ({ disabled }: { disabled?: boolean }) => <button disabled={disabled}>Create New Job Post</button>,
}));
vi.mock("@/components/JobPostingsTable", () => ({ default: () => null }));
vi.mock("@/components/BackButton", () => ({ default: () => null }));
vi.mock("server-only", () => ({}));

let db: SupabaseMock;

function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  db.queue("job_postings", { data: [], error: null });
  vi.mocked(createClient).mockResolvedValue(db.client);
}

beforeEach(() => vi.clearAllMocks());

describe("/company/job-posts (RP-REQ-010/016)", () => {
  it("locks Create New Job Post without jobs.create", async () => {
    signInAs(MEMBER_A);
    render(await CompanyJobPostsPage());
    expect(screen.getByRole("button", { name: "Create New Job Post" })).toBeDisabled();
  });

  it("enables it for an owner and lists every job", async () => {
    signInAs(OWNER_A);
    render(await CompanyJobPostsPage());

    expect(screen.getByRole("button", { name: "Create New Job Post" })).toBeEnabled();
    expect(db.callsFor("job_postings")[0].chain.some((c) => c.method === "in")).toBe(false);
  });

  it("lists only a hiring manager's assigned jobs, through the user's client (RPT-053)", async () => {
    signInAs(HIRING_MANAGER_A);
    render(await CompanyJobPostsPage());

    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "in", args: ["id", [JOB_A1]] });
  });
});
