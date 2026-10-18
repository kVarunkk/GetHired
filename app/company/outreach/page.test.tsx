import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { listCompanyOutreach } from "@/helpers/outreach/list";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { memberWith, OWNER_A } from "@/test/utils/team";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { OUTREACH_JOB } from "@/test/utils/outreach";
import OutreachTable from "@/components/outreach/OutreachTable";
import { AskAgentAboutOutreachList } from "@/components/agent/recruiter/AskAgentOnMainPages";
import CompanyOutreachPage from "./page";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/outreach/list", () => ({ listCompanyOutreach: vi.fn() }));
vi.mock("@/components/outreach/OutreachTable", () => ({ default: vi.fn(() => <div data-testid="table" />) }));
vi.mock("@/components/agent/recruiter/AskAgentOnMainPages", () => ({
  AskAgentAboutOutreachList: vi.fn(() => <div data-testid="outreach-helper" />),
}));
vi.mock("@/components/Error", () => ({ default: () => <p>error</p> }));

let db: SupabaseMock;

const ITEM = {
  id: "f0000000-0000-4000-8000-000000000001",
  candidateUserId: PUBLIC_APPLICANT.id,
  candidateName: "Ada Lovelace",
  jobPostId: OUTREACH_JOB.id,
  jobTitle: "Frontend Engineer",
  subject: "Frontend role",
  status: "sent" as const,
  source: "manual" as const,
  senderName: "Olive Owner",
  sentAt: "2026-10-01T09:00:00.000Z",
  respondedAt: null,
  expiresAt: "2026-10-31T09:00:00.000Z",
};

beforeEach(async () => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: COMPANY_A.user });
  db.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  db.queue("job_postings", { data: [{ id: OUTREACH_JOB.id, title: "Frontend Engineer" }], error: null });
  await setRequestUser(COMPANY_A.user, db.client);
});

describe("/company/outreach (ORT-032)", () => {
  it("shows the reply rate and hands the page and filters to the table", async () => {
    vi.mocked(listCompanyOutreach).mockResolvedValue({ items: [ITEM, { ...ITEM, id: "f2", status: "interested", respondedAt: "2026-10-02T00:00:00.000Z" }], nextCursor: "c", replyRate: 0.5 });

    render(await CompanyOutreachPage({ searchParams: Promise.resolve({ status: "sent", job: OUTREACH_JOB.id }) }));

    expect(screen.getByTestId("reply-rate")).toHaveTextContent("50%");
    expect(vi.mocked(OutreachTable).mock.calls[0][0]).toMatchObject({
      items: [ITEM, expect.objectContaining({ id: "f2" })],
      jobs: [{ id: OUTREACH_JOB.id, title: "Frontend Engineer" }],
      jobPostId: OUTREACH_JOB.id,
      status: "sent",
      cursor: null,
      nextCursor: "c",
    });
    expect(vi.mocked(listCompanyOutreach).mock.calls[0][1]).toEqual({ jobPostId: OUTREACH_JOB.id, status: "sent", cursor: null });
  });

  it("ignores unknown filters", async () => {
    vi.mocked(listCompanyOutreach).mockResolvedValue({ items: [], nextCursor: null, replyRate: null });

    render(await CompanyOutreachPage({ searchParams: Promise.resolve({ status: "hacked", job: "x" }) }));

    expect(vi.mocked(listCompanyOutreach).mock.calls[0][1]).toEqual({ jobPostId: null, status: null, cursor: null });
    expect(vi.mocked(OutreachTable).mock.calls[0][0]).toMatchObject({ items: [], jobPostId: null, status: null });
    expect(screen.getByTestId("reply-rate")).toHaveTextContent("—");
  });

  it("links to Profiles and shows the agent helper with the permissions (T14)", async () => {
    vi.mocked(listCompanyOutreach).mockResolvedValue({ items: [], nextCursor: null, replyRate: null });

    render(await CompanyOutreachPage({}));

    expect(screen.getByRole("link", { name: "Find candidates" })).toHaveAttribute("href", "/company/profiles");
    expect(screen.getByTestId("outreach-helper")).toBeInTheDocument();
    expect(vi.mocked(AskAgentAboutOutreachList).mock.calls[0][0]).toEqual({ canMatch: true });
  });

  it("hides the CTA and the helper without talent.view, outreach.send or agent.use", async () => {
    vi.mocked(listCompanyOutreach).mockResolvedValue({ items: [], nextCursor: null, replyRate: null });
    db = createSupabaseMock({ user: COMPANY_A.user });
    db.queueRpc("my_company_access", { data: memberWith(["agent.use"]).membership, error: null });
    db.queue("job_postings", { data: [], error: null });
    await setRequestUser(COMPANY_A.user, db.client);

    render(await CompanyOutreachPage({}));

    expect(screen.queryByRole("link", { name: "Find candidates" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("outreach-helper")).not.toBeInTheDocument();
  });

  it("shows the CTA but not the helper with talent.view only", async () => {
    vi.mocked(listCompanyOutreach).mockResolvedValue({ items: [], nextCursor: null, replyRate: null });
    db = createSupabaseMock({ user: COMPANY_A.user });
    db.queueRpc("my_company_access", { data: memberWith(["agent.use", "outreach.view"]).membership, error: null });
    db.queue("job_postings", { data: [], error: null });
    await setRequestUser(COMPANY_A.user, db.client);

    render(await CompanyOutreachPage({}));

    expect(screen.getByRole("link", { name: "Find candidates" })).toBeInTheDocument();
    expect(screen.queryByTestId("outreach-helper")).not.toBeInTheDocument();
  });
});
