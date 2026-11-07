import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import EditResumePage from "./page";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  unstable_rethrow: vi.fn((error: Error) => {
    if (error.message === "NEXT_NOT_FOUND") throw error;
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/components/resume/ResumeEditor", () => ({
  default: (props: { revision: number; initial: { name: string }; unusedLines: string[] }) => (
    <div data-testid="editor">{JSON.stringify(props)}</div>
  ),
}));
vi.mock("@/components/resume/ResumeUpgradeGate", () => ({ default: () => <div data-testid="gate" /> }));
vi.mock("@/components/agent/AskAgentOnApplicantIdPages", () => ({
  AskAgentAboutResume: ({ resume }: { resume: object }) => <div data-testid="agent">{JSON.stringify(resume)}</div>,
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

const ROW = {
  id: RESUME_ID,
  name: "Backend",
  content: { version: 2, sections: [] },
  contact: null,
  template: "compact",
  revision: 5,
  schema_version: 2,
  parse_notes: { unusedLines: ["Page 2"] },
  is_primary: true,
  parsing_failed: false,
};

let db: SupabaseMock;

const open = async (id = RESUME_ID) => render(await EditResumePage({ params: Promise.resolve({ resumeId: id }) }));

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: { id: USER_ID, app_metadata: { type: "applicant" } } });
  vi.mocked(createClient).mockResolvedValue(db.client);
});

describe("/resume/[resumeId]/edit", () => {
  it("opens a version 2 resume in the editor, with no contact handled", async () => {
    db.queue("resumes", { data: ROW, error: null });

    await open();

    const props = JSON.parse(screen.getByTestId("editor").textContent!);
    expect(props).toMatchObject({
      resumeId: RESUME_ID,
      revision: 5,
      unusedLines: ["Page 2"],
      initial: { name: "Backend", template: "compact", contact: { fullName: "", links: [] } },
    });
  });

  it("offers the agent, about this resume", async () => {
    db.queue("resumes", { data: ROW, error: null });

    await open();

    expect(JSON.parse(screen.getByTestId("agent").textContent!)).toEqual({
      id: RESUME_ID,
      name: "Backend",
      isPrimary: true,
      parsingFailed: false,
    });
  });

  it("offers the agent to applicants only", async () => {
    db = createSupabaseMock({ user: { id: USER_ID, app_metadata: { type: "company" } } });
    vi.mocked(createClient).mockResolvedValue(db.client);
    db.queue("resumes", { data: ROW, error: null });

    await open();

    expect(screen.queryByTestId("agent")).toBeNull();
  });

  it("only reads the user's own resume", async () => {
    db.queue("resumes", { data: ROW, error: null });

    await open();

    expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER_ID] });
  });

  it("upgrades a version 1 resume first", async () => {
    db.queue("resumes", { data: { ...ROW, schema_version: 1, content: { sections: [] } }, error: null });

    await open();

    expect(screen.getByTestId("gate")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("404s for a bad id or someone else's resume", async () => {
    await expect(open("nope")).rejects.toThrow("NEXT_NOT_FOUND");

    db.queue("resumes", { data: null, error: null });
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(2);
  });
});
