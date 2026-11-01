import { describe, expect, it } from "vitest";
import { resumeEmbeddingText, resumeSectionText } from "./resume-text";

const RESUME = {
  sections: [
    { type: "education", items: [{ bullets: [{ text: "BSc, 2018" }] }] },
    { type: "summary", items: [{ bullets: [{ text: "Backend engineer" }] }] },
    { type: "experience", items: [{ bullets: [{ text: "Built billing" }, { text: "Ran on-call" }] }] },
    { type: "skills", items: [{ bullets: [{ text: "Go" }] }, { bullets: [{ text: "SQL" }] }] },
  ],
};

describe("resume embedding text (CPT-030, CP-REQ-041)", () => {
  it("joins a section's bullets, N/A without a resume and empty without the section", () => {
    expect(resumeSectionText(RESUME, "experience")).toBe("Built billing. Ran on-call");
    expect(resumeSectionText(RESUME, "projects")).toBe("");
    expect(resumeSectionText(null, "experience")).toBe("N/A");
  });

  it("labels the summary, experience, projects and skills, leaving out the rest", () => {
    expect(resumeEmbeddingText(RESUME)).toBe(
      "SUMMARY: Backend engineer\nEXPERIENCE: Built billing. Ran on-call\nSKILLS: Go. SQL",
    );
    expect(resumeEmbeddingText(null)).toBe("");
    expect(resumeEmbeddingText({ sections: [] })).toBe("");
    expect(resumeEmbeddingText("not a resume")).toBe("");
  });
});
