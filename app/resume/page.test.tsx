import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import ResumePage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/components/CreateResumeDialog", () => ({ default: () => <button>New resume</button> }));
vi.mock("@/components/ResumesTable", () => ({
  default: ({ data }: { data: { id: string; has_content: boolean }[] }) => (
    <ul>
      {data.map((row) => (
        <li key={row.id} data-testid="row">
          {row.id}:{String(row.has_content)}
        </li>
      ))}
    </ul>
  ),
}));
vi.mock("@/components/agent/AskAgentOnApplicantPages", () => ({ AskAgentAboutResumes: () => null }));
vi.mock("@/components/resume/ResumeReuploadPrompt", () => ({
  default: ({ resume }: { resume: { id: string } | null }) =>
    resume ? <div data-testid="reupload">{resume.id}</div> : null,
}));

const USER = { id: "00000000-0000-4000-8000-000000000001", app_metadata: { type: "applicant" } };
const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  created_at: "2026-11-01T00:00:00.000Z",
  name: id,
  is_primary: false,
  parsing_failed: false,
  schema_version: 2,
  content: { version: 2, sections: [] },
  resume_reviews: [{ count: 0 }],
  ...overrides,
});

let db: SupabaseMock;

const open = async (rows: unknown[]) => {
  db.queue("resumes", { data: rows, error: null });
  return render(await ResumePage());
};

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: USER as never });
  vi.mocked(createClient).mockResolvedValue(db.client);
});

describe("/resume (RE-REQ-098, RE-REQ-103)", () => {
  it("asks for a failed resume's file again when it has no content", async () => {
    await open([row("r1", { parsing_failed: true, content: null })]);

    expect(screen.getByTestId("reupload")).toHaveTextContent("r1");
  });

  it("asks once, for the needs-it-most, however many failed", async () => {
    await open([
      row("r1", { parsing_failed: true, content: null }),
      row("r2", { parsing_failed: true, content: null }),
    ]);

    expect(screen.getAllByTestId("reupload")).toHaveLength(1);
    expect(screen.getByTestId("reupload")).toHaveTextContent("r1");
  });

  it("says nothing when a failed resume still has content to edit", async () => {
    await open([row("r1", { parsing_failed: true })]);

    expect(screen.queryByTestId("reupload")).toBeNull();
  });

  it("says nothing when no resume failed", async () => {
    await open([row("r1")]);

    expect(screen.queryByTestId("reupload")).toBeNull();
  });

  it("says nothing when the user has no resumes", async () => {
    await open([]);

    expect(screen.queryByTestId("reupload")).toBeNull();
  });

  it("tells the table which rows have content, so it can hide what can't be edited", async () => {
    await open([row("r1"), row("r2", { parsing_failed: true, content: null })]);

    expect(screen.getAllByTestId("row").map((el) => el.textContent)).toEqual(["r1:true", "r2:false"]);
  });
});
