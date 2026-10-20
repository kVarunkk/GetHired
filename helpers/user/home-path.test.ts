import { describe, expect, it } from "vitest";
import { companyOnboardingPath, homePathFor, safeReturnPath } from "./home-path";

describe("homePathFor", () => {
  it("sends applicants to the agent", () => {
    expect(homePathFor({ type: "applicant" })).toBe("/agent");
  });

  it("sends companies to the company dashboard", () => {
    expect(homePathFor({ type: "company" })).toBe("/company");
  });

  it("treats a user without a role yet as an applicant", () => {
    expect(homePathFor({})).toBe("/agent");
    expect(homePathFor(undefined)).toBe("/agent");
  });
});

describe("safeReturnPath", () => {
  it("keeps paths on this site, query included", () => {
    expect(safeReturnPath("/company/agent")).toBe("/company/agent");
    expect(safeReturnPath("/jobs/1?apply=true")).toBe("/jobs/1?apply=true");
  });

  it("refuses anything that could leave the site", () => {
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(["/agent"])).toBeNull();
  });
});

describe("companyOnboardingPath", () => {
  it("carries the return path", () => {
    expect(companyOnboardingPath("/company/agent")).toBe(
      "/get-started?company=true&returnTo=%2Fcompany%2Fagent",
    );
  });

  it("leaves it out for the dashboard, nothing, or an unsafe path", () => {
    expect(companyOnboardingPath("/company")).toBe("/get-started?company=true");
    expect(companyOnboardingPath(null)).toBe("/get-started?company=true");
    expect(companyOnboardingPath("//evil.example")).toBe("/get-started?company=true");
  });
});
