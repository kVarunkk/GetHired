// Runs in jsdom (a .test.tsx file) on purpose: both modules are read by
// client components, so they must import nothing server-only (SMT-033).
import { describe, expect, it } from "vitest";
import {
  isMatchingInProgress,
  MATCHING_TIMEOUT_MS,
  RELEVANCE_PROFILES_MAX_RETRIES,
  RELEVANCE_PROFILES_VISIBILITY_TIMEOUT_S,
} from "./relevance-queue";
import {
  isRelevanceInProgress,
  ONBOARDING_MAX_RETRIES,
  ONBOARDING_VISIBILITY_TIMEOUT_S,
  RELEVANCE_JOBS_MAX_RETRIES,
  RELEVANCE_JOBS_VISIBILITY_TIMEOUT_S,
  RELEVANCE_TIMEOUT_MS,
} from "@/helpers/jobs/relevance-jobs-queue";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;

describe("the timeouts outlast every retry (SM-REQ-005)", () => {
  it("matching: longer than the relevant-profiles worker's retries", () => {
    expect(MATCHING_TIMEOUT_MS).toBeGreaterThan(
      RELEVANCE_PROFILES_MAX_RETRIES * RELEVANCE_PROFILES_VISIBILITY_TIMEOUT_S * 1000,
    );
  });

  it("relevance: longer than the retries of both pipelines that run it", () => {
    expect(RELEVANCE_TIMEOUT_MS).toBeGreaterThan(
      RELEVANCE_JOBS_MAX_RETRIES * RELEVANCE_JOBS_VISIBILITY_TIMEOUT_S * 1000,
    );
    expect(RELEVANCE_TIMEOUT_MS).toBeGreaterThan(ONBOARDING_MAX_RETRIES * ONBOARDING_VISIBILITY_TIMEOUT_S * 1000);
  });
});

describe("isMatchingInProgress", () => {
  const job = (matching_status: string, matching_started_at: string | null, updated_at: string | null = ago(0)) => ({
    matching_status,
    matching_started_at,
    updated_at,
  });

  it("is live for progress younger than the timeout, measured from the start", () => {
    expect(isMatchingInProgress(job("progress", ago(MATCHING_TIMEOUT_MS - MIN)), NOW)).toBe(true);
  });

  it("is dead once the start is older than the timeout, even after a fresh edit", () => {
    expect(isMatchingInProgress(job("progress", ago(MATCHING_TIMEOUT_MS + MIN), ago(0)), NOW)).toBe(false);
  });

  it("falls back to updated_at for a row from before the start column", () => {
    expect(isMatchingInProgress(job("progress", null, ago(MIN)), NOW)).toBe(true);
    expect(isMatchingInProgress(job("progress", null, ago(MATCHING_TIMEOUT_MS + MIN)), NOW)).toBe(false);
  });

  it("treats progress with no time at all as dead", () => {
    expect(isMatchingInProgress(job("progress", null, null), NOW)).toBe(false);
  });

  it.each(["pending", "completed", "failed"])("is never in progress when %s", (status) => {
    expect(isMatchingInProgress(job(status, ago(0)), NOW)).toBe(false);
  });
});

describe("isRelevanceInProgress", () => {
  const profile = (relevant_jobs_update_status: string, relevance_started_at: string | null, updated_at: string | null = ago(0)) => ({
    relevant_jobs_update_status,
    relevance_started_at,
    updated_at,
  });

  it("measures from the start, with the same fallback", () => {
    expect(isRelevanceInProgress(profile("progress", ago(MIN)), NOW)).toBe(true);
    expect(isRelevanceInProgress(profile("progress", ago(RELEVANCE_TIMEOUT_MS + MIN)), NOW)).toBe(false);
    expect(isRelevanceInProgress(profile("progress", null, ago(MIN)), NOW)).toBe(true);
    expect(isRelevanceInProgress(profile("completed", ago(0)), NOW)).toBe(false);
  });
});
