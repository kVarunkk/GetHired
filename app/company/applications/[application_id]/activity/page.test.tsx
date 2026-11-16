import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { eventOf } from "@/test/utils/pipeline";
import { JOB_A1, OWNER_A, memberWith, type MemberFixture } from "@/test/utils/team";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  unstable_rethrow: (err: unknown) => {
    throw err;
  },
}));
vi.mock("@/helpers/applications/application-page", () => ({ loadApplicationFrame: vi.fn() }));

import { loadApplicationFrame } from "@/helpers/applications/application-page";
import ApplicationActivityPage from "./page";

const APP = "ab000000-0000-4000-8000-000000000001";
const CARD = "5c000000-0000-4000-8000-000000000001";

async function renderAs(member: MemberFixture, contentVisible: boolean) {
  const db = createSupabaseMock({ user: member.user });
  db.queue("application_events", {
    data: [eventOf("scorecard_submitted", { actor_name: "Ian", payload: { name: "System design", scorecard_id: CARD } })],
    error: null,
  });
  db.queue("pipeline_stages", { data: [], error: null });
  db.queueRpc("list_interview_scorecards", {
    data: [
      {
        scorecard_id: CARD,
        status: "submitted",
        content_visible: contentVisible,
        overall: contentVisible ? "strong_yes" : null,
      },
    ],
    error: null,
  });
  vi.mocked(loadApplicationFrame).mockResolvedValue({
    supabase: db.client,
    company: member.myCompany,
    application: { id: APP, job_postings: { id: JOB_A1, company_id: member.company.id } },
    jobId: JOB_A1,
  } as never);
  render(await ApplicationActivityPage({ params: Promise.resolve({ application_id: APP }) }));
  return db;
}

beforeEach(() => vi.clearAllMocks());

describe("the Activity section's scorecard lines (IVT-022)", () => {
  it("shows the recommendation the RPC lets the reader see", async () => {
    await renderAs(OWNER_A, true);
    expect(screen.getByText(/Scorecard submitted for System design by Ian: Strong yes/)).toBeInTheDocument();
  });

  it("hides it from a blind reader", async () => {
    await renderAs(OWNER_A, false);
    expect(screen.getByText(/Scorecard submitted for System design by Ian$/)).toBeInTheDocument();
  });

  it("doesn't ask for scorecards without scheduling.view", async () => {
    const db = await renderAs(memberWith(["jobs.view", "applicants.view"]), true);
    expect(db.callsFor("list_interview_scorecards")).toHaveLength(0);
    expect(screen.queryByText(/Strong yes/)).not.toBeInTheDocument();
  });
});
