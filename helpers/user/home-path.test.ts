import { describe, expect, it } from "vitest";
import { homePathFor } from "./home-path";

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
