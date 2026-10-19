/**
 * SIT-054: every applicant read that means "my practice interviews" leaves
 * out screening interviews, and a screening id on the practice page goes to
 * its own page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import InterviewPage from "./page";
import InterviewIdPage from "./[interviewId]/page";
import InterviewAnalysisPage from "./[interviewId]/analysis/[sessionId]/page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/components/Error", () => ({ default: () => <p>error</p> }));
vi.mock("@/components/InterviewsTable", () => ({
  default: ({ data }: { data: unknown[] }) => <p>{data.length} interviews</p>,
}));
vi.mock("@/components/CreateInterviewDialog", () => ({ default: () => null }));
vi.mock("@/components/agent/AskAgentOnApplicantPages", () => ({ AskAgentAboutInterviews: () => null }));
vi.mock("@/components/InterviewComponent", () => ({ default: () => <p>practice interview</p> }));
vi.mock("@/components/InterviewAnalysisReport", () => ({ InterviewAnalysisReport: () => null }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  unstable_rethrow: vi.fn((err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_")) throw err;
  }),
}));

const USER = { id: "a0000000-0000-4000-8000-000000000001" };
const INTERVIEW_ID = "1a000000-0000-4000-8000-000000000001";
const APPLICATION_INTERVIEW_ID = "fa000000-0000-4000-8000-000000000001";
let db: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: USER });
  vi.mocked(createClient).mockResolvedValue(db.client as never);
});

describe("/interview list", () => {
  it("lists practice interviews only", async () => {
    db.queue("interviews", { data: [{ id: INTERVIEW_ID }], error: null });
    render(await InterviewPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("1 interviews")).toBeInTheDocument();
    expect(db.callsFor("interviews")[0].chain).toContainEqual({ method: "eq", args: ["kind", "practice"] });
  });
});

describe("/interview/[interviewId]", () => {
  it("redirects a screening interview to its own page", async () => {
    db.queue("interviews", {
      data: { id: INTERVIEW_ID, kind: "screening", application_interview_id: APPLICATION_INTERVIEW_ID },
      error: null,
    });
    await expect(InterviewIdPage({ params: Promise.resolve({ interviewId: INTERVIEW_ID }) })).rejects.toThrow(
      `NEXT_REDIRECT:/interview/screening/${APPLICATION_INTERVIEW_ID}`,
    );
    expect(db.callsFor("interview_sessions")).toHaveLength(0);
  });

  it("still renders a practice interview", async () => {
    db.queue("interviews", { data: { id: INTERVIEW_ID, kind: "practice", interview_sessions: [] }, error: null });
    db.queue("interview_sessions", { data: [], error: null });
    render(await InterviewIdPage({ params: Promise.resolve({ interviewId: INTERVIEW_ID }) }));
    expect(screen.getByText("practice interview")).toBeInTheDocument();
  });
});

describe("/interview/[interviewId]/analysis/[sessionId]", () => {
  it("only looks up practice interviews, so a screening id is not found", async () => {
    db.queue("interviews", { data: null, error: { message: "no rows" } as never });
    await expect(
      InterviewAnalysisPage({ params: Promise.resolve({ interviewId: INTERVIEW_ID, sessionId: "s1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(db.callsFor("interviews")[0].chain).toContainEqual({ method: "eq", args: ["kind", "practice"] });
  });
});
