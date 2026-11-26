import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { loadCandidatesTab, type CandidatesTab } from "@/helpers/candidates/candidates-tab";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { memberWith, OWNER_A } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import CompanyCandidatesTable from "@/components/candidates/CompanyCandidatesTable";
import CompanyCandidatesPage from "./page";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/candidates/candidates-tab", () => ({ loadCandidatesTab: vi.fn() }));
vi.mock("@/components/candidates/CompanyCandidatesTable", () => ({
  default: vi.fn(() => <div data-testid="table" />),
}));

let db: SupabaseMock;

const TAB: CandidatesTab = {
  list: { items: [], total: 0, page: 1, pageSize: 25 },
  filters: {
    q: "meera",
    tag: null,
    batchId: null,
    inJob: null,
    loc: null,
    resume: null,
    email: null,
    addedDays: null,
    matchJob: null,
    page: 1,
    listId: null,
  },
  options: { tags: [], batches: [] },
  jobs: [],
  matchJobs: [],
  canCreate: true,
  canDelete: true,
  canManageLists: true,
};

async function signInWith(membership: unknown) {
  db = createSupabaseMock({ user: COMPANY_A.user });
  db.queueRpc("my_company_access", { data: membership, error: null });
  await setRequestUser(COMPANY_A.user, db.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCandidatesTab).mockResolvedValue(TAB);
});

describe("/company/candidates (BI-REQ-003)", () => {
  it("hands the page's search params to the table", async () => {
    await signInWith(OWNER_A.membership);

    render(await CompanyCandidatesPage({ searchParams: Promise.resolve({ q: "meera" }) }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Candidates");
    expect(vi.mocked(loadCandidatesTab).mock.calls[0][2]).toEqual({ q: "meera" });
    expect(vi.mocked(CompanyCandidatesTable).mock.calls[0][0]).toMatchObject(TAB);
  });

  it("says what's missing without talent.view, and loads nothing (BI-PERM-002)", async () => {
    await signInWith(memberWith(["applicants.view"]).membership);

    render(await CompanyCandidatesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/^Your role can't/)).toBeInTheDocument();
    expect(loadCandidatesTab).not.toHaveBeenCalled();
    expect(screen.queryByTestId("table")).not.toBeInTheDocument();
  });
});
