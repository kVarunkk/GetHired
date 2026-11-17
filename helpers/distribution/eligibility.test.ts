import { describe, expect, it } from "vitest";
import { checkEligibility, type EligibilityInput } from "./eligibility";

const good: EligibilityInput = {
  title: "Senior Backend Engineer",
  description: "Build and run backend services for our hiring platform. ".repeat(4),
  locations: ["bengaluru"],
  remote: false,
  applyUrl: "https://gethired.devhub.co.in/jobs/abc",
  companyName: "Acme",
  companyLogoUrl: "https://cdn.example.com/logo.png",
};

const codes = (input: Partial<EligibilityInput>) =>
  checkEligibility({ ...good, ...input }).reasons.map((r) => r.code);

describe("checkEligibility", () => {
  it("passes a complete job", () => {
    expect(checkEligibility(good)).toEqual({ eligible: true, reasons: [] });
  });
  it("requires a title", () => expect(codes({ title: "  " })).toContain("missing_title"));
  it("requires a minimum description", () =>
    expect(codes({ description: "too short" })).toContain("short_description"));
  it("requires a location unless remote", () => {
    expect(codes({ locations: [] })).toContain("missing_location");
    expect(codes({ locations: [], remote: true })).not.toContain("missing_location");
  });
  it("requires an apply url", () => expect(codes({ applyUrl: "" })).toContain("missing_apply_url"));
  it("requires a company name and logo", () => {
    expect(codes({ companyName: "" })).toContain("missing_company");
    expect(codes({ companyLogoUrl: null })).toContain("missing_logo");
  });
  it("rejects placeholder text", () => {
    expect(codes({ title: "Job title TBD" })).toContain("placeholder_text");
    expect(codes({ description: "Lorem ipsum ".repeat(20) })).toContain("placeholder_text");
  });
  it("rejects exclusionary wording", () =>
    expect(codes({ description: "We want a young unmarried candidate. ".repeat(5) })).toContain("fairness"));
  it("returns every reason, with copy naming the cause", () => {
    const r = checkEligibility({ ...good, title: "", locations: [] });
    expect(r.eligible).toBe(false);
    expect(r.reasons.map((x) => x.message)).toContain("Missing location");
  });
});
