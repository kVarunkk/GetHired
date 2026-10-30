import { describe, expect, it } from "vitest";
import { SCREENABLE_MIN_FIELDS, hasScreenableDetail } from "./screenable";

const section = { type: "experience", items: [{ heading: "Engineer", bullets: [{ text: "Built things" }] }] };

describe("hasScreenableDetail (BI-REQ-036)", () => {
  it("needs two profile fields", () => {
    expect(SCREENABLE_MIN_FIELDS).toBe(2);
  });

  it("is true with a resume that has a section", () => {
    expect(hasScreenableDetail({ resume_content: { sections: [section] } })).toBe(true);
  });

  it("falls back to the fields when the resume has no sections", () => {
    expect(hasScreenableDetail({ resume_content: { sections: [] } })).toBe(false);
    expect(
      hasScreenableDetail({ resume_content: { sections: [] }, current_title: "Engineer", current_company: "Acme" }),
    ).toBe(true);
  });

  it("is true with exactly two of title, company, experience and skills", () => {
    expect(hasScreenableDetail({ current_title: "Engineer", skills: ["Go"] })).toBe(true);
    expect(hasScreenableDetail({ current_company: "Acme", experience_years: 3 })).toBe(true);
  });

  it("is false with one", () => {
    expect(hasScreenableDetail({ current_title: "Engineer" })).toBe(false);
    expect(hasScreenableDetail({ skills: ["Go", "Rust"] })).toBe(false);
  });

  it("counts zero years of experience", () => {
    expect(hasScreenableDetail({ current_title: "Graduate", experience_years: 0 })).toBe(true);
  });

  it("never counts tags or notes", () => {
    expect(hasScreenableDetail({ current_title: "Engineer", tags: ["referral"], notes: "Great" })).toBe(false);
  });

  it("doesn't count empty skills or blank text", () => {
    expect(hasScreenableDetail({ current_title: "Engineer", skills: [] })).toBe(false);
    expect(hasScreenableDetail({ current_title: "Engineer", current_company: "  " })).toBe(false);
    expect(hasScreenableDetail({ current_title: "Engineer", experience_years: null })).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(hasScreenableDetail({})).toBe(false);
  });
});
