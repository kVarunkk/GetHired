import { describe, expect, it } from "vitest";
import type { TJobIdPageData } from "@/utils/types/jobs.types";
import { buildJobPostingJsonLd, isLinkOnlyJob } from "./jsonld";

const job = (extra: Record<string, unknown> = {}) =>
  ({
    id: "d0000000-0000-4000-8000-000000000001",
    job_name: "Backend Engineer",
    company_name: "Acme",
    description: "Build and run the payments platform.",
    created_at: "2026-11-01T00:00:00Z",
    ...extra,
  }) as unknown as TJobIdPageData;

describe("buildJobPostingJsonLd totalJobOpenings (JLT-018, JL-REQ-011)", () => {
  it("carries a company job's openings", () => {
    expect(buildJobPostingJsonLd(job({ job_postings: [{ openings: 3 }] }))?.totalJobOpenings).toBe(3);
  });

  it("leaves it out for a scraped job with no posting", () => {
    expect(buildJobPostingJsonLd(job({ job_postings: [] }))).not.toHaveProperty("totalJobOpenings");
    expect(buildJobPostingJsonLd(job())).not.toHaveProperty("totalJobOpenings");
  });
});

describe("buildJobPostingJsonLd validThrough (JLT-043, JL-REQ-016)", () => {
  it("is the end of the closing date in the company's time zone", () => {
    const ld = buildJobPostingJsonLd(
      job({ job_postings: [{ openings: 1, closes_at: "2026-12-31", company_info: { time_zone: "Asia/Kolkata" } }] }),
    );
    expect(ld?.validThrough).toBe("2026-12-31T18:29:59.000Z");
  });

  it("reads UTC when the company has no time zone", () => {
    const ld = buildJobPostingJsonLd(job({ job_postings: [{ closes_at: "2026-12-31", company_info: { time_zone: null } }] }));
    expect(ld?.validThrough).toBe("2026-12-31T23:59:59.000Z");
  });

  it("is left out without a closing date or a posting", () => {
    expect(buildJobPostingJsonLd(job({ job_postings: [{ closes_at: null }] }))).not.toHaveProperty("validThrough");
    expect(buildJobPostingJsonLd(job())).not.toHaveProperty("validThrough");
  });
});

describe("link-only jobs (JLT-063, JL-REQ-025)", () => {
  it("builds no structured data for a link-only job", () => {
    expect(buildJobPostingJsonLd(job({ job_postings: [{ visibility: "link_only" }] }))).toBeNull();
  });

  it("keeps it for a public job", () => {
    expect(buildJobPostingJsonLd(job({ job_postings: [{ visibility: "public" }] }))).not.toBeNull();
  });

  it("isLinkOnlyJob reads the posting's visibility", () => {
    expect(isLinkOnlyJob(job({ job_postings: [{ visibility: "link_only" }] }))).toBe(true);
    expect(isLinkOnlyJob(job({ job_postings: [{ visibility: "public" }] }))).toBe(false);
    expect(isLinkOnlyJob(job())).toBe(false);
  });
});
