import { describe, expect, it } from "vitest";
import { addJobPath, myJobsPath, parseMyJobsTab, parseMyJobsView, trackedApplicationPath } from "./paths";

describe("myJobsPath", () => {
  it("leaves the defaults out of the URL", () => {
    expect(myJobsPath()).toBe("/my-jobs");
    expect(myJobsPath({ tab: "applications", view: "board" })).toBe("/my-jobs");
  });

  it("keeps the tab, view and search", () => {
    expect(myJobsPath({ tab: "saved" })).toBe("/my-jobs?tab=saved");
    expect(myJobsPath({ tab: "applications", view: "list", q: " acme " })).toBe("/my-jobs?view=list&q=acme");
  });

  it("has no view on the Saved tab", () => {
    expect(myJobsPath({ tab: "saved", view: "list" })).toBe("/my-jobs?tab=saved");
  });
});

describe("addJobPath", () => {
  it("starts as Applied unless it comes from Saved", () => {
    expect(addJobPath()).toBe("/my-jobs/add");
    expect(addJobPath("saved")).toBe("/my-jobs/add?status=saved");
  });
});

describe("trackedApplicationPath", () => {
  it("links a card's page", () => {
    expect(trackedApplicationPath("abc")).toBe("/my-jobs/applications/abc");
  });
});

describe("parsers", () => {
  it("default to Applications and Board", () => {
    expect(parseMyJobsTab(undefined)).toBe("applications");
    expect(parseMyJobsTab("junk")).toBe("applications");
    expect(parseMyJobsTab("saved")).toBe("saved");
    expect(parseMyJobsView(undefined)).toBe("board");
    expect(parseMyJobsView("list")).toBe("list");
  });
});
