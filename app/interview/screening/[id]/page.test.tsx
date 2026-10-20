import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import ScreeningInterviewPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/components/Error", () => ({ default: () => <p>error</p> }));
vi.mock("@/components/interviews/ScreeningInterviewView", () => ({
  default: ({ invite, sessionHistory }: { invite: { status: string }; sessionHistory: unknown[] }) => (
    <p>
      view {invite.status} {sessionHistory.length}
    </p>
  ),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  unstable_rethrow: vi.fn((err: unknown) => {
    if (err instanceof Error && err.message === "NEXT_NOT_FOUND") throw err;
  }),
}));

const ID = "fa000000-0000-4000-8000-000000000001";
const INTERVIEW_ID = "1a000000-0000-4000-8000-000000000001";
let db: SupabaseMock;

const renderPage = async (id = ID) => render(await ScreeningInterviewPage({ params: Promise.resolve({ id }) }));

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createClient).mockResolvedValue(db.client as never);
});

describe("/interview/screening/[id] (SIT-053)", () => {
  it("renders the applicant's own interview with its sessions", async () => {
    db.queueRpc("my_screening_interviews", { data: { id: ID, interview_id: INTERVIEW_ID, status: "invited" }, error: null });
    db.queue("interviews", {
      data: { id: INTERVIEW_ID, interview_sessions: [{ id: "s1", turns: [], started_at: "x", status: "ineligible" }] },
      error: null,
    });

    await renderPage();

    expect(screen.getByText("view invited 1")).toBeInTheDocument();
    expect(db.callsFor("my_screening_interviews")[0].chain).toContainEqual({ method: "eq", args: ["id", ID] });
    expect(db.callsFor("interviews")[0].chain).toContainEqual({ method: "eq", args: ["id", INTERVIEW_ID] });
  });

  it("is not found for another user's id (the function returns nothing)", async () => {
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(db.callsFor("interviews")).toHaveLength(0);
  });

  it("is not found for a malformed id", async () => {
    await expect(renderPage("nope")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
