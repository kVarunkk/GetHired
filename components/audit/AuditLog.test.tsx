import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { listAuditAction } from "@/app/actions/audit/list-audit";
import type { AuditEntry } from "@/helpers/companies/audit";
import AuditLog from "./AuditLog";

vi.mock("@/app/actions/audit/list-audit", () => ({ listAuditAction: vi.fn() }));

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/company/settings/audit" }));

const entry = (id: number, overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  id,
  actorUserId: "a0000000-0000-4000-8000-000000000001",
  actorName: "Olive Owner",
  actorKind: "user",
  action: "member.role_changed",
  targetType: "member",
  targetId: "u1",
  targetLabel: "Sam",
  before: { role: { name: "Member" } },
  after: { role: { name: "Recruiter" } },
  createdAt: new Date().toISOString(),
  ...overrides,
});

const ACTORS = [{ userId: "a0000000-0000-4000-8000-000000000001", name: "Olive Owner" }];

beforeEach(() => vi.clearAllMocks());

describe("AuditLog (RPT-072)", () => {
  it("renders each entry with the actor, what changed and when", () => {
    render(<AuditLog initialEntries={[entry(2)]} initialNextBefore={null} filters={{}} actors={ACTORS} />);

    const list = screen.getByRole("list", { name: "Audit log" });
    expect(within(list).getByText("Olive Owner")).toBeInTheDocument();
    expect(within(list).getByText(/changed Sam's role from Member to Recruiter/)).toBeInTheDocument();
    expect(within(list).getByText(/ago$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows the grant diff for a role edit", () => {
    render(
      <AuditLog
        initialEntries={[
          entry(3, {
            action: "role.updated",
            targetLabel: "Recruiter",
            before: { grants: { "notes.view": "all" } },
            after: { grants: { "notes.view": "all", "notes.write": "all" } },
          }),
        ]}
        initialNextBefore={null}
        filters={{}}
        actors={ACTORS}
      />,
    );

    expect(screen.getByText(/^\+ .+ \(all jobs\)$/)).toBeInTheDocument();
  });

  it("loads the next page with the same filters", async () => {
    vi.mocked(listAuditAction).mockResolvedValue({ ok: true, entries: [entry(1, { targetLabel: "Priya" })], nextBefore: null });
    render(
      <AuditLog initialEntries={[entry(2)]} initialNextBefore={2} filters={{ action: "member" }} actors={ACTORS} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getByText(/changed Priya's role/)).toBeInTheDocument());
    expect(listAuditAction).toHaveBeenCalledWith({ before: 2, action: "member" });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("puts date filters in the URL and can clear them", () => {
    render(<AuditLog initialEntries={[]} initialNextBefore={null} filters={{ action: "role" }} actors={ACTORS} />);

    expect(screen.getByText("Nothing matches these filters.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    expect(router.push).toHaveBeenCalledWith("/company/settings/audit?action=role&since=2026-10-01");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(router.push).toHaveBeenLastCalledWith("/company/settings/audit");
  });
});
