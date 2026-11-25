import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { OWNER_ONLY_MESSAGE } from "@/helpers/companies/permissions";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { MEMBER_A, OWNER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import JobSettingsPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/actions/set-job-approval-required", () => ({ setJobApprovalRequiredAction: vi.fn() }));

function signInAs(member: MemberFixture, required = false) {
  const db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  db.queue("company_info", { data: { job_approval_required: required }, error: null });
  vi.mocked(createClient).mockResolvedValue(db.client);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/company/settings/jobs (JLT-052)", () => {
  it("lets an owner change the approval setting", async () => {
    signInAs(OWNER_A, true);
    render(await JobSettingsPage());

    const toggle = screen.getByRole("switch", { name: "Require approval before a job post opens" });
    expect(toggle).toBeEnabled();
    expect(toggle).toBeChecked();
    expect(screen.queryByText(OWNER_ONLY_MESSAGE)).not.toBeInTheDocument();
  });

  it("is read-only for a member with jobs.view, saying why", async () => {
    signInAs(MEMBER_A);
    render(await JobSettingsPage());

    expect(screen.getByRole("switch", { name: "Require approval before a job post opens" })).toBeDisabled();
    expect(screen.getByText(OWNER_ONLY_MESSAGE)).toBeInTheDocument();
  });

  it("can't be opened without jobs.view", async () => {
    signInAs(memberWith([]));
    render(await JobSettingsPage());

    expect(screen.getByText("You can't open job settings")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
