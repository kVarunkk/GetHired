import { describe, expect, it } from "vitest";
import { JOB_POST } from "@/test/utils/matching";
import { jobSnapshotHash } from "./job-snapshot";

const base = jobSnapshotHash(JOB_POST);

describe("jobSnapshotHash (MT-REQ-008)", () => {
  it("returns a stable hex digest", () => {
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(jobSnapshotHash({ ...JOB_POST })).toBe(base);
  });

  it("doesn't depend on key order", () => {
    const reordered = Object.fromEntries(Object.entries(JOB_POST).reverse()) as typeof JOB_POST;

    expect(jobSnapshotHash(reordered)).toBe(base);
  });

  it("ignores whitespace-only edits", () => {
    expect(
      jobSnapshotHash({
        ...JOB_POST,
        title: `  ${JOB_POST.title}  `,
        description: JOB_POST.description!.replace(/ /g, "  \n"),
        skills: JOB_POST.skills!.map((s) => ` ${s} `),
      }),
    ).toBe(base);
  });

  it("ignores skill order", () => {
    expect(jobSnapshotHash({ ...JOB_POST, skills: [...JOB_POST.skills!].reverse() })).toBe(base);
  });

  it.each([
    ["the title", { title: "Staff Frontend Engineer" }],
    ["the description", { description: "Something else entirely." }],
    ["a skill", { skills: ["React", "TypeScript", "Testing", "Remix"] }],
    ["a removed skill", { skills: ["React", "TypeScript", "Testing"] }],
    ["the minimum experience", { min_experience: 5 }],
    ["the maximum experience", { max_experience: 10 }],
  ])("changes when %s changes", (_label, change) => {
    expect(jobSnapshotHash({ ...JOB_POST, ...change })).not.toBe(base);
  });

  it.each([
    ["the salary", { min_salary: 1, max_salary: 2, salary_range: "1-2" }],
    ["the status", { status: "inactive" }],
    ["updated_at", { updated_at: "2030-01-01T00:00:00Z" }],
    ["the location", { location: ["bengaluru"] }],
    ["the derived experience label", { experience: "4-8 years" }],
  ])("doesn't change when %s changes", (_label, change) => {
    expect(jobSnapshotHash({ ...JOB_POST, ...change } as typeof JOB_POST)).toBe(base);
  });

  it("treats null and empty skills/description alike", () => {
    expect(jobSnapshotHash({ ...JOB_POST, skills: null, description: null })).toBe(
      jobSnapshotHash({ ...JOB_POST, skills: [], description: "" }),
    );
  });
});
