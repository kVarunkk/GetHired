import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { outreachOf } from "@/test/utils/outreach";
import RespondForm from "@/components/outreach/RespondForm";
import OpportunitiesPage from "./page";
import OpportunityPage from "./[id]/page";

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw NOT_FOUND;
  },
  unstable_rethrow: (err: unknown) => {
    if (err === NOT_FOUND) throw err;
  },
}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/components/outreach/RespondForm", () => ({ default: vi.fn(() => null) }));
vi.mock("@/components/Error", () => ({ default: () => <p>error</p> }));

let db: SupabaseMock;
const future = new Date(Date.now() + 10 * 86400000).toISOString();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: PUBLIC_APPLICANT.user });
  await setRequestUser(PUBLIC_APPLICANT.user, db.client);
});

describe("/opportunities (ORT-033)", () => {
  it("lists company, job and status, open first", async () => {
    db.queue("candidate_outreach", {
      data: [
        { ...outreachOf("interested"), company_info: { name: "Globex", logo_url: null }, job_postings: null },
        { ...outreachOf("sent", { expires_at: future }), company_info: { name: "Acme", logo_url: null }, job_postings: { title: "Frontend Engineer" } },
      ],
      error: null,
    });

    render(await OpportunitiesPage());

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Acme");
    expect(rows[0]).toHaveTextContent("Frontend Engineer");
    expect(rows[0]).toHaveTextContent("Waiting for you");
    expect(rows[1]).toHaveTextContent("Globex");
    expect(rows[1]).toHaveTextContent("Interested");
  });

  it("shows an empty state", async () => {
    db.queue("candidate_outreach", { data: [], error: null });
    render(await OpportunitiesPage());
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });
});

describe("/opportunities/[id] (ORT-033)", () => {
  const visit = (id: string) => OpportunityPage({ params: Promise.resolve({ id }) });
  const row = (overrides = {}) => ({
    ...outreachOf("sent", { expires_at: future, message: "Hi <b>Ada</b>\n\nSee https://acme.dev" }),
    company_info: { name: "Acme", logo_url: null, website: null },
    job_postings: { title: "Frontend Engineer", job_id: "d0000000-0000-4000-8000-000000000001" },
    ...overrides,
  });

  it("shows the message as plain text under 'Message from <company>', and the form", async () => {
    const o = row();
    db.queue("candidate_outreach", { data: o, error: null });
    db.queue("all_jobs", { data: { id: "d0000000-0000-4000-8000-000000000001", status: "active" }, error: null });

    const { container } = render(await visit(o.id));

    expect(screen.getByText("Message from Acme")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("Hi <b>Ada</b>");
    expect(db.callsFor("candidate_outreach")[0].chain).toContainEqual({
      method: "eq",
      args: ["candidate_user_id", PUBLIC_APPLICANT.id],
    });
    expect(vi.mocked(RespondForm).mock.calls[0][0]).toMatchObject({
      outreachId: o.id,
      companyName: "Acme",
      status: "sent",
      open: true,
      applyHref: "/jobs/d0000000-0000-4000-8000-000000000001?apply=true",
    });
  });

  it("hides Apply now for a closed posting (difference 11)", async () => {
    const o = row();
    db.queue("candidate_outreach", { data: o, error: null });
    db.queue("all_jobs", { data: { id: "d0000000-0000-4000-8000-000000000001", status: "inactive" }, error: null });

    render(await visit(o.id));

    expect(vi.mocked(RespondForm).mock.calls[0][0].applyHref).toBeNull();
  });

  it("marks an expired outreach as not open", async () => {
    const o = row({ status: "expired", expires_at: "2026-01-01T00:00:00.000Z", job_postings: null });
    db.queue("candidate_outreach", { data: o, error: null });

    render(await visit(o.id));

    expect(vi.mocked(RespondForm).mock.calls[0][0]).toMatchObject({ status: "expired", open: false, applyHref: null });
  });

  it("is not found for another user's id (RLS returns nothing) or a bad id", async () => {
    db.queue("candidate_outreach", { data: null, error: null });
    await expect(visit(outreachOf("sent").id)).rejects.toBe(NOT_FOUND);
    await expect(visit("nope")).rejects.toBe(NOT_FOUND);
  });
});
