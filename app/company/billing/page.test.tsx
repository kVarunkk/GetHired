import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { listPublicPlans } from "@/helpers/billing/plans";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { OWNER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import CompanyBillingPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));
vi.mock("@/helpers/billing/plans", () => ({ listPublicPlans: vi.fn() }));
vi.mock("@/components/billing/BillingOverview", () => ({
  default: (props: { canManage: boolean; memberUsage: unknown[] | null }) => (
    <div data-testid="overview" data-can-manage={String(props.canManage)} data-members={props.memberUsage?.length ?? "none"} />
  ),
}));
vi.mock("server-only", () => ({}));

let db: SupabaseMock;

function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  db.queueRpc("member_usage", {
    data: [{ user_id: member.user.id, name: "X", is_owner: false, role: null, usage: {}, limits: {} }],
    error: null,
  });
  vi.mocked(createClient).mockResolvedValue(db.client);
}

const page = () => CompanyBillingPage({ searchParams: Promise.resolve({}) });

beforeEach(() => {
  vi.clearAllMocks();
  const service = createSupabaseMock();
  service.queue("price_plan", { data: [], error: null });
  service.queue("payments", { data: [], error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.mocked(getEntitlements).mockResolvedValue({} as never);
  vi.mocked(listPublicPlans).mockResolvedValue([]);
});

describe("/company/billing (RP-DEC-003, RP-REQ-044)", () => {
  it("lets an owner manage billing and see usage by member", async () => {
    signInAs(OWNER_A);
    render(await page());

    const overview = screen.getByTestId("overview");
    expect(overview).toHaveAttribute("data-can-manage", "true");
    expect(overview).toHaveAttribute("data-members", "1");
    expect(db.callsFor("member_usage")).toHaveLength(1);
  });

  it("shows billing read-only to a non-owner with billing.view", async () => {
    signInAs(memberWith(["billing.view"]));
    render(await page());

    expect(screen.getByTestId("overview")).toHaveAttribute("data-can-manage", "false");
  });

  it("refuses a member without billing.view", async () => {
    signInAs(memberWith(["team.view"]));
    render(await page());

    expect(screen.queryByTestId("overview")).not.toBeInTheDocument();
    expect(screen.getByText("Your role can't view billing.")).toBeInTheDocument();
  });
});
