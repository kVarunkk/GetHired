import { describe, expect, it } from "vitest";
import { freeFormInputSchema, isBoardJobInput, noteSchema, trackedInputSchema, trackedUpdateSchema } from "./schema";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("trackedInputSchema", () => {
  it("reads a board job by id, defaulting to applied", () => {
    const input = trackedInputSchema.parse({ allJobsId: ID });
    expect(isBoardJobInput(input)).toBe(true);
    expect(input.status).toBe("applied");
  });

  it("reads a free-form job, trimming text and blanks to null", () => {
    const input = trackedInputSchema.parse({
      jobTitle: "  Frontend\n Engineer ",
      companyName: "Acme",
      jobUrl: " ",
      location: "",
      status: "saved",
    });
    expect(input).toMatchObject({ jobTitle: "Frontend Engineer", companyName: "Acme", jobUrl: null, location: null, status: "saved" });
  });

  it("strips control characters", () => {
    expect(freeFormInputSchema.parse({ jobTitle: "Dev\u0000\u0007ops", companyName: "A\u009Fcme" })).toMatchObject({
      jobTitle: "Devops",
      companyName: "Acme",
    });
  });

  it("drops unknown keys instead of passing them on", () => {
    const input = trackedInputSchema.parse({ jobTitle: "Dev", companyName: "Acme", user_id: "someone", source: "migrated" });
    expect(input).not.toHaveProperty("user_id");
    expect(input).not.toHaveProperty("source");
  });

  it.each([
    [{ jobTitle: "", companyName: "Acme" }, "Job title is required."],
    [{ jobTitle: "x".repeat(201), companyName: "Acme" }, "Job title is at most 200 characters."],
    [{ jobTitle: "Dev", companyName: "x".repeat(201) }, "Company is at most 200 characters."],
    [{ jobTitle: "Dev", companyName: "Acme", location: "x".repeat(201) }, "Location is at most 200 characters."],
    [{ jobTitle: "Dev", companyName: "Acme", notes: "x".repeat(5001) }, "Notes are at most 5000 characters."],
    [{ jobTitle: "Dev", companyName: "Acme", jobUrl: "http://acme.com/1" }, "Only https links can be tracked."],
    [{ jobTitle: "Dev", companyName: "Acme", jobUrl: `https://a.com/${"x".repeat(2048)}` }, "That link is too long."],
    [{ jobTitle: "Dev", companyName: "Acme", appliedAt: "24/11/2026" }, "Use a date like 2026-11-24."],
    [{ jobTitle: "Dev", companyName: "Acme", status: "submitted" }, undefined],
  ])("refuses %o", (raw, message) => {
    const result = freeFormInputSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (message && !result.success) expect(result.error.issues[0].message).toBe(message);
  });
});

describe("trackedUpdateSchema", () => {
  it("accepts a partial edit", () => {
    expect(trackedUpdateSchema.parse({ notes: "Called HR" })).toEqual({ notes: "Called HR" });
  });

  it("takes currency codes and refuses symbols", () => {
    expect(trackedUpdateSchema.parse({ salaryCurrency: "inr" }).salaryCurrency).toBe("INR");
    expect(trackedUpdateSchema.safeParse({ salaryCurrency: "₹" }).success).toBe(false);
  });

  it("drops unknown keys", () => {
    expect(trackedUpdateSchema.parse({ notes: "x", status: "offer", user_id: "u2" })).toEqual({ notes: "x" });
  });
});

describe("noteSchema", () => {
  it("needs an application id and caps the notes", () => {
    expect(noteSchema.safeParse({ notes: "x" }).success).toBe(false);
    expect(noteSchema.safeParse({ applicationId: ID, notes: "x".repeat(5001) }).success).toBe(false);
    expect(noteSchema.parse({ applicationId: ID, notes: " Follow up " })).toEqual({
      applicationId: ID,
      notes: "Follow up",
      nextFollowUpAt: null,
    });
  });
});
