import { describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { headLogoType, loadFeedJobs, PAGE_SIZE, toFeedJob, type FeedJobRow } from "./load-feed-jobs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

const row = (over: Partial<FeedJobRow> = {}): FeedJobRow => ({
  job_id: "j1",
  title: " Backend Engineer ",
  description: "About the role\nBuild and run the services behind our hiring platform every day.\n\n- Own the APIs\n- Ship weekly",
  location: ["bengaluru"],
  workplace_type: "onsite",
  job_type: "Fulltime",
  department: "Engineering",
  min_salary: 1000000,
  max_salary: 2000000,
  salary_currency: "₹",
  salary_range: null,
  min_experience: 2,
  max_experience: 5,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-10T00:00:00Z",
  company_info: { name: "Acme", logo_url: "https://x/logo.png" },
  ...over,
});

describe("toFeedJob", () => {
  it("maps public columns", () => {
    const job = toFeedJob(row())!;
    expect(job).toMatchObject({
      id: "j1",
      title: "Backend Engineer",
      city: "Bengaluru",
      locations: ["Bengaluru"],
      countryCode: "IN",
      jobType: "full_time",
      companyName: "Acme",
      category: "Engineering",
    });
    expect(job.updatedAt.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("carries the closing date and its end in the company's time zone (JLT-043)", () => {
    const job = toFeedJob(
      row({ closes_at: "2026-12-31", company_info: { ...row().company_info!, time_zone: "Asia/Kolkata" } }),
    )!;
    expect(job.closesOn).toBe("2026-12-31");
    expect(job.expiresAt?.toISOString()).toBe("2026-12-31T18:29:59.000Z");
    expect(toFeedJob(row())!.expiresAt).toBeNull();
  });

  it("leaves out ineligible jobs and jobs without a public id", () => {
    expect(toFeedJob(row({ description: "short" }))).toBeNull();
    expect(toFeedJob(row({ company_info: { name: "Acme", logo_url: null } }))).toBeNull();
    expect(toFeedJob(row({ job_id: null }))).toBeNull();
  });

  it("turns stored text and form values into what the feeds expect", () => {
    const job = toFeedJob(row({ title: "Urgent: Backend Engineer - Bengaluru" }))!;
    expect(job.title).toBe("Backend Engineer");
    expect(job.descriptionHtml).toBe(
      "<p>About the role<br>Build and run the services behind our hiring platform every day.</p>\n" +
        "<ul><li>Own the APIs</li><li>Ship weekly</li></ul>",
    );
    expect(job.state).toBe("Karnataka");
    expect(job.salary).toEqual({ min: 1000000, max: 2000000, currency: "INR", text: null });
  });

  it("treats the form's 0 salary and 'Not specified' as no salary", () => {
    expect(toFeedJob(row({ min_salary: 0, max_salary: 0, salary_range: "Not specified" }))!.salary).toBeNull();
    expect(toFeedJob(row({ min_salary: 0, max_salary: 0, salary_range: "Competitive" }))!.salary).toMatchObject({
      min: null,
      max: null,
      text: "Competitive",
    });
  });

  it("takes the logo type from the resolved map", () => {
    const types = new Map([["https://x/logo.png", "webp" as const]]);
    expect(toFeedJob(row(), types)!.companyLogoType).toBe("webp");
    expect(toFeedJob(row())!.companyLogoType).toBeNull();
  });

  it("keeps every location, cleaned and without repeats", () => {
    expect(toFeedJob(row({ location: ["bengaluru", " pune ", "", "Pune"] }))!.locations).toEqual(["Bengaluru", "Pune"]);
  });

  it("skips 'Remote' and prefers an Indian city for the job's city", () => {
    const job = toFeedJob(
      row({ location: ["Remote", "San Francisco", "Bengaluru"], workplace_type: "remote" }),
    );
    expect(job).toMatchObject({ city: "Bengaluru", state: "Karnataka", locations: ["San Francisco", "Bengaluru"] });
  });

  it("accepts a remote job with no location", () => {
    expect(toFeedJob(row({ location: [], workplace_type: "remote" }))?.workplace).toBe("remote");
  });
});

describe("loadFeedJobs", () => {
  it("returns nothing when no company opted in", async () => {
    const db = createSupabaseMock();
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
    db.queue("company_channel_settings", { data: [], error: null });
    expect(await loadFeedJobs("jooble")).toEqual([]);
    expect(db.callsFor("job_postings")).toHaveLength(0);
  });

  it("reads public jobs only, so a link-only job is never in a feed (JLT-062)", async () => {
    const db = createSupabaseMock();
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
    db.queue("company_channel_settings", { data: [{ company_id: "c1" }], error: null });
    db.queue("job_postings", { data: [], error: null });
    await loadFeedJobs("jooble");
    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["visibility", "public"] });
  });

  it("pages past 1000 jobs and drops opted-out ones", async () => {
    const db = createSupabaseMock();
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
    db.queue("company_channel_settings", { data: [{ company_id: "c1" }], error: null });
    const jobs = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => row({ job_id: `j${from + i}` }));
    db.queue("job_postings", { data: jobs(0, PAGE_SIZE), error: null });
    db.queue("job_postings", { data: jobs(PAGE_SIZE, 5), error: null });
    db.queue("job_channel_postings", { data: [{ job_id: "j0" }], error: null });
    db.queue("job_channel_postings", { data: [], error: null });
    db.queue("job_channel_postings", { data: [], error: null });
    const resolveLogoType = vi.fn(async () => "png" as const);
    const result = await loadFeedJobs("jooble", { resolveLogoType });
    expect(result).toHaveLength(PAGE_SIZE + 5 - 1);
    // One check per distinct logo, not per job.
    expect(resolveLogoType).toHaveBeenCalledTimes(1);
    expect(result[0].companyLogoType).toBe("png");
    expect(result.find((j) => j.id === "j0")).toBeUndefined();
  });
});

describe("loadFeedJobs: logos", () => {
  it("doesn't check logos for Adzuna, which takes none", async () => {
    const db = createSupabaseMock();
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
    db.queue("company_channel_settings", { data: [{ company_id: "c1" }], error: null });
    db.queue("job_postings", { data: [row()], error: null });
    db.queue("job_channel_postings", { data: [], error: null });
    const resolveLogoType = vi.fn(async () => "png" as const);
    await loadFeedJobs("adzuna", { resolveLogoType });
    expect(resolveLogoType).not.toHaveBeenCalled();
  });
});

describe("headLogoType", () => {
  it("reads the Content-Type and is null when the logo can't be fetched", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200, headers: { "content-type": "image/png" } }));
    expect(await headLogoType("https://x/logo")).toBe("png");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await headLogoType("https://x/logo")).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await headLogoType("https://x/logo")).toBeNull();
    fetchMock.mockRestore();
  });
});
