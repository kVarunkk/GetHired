import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { getCompanyOutreach, type CompanyOutreachDetail } from "@/helpers/outreach/detail";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { OWNER_A } from "@/test/utils/team";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { OUTREACH_JOB } from "@/test/utils/outreach";
import AskAgentAboutOutreach from "@/components/agent/recruiter/AskAgentAboutOutreach";
import CompanyOutreachDetailPage from "./page";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/outreach/detail", () => ({ getCompanyOutreach: vi.fn() }));
vi.mock("@/components/agent/recruiter/AskAgentAboutOutreach", () => ({
  default: vi.fn(() => <div data-testid="ask-agent" />),
}));
vi.mock("@/components/outreach/WithdrawOutreachButton", () => ({ default: () => <button>Withdraw</button> }));
vi.mock("@/components/Error", () => ({ default: () => <p>error</p> }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  unstable_rethrow: vi.fn((err: unknown) => {
    if (err instanceof Error && err.message === "NEXT_NOT_FOUND") throw err;
  }),
}));

const ID = "f0000000-0000-4000-8000-000000000001";

const detail = (overrides: Partial<CompanyOutreachDetail> = {}): CompanyOutreachDetail => ({
  id: ID,
  candidateUserId: PUBLIC_APPLICANT.id,
  candidateName: "Ada Lovelace",
  jobPostId: OUTREACH_JOB.id,
  jobTitle: "Frontend Engineer",
  subject: "Frontend role at Acme",
  message: "Hi Ada, your React work stood out.",
  status: "sent",
  source: "agent",
  senderName: "Olive Owner",
  sentAt: "2026-10-01T09:00:00.000Z",
  respondedAt: null,
  expiresAt: "2999-01-01T09:00:00.000Z",
  declineReason: null,
  candidateNote: null,
  candidateContact: null,
  ...overrides,
});

let db: SupabaseMock;

const renderPage = async (id = ID) => render(await CompanyOutreachDetailPage({ params: Promise.resolve({ id }) }));

beforeEach(async () => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: COMPANY_A.user });
  db.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(COMPANY_A.user, db.client);
});

describe("/company/outreach/[id]", () => {
  it("shows the message, who sent it, links and Withdraw while it's open", async () => {
    vi.mocked(getCompanyOutreach).mockResolvedValue(detail());

    await renderPage();

    expect(vi.mocked(getCompanyOutreach).mock.calls[0][1]).toBe(ID);
    expect(vi.mocked(getCompanyOutreach).mock.calls[0][0].company.id).toBe(COMPANY_A.id);
    expect(screen.getByRole("heading", { name: "Frontend role at Acme" })).toBeInTheDocument();
    expect(screen.getByText("Hi Ada, your React work stood out.")).toBeInTheDocument();
    expect(screen.getByText(/by Olive Owner with the agent/)).toBeInTheDocument();
    expect(screen.getByText(/No answer yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View profile/ })).toHaveAttribute(
      "href",
      `/company/profiles/${PUBLIC_APPLICANT.id}`,
    );
    expect(screen.getByRole("link", { name: /View job post/ })).toHaveAttribute(
      "href",
      `/company/job-posts/${OUTREACH_JOB.id}`,
    );
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(vi.mocked(AskAgentAboutOutreach).mock.calls[0][0].outreach).toMatchObject({ id: ID, status: "sent" });
  });

  it("shows an Interested answer with the note and contact", async () => {
    vi.mocked(getCompanyOutreach).mockResolvedValue(
      detail({
        status: "interested",
        respondedAt: "2026-10-02T09:00:00.000Z",
        candidateNote: "Happy to talk next week",
        candidateContact: "ada@example.com",
      }),
    );

    await renderPage();

    expect(screen.getByText(/Ada Lovelace is interested/)).toBeInTheDocument();
    expect(screen.getByText("Happy to talk next week")).toBeInTheDocument();
    expect(screen.getByTestId("candidate-contact")).toHaveTextContent("ada@example.com");
    expect(screen.queryByRole("button", { name: "Withdraw" })).not.toBeInTheDocument();
  });

  it("shows the decline reason", async () => {
    vi.mocked(getCompanyOutreach).mockResolvedValue(
      detail({ status: "not_interested", declineReason: "compensation", respondedAt: "2026-10-02T09:00:00.000Z" }),
    );

    await renderPage();

    expect(screen.getByText(/isn't interested.*Reason: Compensation\./)).toBeInTheDocument();
    expect(screen.queryByTestId("candidate-contact")).not.toBeInTheDocument();
  });

  it("is not found for a bad id or another company's outreach", async () => {
    await expect(renderPage("nope")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getCompanyOutreach).not.toHaveBeenCalled();

    vi.mocked(getCompanyOutreach).mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
