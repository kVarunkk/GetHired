import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createClient } from "@/lib/supabase/server";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { getStaticJobDetails } from "@/helpers/jobs/jobId/get-job-details";
import { loadApplyPage } from "./apply-page";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/helpers/jobs/jobId/get-job-details", () => ({ getStaticJobDetails: vi.fn() }));

const JOB_ID = "d0000000-0000-4000-8000-000000000001";
const JOB = { id: JOB_ID, is_platform_job: true } as never;
const USER = { id: "u1", app_metadata: { type: "applicant" } } as never;

let mock: SupabaseMock;
const load = (query = "", careers?: { slug: string }) =>
  loadApplyPage(JOB_ID, { query: new URLSearchParams(query), careers });

const setDb = (filled: boolean | null, applications: unknown[] = []) => {
  mock = createSupabaseMock();
  mock.queue("user_info", { data: filled === null ? null : { filled }, error: null });
  mock.queue("applications", { data: applications, error: null });
  vi.mocked(createClient).mockResolvedValue(mock.client as never);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStaticJobDetails).mockResolvedValue(JOB);
  vi.mocked(getUserFromRequest).mockResolvedValue(USER);
  setDb(true);
});

describe("loadApplyPage (APT-002, AP-REQ-011)", () => {
  it("is a 404 for a missing or inactive job", async () => {
    vi.mocked(getStaticJobDetails).mockResolvedValue(null);
    expect(await load()).toEqual({ kind: "not_found" });
  });

  it("sends an external job to its job page, before anything about the user", async () => {
    vi.mocked(getStaticJobDetails).mockResolvedValue({ id: JOB_ID, is_platform_job: false } as never);
    vi.mocked(getUserFromRequest).mockResolvedValue(null);
    expect(await load()).toEqual({ kind: "redirect", to: `/jobs/${JOB_ID}` });
  });

  it("logs a signed-out visitor in and back, keeping the query", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(null);
    const board = (await load("src=indeed&pid=p9&junk=1")) as { to: string };
    expect(decodeURIComponent(board.to.split("returnTo=")[1])).toBe(`/jobs/${JOB_ID}/apply?src=indeed&pid=p9`);

    const careers = (await load("ref=LinkedIn", { slug: "acme" })) as { to: string };
    expect(decodeURIComponent(careers.to.split("returnTo=")[1])).toBe(
      `/careers/acme/jobs/${JOB_ID}/apply?ref=linkedin`,
    );
  });

  it("sends a company user to the job page", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue({ id: "c1", app_metadata: { type: "company" } } as never);
    expect(await load()).toEqual({ kind: "redirect", to: `/jobs/${JOB_ID}` });
    expect(await load("ref=x", { slug: "acme" })).toEqual({
      kind: "redirect",
      to: `/careers/acme/jobs/${JOB_ID}?ref=x`,
    });
  });

  it("sends an applicant who hasn't finished onboarding to /get-started", async () => {
    setDb(false);
    expect(await load()).toEqual({ kind: "redirect", to: "/get-started" });
  });

  it("sends an applicant who already applied to the job page", async () => {
    setDb(true, [{ id: "a1" }]);
    expect(await load()).toEqual({ kind: "redirect", to: `/jobs/${JOB_ID}` });
  });

  it("shows the form with no source when the job board has no tag", async () => {
    expect(await load("apply=true&source=careers_page")).toEqual({
      kind: "form",
      job: JOB,
      userId: "u1",
      source: undefined,
      ref: undefined,
      doneHref: `/jobs/${JOB_ID}`,
    });
  });

  it("records a job-board source from the tag (AP-REQ-021)", async () => {
    expect(await load("src=Indeed&pid=p9")).toMatchObject({ source: "job_board", ref: "indeed" });
  });

  it("always records careers_page on the careers route (AP-REQ-020)", async () => {
    expect(await load("ref=LinkedIn&src=indeed", { slug: "acme" })).toMatchObject({
      kind: "form",
      source: "careers_page",
      ref: "linkedin",
      doneHref: `/careers/acme/jobs/${JOB_ID}?ref=linkedin`,
    });
  });
});
