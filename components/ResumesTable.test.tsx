import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResumesTable, { type TResumeTableRow } from "./ResumesTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("react-transition-progress/next", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("./ResumeSetPrimary", () => ({ default: () => null }));
vi.mock("./resume/ResumeRowActions", () => ({
  default: ({ resume, canDelete }: { resume: { id: string; isUnreadable: boolean }; canDelete: boolean }) => (
    <div data-testid={`actions-${resume.id}`}>{JSON.stringify({ ...resume, canDelete })}</div>
  ),
}));

const row = (overrides: Partial<TResumeTableRow>): TResumeTableRow => ({
  id: "r1",
  name: "Backend",
  created_at: "2026-01-01T00:00:00.000Z",
  is_primary: false,
  parsing_failed: false,
  schema_version: 2,
  has_content: true,
  ...overrides,
});

const actions = (id: string) => JSON.parse(screen.getByTestId(`actions-${id}`).textContent!);

describe("ResumesTable (RE-REQ-030)", () => {
  it("shows no status for a version 2 resume", () => {
    render(<ResumesTable data={[row({})]} />);

    expect(screen.queryByText("Older format")).toBeNull();
    expect(screen.queryByText("Sync Failed")).toBeNull();
  });

  it("marks a version 1 resume, which still works", () => {
    render(<ResumesTable data={[row({ schema_version: 1 })]} />);

    expect(screen.getByText("Older format")).toBeInTheDocument();
    expect(actions("r1").isUnreadable).toBe(false);
  });

  it("marks a failed version 1 resume, and hides what it can't do", () => {
    render(<ResumesTable data={[row({ schema_version: 1, parsing_failed: true, has_content: false })]} />);

    expect(screen.getByText("Sync Failed")).toBeInTheDocument();
    expect(screen.queryByText("Older format")).toBeNull();
    expect(actions("r1").isUnreadable).toBe(true);
  });

  it("lets a failed resume with content be edited: only its file is missing", () => {
    render(<ResumesTable data={[row({ schema_version: 1, parsing_failed: true, has_content: true })]} />);

    expect(screen.getByText("Needs a new file")).toBeInTheDocument();
    expect(screen.queryByText("Sync Failed")).toBeNull();
    expect(actions("r1").isUnreadable).toBe(false);
  });

  it("hides what a version 2 resume can't do when it has no content", () => {
    render(<ResumesTable data={[row({ parsing_failed: true, has_content: false })]} />);

    expect(screen.getByText("Sync Failed")).toBeInTheDocument();
    expect(actions("r1").isUnreadable).toBe(true);
  });

  it("only allows a delete when another resume stays", () => {
    const { unmount } = render(<ResumesTable data={[row({})]} />);
    expect(actions("r1").canDelete).toBe(false);
    unmount();

    render(<ResumesTable data={[row({}), row({ id: "r2", name: "Frontend" })]} />);
    expect(actions("r1").canDelete).toBe(true);
  });
});
