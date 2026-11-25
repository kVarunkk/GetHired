import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { loadApplyPage } from "@/helpers/applications/apply-page";
import JobApplyPage, { metadata } from "./page";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/applications/apply-page", () => ({ loadApplyPage: vi.fn() }));
vi.mock("@/components/apply/ApplyPage", () => ({
  default: (props: Record<string, unknown>) => <div data-testid="apply" data-props={JSON.stringify(props)} />,
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_")) throw err;
  },
}));

const JOB_ID = "d0000000-0000-4000-8000-000000000001";
const show = async (searchParams: Record<string, string> = {}) =>
  render(await JobApplyPage({ params: Promise.resolve({ job_id: JOB_ID }), searchParams: Promise.resolve(searchParams) }));

beforeEach(() => vi.clearAllMocks());

describe("/jobs/[job_id]/apply (APT-005, AP-REQ-001/004)", () => {
  it("is noindex", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("passes the source, tag and job page to the shared page, with no careers option", async () => {
    vi.mocked(loadApplyPage).mockResolvedValue({
      kind: "form",
      job: { id: JOB_ID } as never,
      userId: "u1",
      source: "job_board",
      ref: "indeed",
      doneHref: `/jobs/${JOB_ID}`,
    });
    await show({ src: "indeed", pid: "p9" });

    const [id, options] = vi.mocked(loadApplyPage).mock.calls[0];
    expect(id).toBe(JOB_ID);
    expect(options.query.get("src")).toBe("indeed");
    expect(options.careers).toBeUndefined();
    expect(JSON.parse(screen.getByTestId("apply").dataset.props!)).toMatchObject({
      userId: "u1",
      source: "job_board",
      sourceRef: "indeed",
      doneHref: `/jobs/${JOB_ID}`,
    });
  });

  it("404s and redirects as loadApplyPage says", async () => {
    vi.mocked(loadApplyPage).mockResolvedValueOnce({ kind: "not_found" });
    await expect(show()).rejects.toThrow("NEXT_NOT_FOUND");
    vi.mocked(loadApplyPage).mockResolvedValueOnce({ kind: "redirect", to: "/auth/login?returnTo=x" });
    await expect(show()).rejects.toThrow("NEXT_REDIRECT /auth/login?returnTo=x");
  });
});
