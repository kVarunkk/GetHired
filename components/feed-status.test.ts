import { describe, expect, it } from "vitest";
import { MATCHING_TIMEOUT_MS } from "@/helpers/profiles/relevance-queue";
import { RELEVANCE_TIMEOUT_MS } from "@/helpers/jobs/relevance-jobs-queue";
import { jobsFeedView, profilesFeedView } from "./feed-status";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;

describe("jobsFeedView (SMT-036)", () => {
  const profile = (status: string, startedAgo: number | null = MIN) => ({
    relevant_jobs_update_status: status,
    relevance_started_at: startedAgo === null ? null : ago(startedAgo),
    updated_at: ago(0),
  });

  it.each([
    ["pending", null, "pending"],
    ["progress", MIN, "generating"],
    // A dead run shows the regenerate path instead of spinning forever.
    ["progress", RELEVANCE_TIMEOUT_MS + MIN, "failed"],
    ["failed", MIN, "failed"],
    ["completed", MIN, "generated"],
  ] as const)("%s (started %s ms ago) shows %s", (status, startedAgo, view) => {
    expect(jobsFeedView(profile(status, startedAgo), NOW)).toBe(view);
  });

  it("shows nothing generated while the profile hasn't loaded", () => {
    expect(jobsFeedView(undefined, NOW)).toBe("unknown");
  });
});

describe("profilesFeedView (SMT-036)", () => {
  const job = (status: string, startedAgo: number | null = MIN) => ({
    matching_status: status,
    matching_started_at: startedAgo === null ? null : ago(startedAgo),
    updated_at: ago(0),
  });

  it.each([
    ["pending", null, "pending"],
    ["progress", MIN, "generating"],
    ["progress", MATCHING_TIMEOUT_MS + MIN, "failed"],
    ["failed", MIN, "failed"],
    ["completed", MIN, "generated"],
  ] as const)("%s (started %s ms ago) shows %s", (status, startedAgo, view) => {
    expect(profilesFeedView(job(status, startedAgo), NOW)).toBe(view);
  });
});
