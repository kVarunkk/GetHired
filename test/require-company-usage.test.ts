import { describe, expect, it } from "vitest";
import { callsOf, readSource, sourceFiles } from "@/test/utils/source";

// RP-RISK-001 / RPT-020: every company action and route names a permission
// or `owner: true`. A bare `requireCompany()` checks membership only, so each
// one has to be listed here with the reason it's safe.
const MEMBERSHIP_ONLY: Record<string, string> = {
  "app/actions/cancel-company-plan.ts": "checks canManageBilling (owners) right after, with the billing message",
  "app/actions/change-company-plan.ts": "checks canManageBilling (owners) right after, with the billing message",
  "app/actions/resume-company-plan.ts": "checks canManageBilling (owners) right after, with the billing message",
  "app/actions/open-billing-portal.ts": "checks canManageBilling (owners) right after, with the billing message",
  "app/api/company/billing/checkout/route.ts": "checks canManageBilling (owners) right after, with the billing message",
  "app/actions/team/remove-member.ts": "leaving needs only membership; removing someone else checks team.remove",
  "app/actions/team/update-display-name.ts": "a member's own display name",
};

function bareCalls(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of sourceFiles(["app", "helpers", "components", "lib"])) {
    if (file === "helpers/companies/require-company.ts") continue;
    const source = readSource(file);
    const calls = [
      ...callsOf(source, "requireCompany"),
      ...callsOf(source, "requireCompanyForAction"),
    ];
    const bare = calls.filter((args) => !/\bpermission\s*:|\bowner\s*:\s*true/.test(args));
    if (bare.length) found[file] = bare.length;
  }
  return found;
}

describe("requireCompany usage", () => {
  it("every call names a permission or owner: true, outside the allowlist", () => {
    const offenders = Object.keys(bareCalls()).filter((file) => !(file in MEMBERSHIP_ONLY));
    expect(offenders).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    const found = bareCalls();
    const stale = Object.keys(MEMBERSHIP_ONLY).filter((file) => !(file in found));
    expect(stale).toEqual([]);
  });

  it("finds calls across lines and skips comments", () => {
    const source = [
      "// requireCompany() in a comment",
      "const a = await requireCompanyForAction(",
      '  { permission: "jobs.edit", jobId },',
      ");",
      "const b = await requireCompany();",
    ].join("\n");
    expect(callsOf(source, "requireCompanyForAction")).toEqual(['\n  { permission: "jobs.edit", jobId },\n']);
    expect(callsOf(source, "requireCompany")).toEqual([""]);
  });
});
