import { describe, expect, it } from "vitest";
import { OWNED_ITEM_FIELDS } from "@/helpers/owned-items/owned-items";
import { readSource, sourceFiles } from "@/test/utils/source";

// JAT-051 (plan/job-alerts): the saved-search flow is gone. Alerts are written
// only through helpers/job-alerts, from the jobs page, Settings, the agent and MCP.
const REMOVED = [
  "BookmarkJobSearch",
  "AlertStatusSwitch",
  "JobsBookmarkTable",
  "JobsPageCommonSheet",
  "BookmarkAlertEmail",
  "toggleSearchBookmarkAction",
  "setBookmarkAlertAction",
  "canAlertOnUrl",
  "helpers/bookmarks",
  "actions/bookmarks",
  "BookmarkRow",
];

describe("the old bookmark flow is removed (JAT-051)", () => {
  it("no source file mentions a removed module", () => {
    const offenders: Record<string, string[]> = {};
    for (const file of sourceFiles(["app", "components", "helpers", "hooks", "lib", "utils", "emails"])) {
      if (file.endsWith("old-flow-removed.test.ts")) continue;
      const source = readSource(file);
      const hits = REMOVED.filter((name) => source.includes(name));
      if (hits.length) offenders[file] = hits;
    }
    expect(offenders).toEqual({});
  });

  it("a user can't rename or delete a bookmark through the owned-items actions", () => {
    expect(Object.keys(OWNED_ITEM_FIELDS)).not.toContain("bookmarks");
  });

  it("only helpers/job-alerts and the alert cron touch the bookmarks table", () => {
    const writers: string[] = [];
    for (const file of sourceFiles(["app", "components", "helpers", "hooks", "lib", "utils"])) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      if (/from\(\s*["']bookmarks["']\s*\)/.test(readSource(file))) writers.push(file);
    }
    expect(writers.sort()).toEqual(
      [
        "app/api/updates/applicants/job-alert/route.tsx",
        "helpers/job-alerts/create-alert.ts",
        "helpers/job-alerts/page-state.ts",
        "helpers/job-alerts/pause.ts",
        "helpers/job-alerts/preview.ts",
        "helpers/job-alerts/run-alert.ts",
        "helpers/job-alerts/writes.ts",
      ].sort(),
    );
  });
});
