import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import ResumeIdPage from "./page";

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
vi.mock("@/components/OriginalResumeWrapper", () => ({
  default: ({ url }: { url: string }) => <div data-testid="file">{url}</div>,
}));
vi.mock("@/components/CreateReviewForResume", () => ({ default: () => <button>Review</button> }));
vi.mock("@/components/RetryResumeParsing", () => ({ RetryResumeParsing: () => <button>Retry</button> }));
vi.mock("@/components/resume/ResumeHeaderActions", () => ({ default: () => <button>Edit</button> }));
vi.mock("@/components/InfoTooltip", () => ({ default: () => null }));
vi.mock("@/components/agent/AskAgentOnApplicantIdPages", () => ({
  AskAgentAboutResume: ({ resume }: { resume: { name: string } }) => <div data-testid="agent">{resume.name}</div>,
}));

const USER = { id: "00000000-0000-4000-8000-000000000001", app_metadata: { type: "applicant" } };
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

const V2 = {
  id: RESUME_ID,
  name: "Backend",
  is_primary: false,
  parsing_failed: false,
  resume_path: null,
  schema_version: 2,
  revision: 2,
  template: "classic",
  contact: { fullName: "Ada Lovelace", links: [] },
  content: { version: 2, sections: [{ id: "s", type: "skills", items: [{ id: "i", heading: "Go", bullets: [] }] }] },
};

const V1 = { ...V2, schema_version: 1, resume_path: "resumes/u/cv.pdf", contact: null, content: { sections: [] } };

let db: SupabaseMock;
let createSignedUrl: ReturnType<typeof vi.fn>;

const open = async (row: unknown) => {
  db.queue("resumes", { data: row, error: null });
  return render(await ResumeIdPage({ params: Promise.resolve({ resumeId: RESUME_ID }) }));
};

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: USER as never });
  createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://files/cv.pdf" }, error: null });
  Object.assign(db.client, { storage: { from: () => ({ createSignedUrl }) } });
  vi.mocked(createClient).mockResolvedValue(db.client);
});

describe("/resume/[resumeId] (RE-REQ-031)", () => {
  it("renders a version 2 resume, and never asks for a signed URL", async () => {
    await open(V2);

    expect(screen.getByRole("article", { name: "Resume preview" })).toHaveTextContent("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("renders a version 2 resume that still has a file, without it", async () => {
    await open({ ...V2, resume_path: "resumes/u/cv.pdf" });

    expect(screen.queryByTestId("file")).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("keeps the signed PDF for a version 1 resume", async () => {
    await open(V1);

    expect(screen.getByTestId("file")).toHaveTextContent("https://files/cv.pdf");
    expect(createSignedUrl).toHaveBeenCalledWith("resumes/u/cv.pdf", 3600);
    expect(screen.queryByRole("article", { name: "Resume preview" })).toBeNull();
  });

  it("offers a retry for a failed version 1 resume, and hides what it can't do", async () => {
    await open({ ...V1, parsing_failed: true, content: null });

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByText("Sync Failed")).toBeInTheDocument();
  });

  it("asks for a re-upload when a version 1 resume has no file", async () => {
    await open({ ...V1, resume_path: null, parsing_failed: true, content: null });

    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Upload it again" })).toHaveAttribute("href", `/resume/${RESUME_ID}/edit`);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("asks for a re-upload when any resume has no content and no file", async () => {
    await open({ ...V2, resume_path: null, parsing_failed: true, content: null });

    expect(screen.getByRole("link", { name: "Upload it again" })).toHaveAttribute("href", `/resume/${RESUME_ID}/edit`);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("shows a failed version 1 resume that still has content, with a retry", async () => {
    await open({ ...V1, parsing_failed: true });

    expect(screen.getByTestId("file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByText("This resume needs uploading again")).toBeNull();
  });

  it("still renders AskAgentAboutResume", async () => {
    await open(V2);
    expect(screen.getByTestId("agent")).toHaveTextContent("Backend");
  });

  it("only reads the user's own resume", async () => {
    await open(V2);
    expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
  });
});
