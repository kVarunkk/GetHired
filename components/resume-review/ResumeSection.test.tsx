import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TResumeReviewServer } from "@/utils/types/review.types";
import ResumeSection from "./ResumeSection";

const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://files.test/r.pdf" }, error: null }));
const storageClient = { storage: { from: () => ({ createSignedUrl }) } };

vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => storageClient }));
vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));
vi.mock("@/app/actions/resume-review/link-review-resume", () => ({ linkReviewResumeAction: vi.fn() }));
vi.mock("@/app/actions/retry-resume-parsing", () => ({ retryResumeParsingAction: vi.fn() }));
vi.mock("../ResumeSourceSelector", () => ({ default: () => null }));
vi.mock("../OriginalResumeWrapper", () => ({ default: ({ url }: { url: string }) => <p>PDF at {url}</p> }));

const CONTENT = {
  version: 2,
  sections: [
    {
      id: "s1",
      type: "experience",
      items: [{ id: "i1", heading: "Engineer", bullets: [{ id: "b1", text: "Built the billing API" }] }],
    },
  ],
};

const resume = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    name: "Backend",
    content: CONTENT,
    contact: { fullName: "Ada Lovelace", links: [] },
    template: "classic",
    revision: 2,
    schema_version: 2,
    resume_path: null,
    parsing_failed: false,
    ...overrides,
  }) as unknown as TResumeReviewServer["resumes"];

const show = (linkedResume: TResumeReviewServer["resumes"], activeHighlightId: string | null = null) =>
  render(
    <ResumeSection
      isParsed
      existingResumes={[]}
      linkedResume={linkedResume}
      activeHighlightId={activeHighlightId}
      isResumeLinked
      isParsingFailed={false}
      reviewId="rev1"
      changeTriggerState={vi.fn()}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ResumeSection (RE-REQ-060)", () => {
  it("renders a version 2 resume, contact included, with no file", () => {
    show(resume());

    expect(screen.getByRole("article", { name: "Resume preview" })).toHaveTextContent("Ada Lovelace");
    expect(screen.getByText("Built the billing API")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Original" })).not.toBeInTheDocument();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("highlights the active bullet, with the id the page scrolls to", () => {
    show(resume(), "b1");

    const bullet = screen.getByText("Built the billing API");
    expect(bullet).toHaveAttribute("data-active", "true");
    expect(bullet).toHaveAttribute("id", "bullet-b1");
  });

  it("keeps the PDF for a version 1 resume", async () => {
    const user = userEvent.setup();
    show(resume({ schema_version: 1, resume_path: "u1/r1.pdf", contact: null }));

    await waitFor(() => expect(createSignedUrl).toHaveBeenCalledWith("u1/r1.pdf", 3600));
    await user.click(screen.getByRole("button", { name: "Original" }));

    expect(await screen.findByText("PDF at https://files.test/r.pdf")).toBeInTheDocument();
  });
});
