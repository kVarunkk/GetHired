import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ResumeSourceSelector from "./ResumeSourceSelector";

const row = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const createSignedUrl = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: row.current, error: null }) }),
      }),
    }),
    storage: { from: () => ({ createSignedUrl }) },
  }),
}));
vi.mock("@/helpers/resume-selector/SelectResumeParent", () => ({ SelectResumeParent: () => null }));
vi.mock("@/helpers/resume-selector/UploadResumeParent", () => ({ UploadResumeParent: () => null }));
vi.mock("@/components/ResumePreviewDialog", () => ({
  default: (props: { displayUrl?: string; document?: { name: string } }) =>
    props.displayUrl ? (
      <span>file:{props.displayUrl}</span>
    ) : (
      <span>document:{props.document?.name}</span>
    ),
}));

const content = {
  version: 2,
  sections: [],
};

function renderSelector() {
  render(
    <ResumeSourceSelector
      existingResumes={[{ id: "r1", name: "Mine", resume_path: "u/old.pdf" } as never]}
      selectedId="r1"
      onSelectExisting={vi.fn()}
      file={null}
      onFileChange={vi.fn()}
      view="select"
    />,
  );
}

describe("ResumeSourceSelector preview", () => {
  beforeEach(() => {
    createSignedUrl.mockReset();
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed/old.pdf" }, error: null });
  });

  it("shows an editor resume in the dialog, not its old file", async () => {
    row.current = {
      name: "Mine",
      resume_path: "u/old.pdf",
      content,
      contact: { fullName: "Ada Lovelace", links: [] },
      schema_version: 2,
      template: "classic",
    };
    renderSelector();
    expect(await screen.findByText("document:Ada Lovelace")).toBeInTheDocument();
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "View" })).toBeNull();
  });

  it("shows an older-format resume's file", async () => {
    row.current = { name: "Mine", resume_path: "u/old.pdf", content: null, contact: null, schema_version: 1, template: null };
    renderSelector();
    expect(await screen.findByText("file:https://signed/old.pdf")).toBeInTheDocument();
  });

  it("links to the resume page when there is nothing to show", async () => {
    row.current = { name: "Mine", resume_path: null, content: null, contact: null, schema_version: 1, template: null };
    renderSelector();
    expect(await screen.findByRole("link", { name: "View" })).toHaveAttribute("href", "/resume/r1");
  });
});
