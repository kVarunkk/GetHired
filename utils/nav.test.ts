import { describe, expect, it } from "vitest";
import { fullHeightPaths, getNavbarVairantByPath, getNavItemsByPath } from "./utils";
import { mockUser } from "@/test/utils/auth";

describe("Agent navigation (TASK-071)", () => {
  it("shows the Agent link to applicants", () => {
    const items = getNavItemsByPath("/jobs", false, mockUser({ type: "applicant" }));

    expect(items.find((item) => item.id === "agent")).toMatchObject({
      label: "Agent",
      href: "/agent",
      type: "startswith",
    });
  });

  it("gives /company/agent the full-height sidebar layout", () => {
    expect(getNavbarVairantByPath("/company/agent")).toBe("vertical");
    expect(fullHeightPaths.some((p) => "/company/agent".startsWith(p))).toBe(true);
  });

  it("shows the Agent link to company users, after Home (RA-REQ-009)", () => {
    const items = getNavItemsByPath("/company", true, mockUser({ type: "company" }));

    expect(items.map((item) => item.id).slice(0, 2)).toEqual(["home", "agent"]);
    expect(items.find((item) => item.id === "agent")).toMatchObject({
      label: "Agent",
      href: "/company/agent",
      type: "startswith",
    });
  });

  it("uses the sidebar layout on /agent", () => {
    expect(getNavbarVairantByPath("/agent")).toBe("vertical");
  });
});

describe("signed-out horizontal navbar", () => {
  it.each(["/", "/blog", "/auth/login"])("on %s leads with the agent and leaves out Features and Blog", (path) => {
    const ids = getNavItemsByPath(path, false, null).map((item) => item.id);

    expect(ids.filter((id) => id !== "home")[0]).toBe("agent");
    expect(ids).not.toContain("features");
    expect(ids).not.toContain("blog");
    expect(ids).toEqual(expect.arrayContaining(["jobs", "interview", "hire", "cvreview"]));
  });
});
