import { describe, expect, it } from "vitest";
import { reviewRefreshInterval } from "./review-refresh";

describe("reviewRefreshInterval", () => {
  it("doesn't poll for an uploaded resume: it's parsed before the upload returns", () => {
    const data = { resume_id: "r1", resumes: { content: { sections: [] }, resume_path: null } };
    expect(reviewRefreshInterval(data, "idle")).toBe(0);
  });

  it("doesn't poll for a resume with no content and no file", () => {
    expect(reviewRefreshInterval({ resume_id: "r1", resumes: { content: null, resume_path: null } }, "idle")).toBe(0);
  });

  it("doesn't poll when nothing is linked", () => {
    expect(reviewRefreshInterval({ resume_id: null }, "idle")).toBe(0);
    expect(reviewRefreshInterval(null, "idle")).toBe(0);
  });

  it("polls an old resume whose file is still parsing in the background", () => {
    const data = { resume_id: "r1", resumes: { content: null, parsing_failed: false, resume_path: "resumes/u/a.pdf" } };
    expect(reviewRefreshInterval(data, "idle")).toBe(2000);
  });

  it("stops once an old resume's parse failed", () => {
    const data = { resume_id: "r1", resumes: { content: null, parsing_failed: true, resume_path: "resumes/u/a.pdf" } };
    expect(reviewRefreshInterval(data, "idle")).toBe(0);
  });

  it("polls during a retry and an analysis", () => {
    expect(reviewRefreshInterval({}, "triggering_parse")).toBe(2000);
    expect(reviewRefreshInterval({}, "triggering_analysis")).toBe(2000);
    expect(reviewRefreshInterval({ status: "processing" }, "idle")).toBe(2000);
  });
});
