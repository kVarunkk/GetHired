import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { loadCompanyApplications } from "@/helpers/applications/company-list";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { OWNER_A } from "@/test/utils/team";
import CompanyApplicationsPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/applications/company-list", () => ({ loadCompanyApplications: vi.fn() }));
vi.mock("@/components/applications/CompanyApplicationsTable", () => ({
  default: (props: { list: { total: number }; params: { status: string | null; page: number } }) => (
    <div
      data-testid="table"
      data-total={props.list.total}
      data-status={props.params.status ?? ""}
      data-page={props.params.page}
    />
  ),
}));
vi.mock("@/components/agent/recruiter/AskAgentOnMainPages", () => ({
  AskAgentAboutApplicants: () => <div data-testid="ask-agent" />,
}));
vi.mock("@/components/Error", () => ({ default: () => <div data-testid="error" /> }));
vi.mock("server-only", () => ({}));

let db: SupabaseMock;

const page = (searchParams: Record<string, string> = {}) =>
  CompanyApplicationsPage({ searchParams: Promise.resolve(searchParams) });

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: COMPANY_A.user });
  db.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  vi.mocked(createClient).mockResolvedValue(db.client);
});

describe("/company/applications (QF-REQ-021)", () => {
  it("loads the session company's page from the parsed URL and renders the table", async () => {
    vi.mocked(loadCompanyApplications).mockResolvedValue({
      ok: true,
      rows: [],
      total: 60,
      page: 3,
      pageSize: 25,
      jobs: [],
    });

    render(await page({ status: "rejected", page: "9", sort: "nope" }));

    const [ctx, params] = vi.mocked(loadCompanyApplications).mock.calls[0];
    expect(ctx.company.id).toBe(COMPANY_A.id);
    expect(params).toMatchObject({ status: "rejected", page: 9, sort: "created_at" });
    const table = screen.getByTestId("table");
    expect(table).toHaveAttribute("data-total", "60");
    expect(table).toHaveAttribute("data-status", "rejected");
    // The page actually shown, after a page past the end.
    expect(table).toHaveAttribute("data-page", "3");
    // No more loading every application.
    expect(db.callsFor("applications")).toHaveLength(0);
  });

  it("shows the error state when the list can't be loaded", async () => {
    vi.mocked(loadCompanyApplications).mockResolvedValue({ ok: false, error: "Couldn't load the applications." });

    render(await page());

    expect(screen.getByTestId("error")).toBeInTheDocument();
  });

  it("shows the error state without a company", async () => {
    db = createSupabaseMock({ user: COMPANY_A.user });
    db.queueRpc("my_company_access", { data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(db.client);

    render(await page());

    expect(screen.getByTestId("error")).toBeInTheDocument();
    expect(loadCompanyApplications).not.toHaveBeenCalled();
  });
});
