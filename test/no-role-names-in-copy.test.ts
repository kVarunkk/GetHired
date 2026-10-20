import { describe, expect, it } from "vitest";
import { readSource, sourceFiles } from "@/test/utils/source";

// RP-RISK-005 / RPT-025: roles are the company's own, so copy names the
// permission that's missing ("Your role can't edit job posts."), never a role
// ("Only owners and admins…"). Allowed: the Admin template itself and the
// platform's own operator role, which has nothing to do with company roles.
const ALLOWED: Record<string, string> = {
  "helpers/companies/role-templates.ts": "the Admin template's key and name",
  "helpers/user/is-admin.ts": "the platform operator role (app_metadata.role)",
  "helpers/careers/slug.ts": "a reserved careers page address (/careers/admin), not copy",
  "app/api/updates/applicants/applications/route.tsx": "cron status for the platform operator",
  "app/api/updates/applicants/job-alert/route.tsx": "cron status for the platform operator",
  "app/api/updates/applicants/onboarding/route.tsx": "cron status for the platform operator",
};

const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

function roleNamesIn(source: string): string[] {
  const hits: string[] = [];
  for (const line of source.split("\n")) {
    const code = line.trimStart();
    if (/^(\/\/|\/\*|\*|import\b)/.test(code)) continue;
    for (const [, , text] of code.matchAll(LITERAL)) {
      if (/^(@\/|\.\.?\/)/.test(text)) continue; // module paths
      if (/\b[Aa]dmins?\b/.test(text)) hits.push(text);
    }
  }
  return hits;
}

describe("role names in copy", () => {
  it("no string literal names the Admin role outside the allowlist", () => {
    const offenders: Record<string, string[]> = {};
    for (const file of sourceFiles(["app", "helpers", "components"])) {
      if (file in ALLOWED) continue;
      const hits = roleNamesIn(readSource(file));
      if (hits.length) offenders[file] = hits;
    }
    expect(offenders).toEqual({});
  });

  it("the allowlist has no stale entries", () => {
    const stale = Object.keys(ALLOWED).filter((file) => roleNamesIn(readSource(file)).length === 0);
    expect(stale).toEqual([]);
  });

  it("finds role names in strings and skips comments and imports", () => {
    const source = [
      '// "Only admins" in a comment',
      'import { isAdmin } from "@/helpers/user/is-admin";',
      'const a = "Only owners and admins can do this.";',
      "const b = `Ask an Admin`;",
      'const c = "Your role can\'t edit job posts.";',
    ].join("\n");
    expect(roleNamesIn(source)).toEqual(["Only owners and admins can do this.", "Ask an Admin"]);
  });
});
