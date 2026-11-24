import { describe, expect, it } from "vitest";
import {
  alertReturnPath,
  applicantOnboardingPath,
  companyOnboardingPath,
  homePathFor,
  safeReturnPath,
} from "./home-path";

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

describe("alertReturnPath / applicantOnboardingPath (JAT-044)", () => {
  it("accepts only a jobs search carrying createAlert", () => {
    expect(alertReturnPath("/jobs?location=pune&createAlert=weekly")).toBe("/jobs?location=pune&createAlert=weekly");
    expect(alertReturnPath("/jobs?createAlert=daily")).toBe("/jobs?createAlert=daily");
    expect(alertReturnPath("/jobs?createAlert=monthly")).toBeNull();
    expect(alertReturnPath("/settings?createAlert=daily")).toBeNull();
    expect(alertReturnPath("//evil.com/jobs?createAlert=daily")).toBeNull();
    expect(alertReturnPath(undefined)).toBeNull();
  });

  it("carries the path through onboarding", () => {
    expect(applicantOnboardingPath("/jobs?a=1&createAlert=daily")).toBe(
      "/get-started?returnTo=%2Fjobs%3Fa%3D1%26createAlert%3Ddaily",
    );
  });
});
