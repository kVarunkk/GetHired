import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCareersJobs, getCareersPage } from "@/helpers/careers/get-careers-page";
import { buildRequest } from "@/test/utils/request";
import { COMPANY_A } from "@/test/utils/recruiter";
import { GET } from "./route";

vi.mock("@/helpers/careers/get-careers-page", () => ({ getCareersPage: vi.fn(), getCareersJobs: vi.fn() }));

const PAGE = { id: COMPANY_A.id, slug: "acme", name: "Acme" } as never;
const JOB = {
  id: "b1",
  allJobsId: "d1",
  title: "Backend Engineer",
  description: "Build   our Go services.\n\nMore.",
  locations: ["bengaluru"],
  jobType: "Fulltime",
  department: "Engineering",
  workplaceType: "remote" as const,
  salaryCurrency: null,
  salaryRange: null,
  minSalary: null,
  maxSalary: null,
  minExperience: null,
  maxExperience: null,
  experience: null,
  createdAt: "2026-10-01",
};

const call = (query = "") =>
  GET(buildRequest(`/api/careers/acme/jobs${query}`), { params: Promise.resolve({ slug: "acme" }) });

beforeEach(() => {
  vi.mocked(getCareersPage).mockResolvedValue({ page: PAGE });
  vi.mocked(getCareersJobs).mockResolvedValue([JOB, { ...JOB, id: "b2", allJobsId: "d2", title: "Designer", department: "Design", workplaceType: null }]);
});

describe("GET /api/careers/[slug]/jobs (CPT-043)", () => {
  it("returns the filtered jobs with a snippet instead of the description", async () => {
    const res = await call("?workplace=remote");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.jobs).toEqual([{ ...Object.fromEntries(Object.entries(JOB).filter(([k]) => k !== "description")), snippet: "Build our Go services. More." }]);
    expect(getCareersJobs).toHaveBeenCalledWith(PAGE);
  });

  it("is a 404 for unpublished, unknown and retired slugs", async () => {
    vi.mocked(getCareersPage).mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    vi.mocked(getCareersPage).mockResolvedValueOnce({ redirect: "acme-careers" });
    expect((await call()).status).toBe(404);
    expect(getCareersJobs).not.toHaveBeenCalled();
  });

  it("hides errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getCareersJobs).mockRejectedValue(new Error("db down: secret detail"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't load the jobs." });
  });
});
