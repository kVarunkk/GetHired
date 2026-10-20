import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  can,
  canAny,
  canGrant,
  dependentsOf,
  expandDependencies,
  forbiddenMessage,
  grantSummary,
  isPermissionKey,
  isWithinCeiling,
  permissionEntry,
  type CompanyAccess,
  type PermissionKey,
  type PermissionScope,
} from "./permissions";
import {
  ADMIN_KEYS,
  MEMBER_KEYS,
  ROLE_TEMPLATES,
  grantsWithinCeiling,
  roleTemplate,
  templateGrants,
} from "./role-templates";

const JOB_1 = "d0000000-0000-4000-8000-000000000001";
const JOB_2 = "d0000000-0000-4000-8000-000000000002";

function access(
  grants: [PermissionKey, PermissionScope][] = [],
  opts: Partial<Omit<CompanyAccess, "grants">> = {},
): CompanyAccess {
  return {
    isOwner: false,
    grants: new Map(grants),
    assignedJobIds: new Set(),
    limits: {},
    ...opts,
  };
}

const MIGRATION = path.join(process.cwd(), "supabase/migrations/20261017160000_recruiter_roles.sql");

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

/** Every `insert into company_permissions` row across the migrations, later ones winning (upserts). */
function migrationCatalog() {
  const rows = new Map<string, { key: string; scopable: boolean; requires: string[] }>();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const [block] of sql.matchAll(/insert into public\.company_permissions[\s\S]*?;/g)) {
      for (const m of block.matchAll(/\('([a-z_.]+)',\s*(true|false),\s*'\{([^}]*)\}'\)/g)) {
        rows.set(m[1], {
          key: m[1],
          scopable: m[2] === "true",
          requires: m[3] ? m[3].split(",").map((x) => x.trim()) : [],
        });
      }
    }
  }
  return [...rows.values()];
}

/** The `array[...]` after `marker` in the latest migration that has it (later redefinitions win). */
function migrationArray(marker: string) {
  const file = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8").includes(marker))
    .at(-1);
  const sql = readFileSync(file ? path.join(MIGRATIONS_DIR, file) : MIGRATION, "utf8");
  const after = sql.slice(sql.indexOf(marker));
  const list = after.match(/array\[([\s\S]*?)\]/)?.[1] ?? "";
  return [...list.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
}

describe("the permission catalog (RP-TEST-002)", () => {
  it("has unique keys shaped <area>.<action>", () => {
    for (const key of PERMISSION_KEYS) expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("only requires real keys", () => {
    for (const p of PERMISSION_CATALOG) {
      for (const dep of p.requires) expect(isPermissionKey(dep), `${p.key} → ${dep}`).toBe(true);
    }
  });

  it("has no dependency cycles", () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (key: PermissionKey) => {
      if (done.has(key)) return;
      expect(visiting.has(key), `cycle through ${key}`).toBe(false);
      visiting.add(key);
      for (const dep of permissionEntry(key).requires as readonly PermissionKey[]) visit(dep);
      visiting.delete(key);
      done.add(key);
    };
    PERMISSION_KEYS.forEach(visit);
  });

  it("matches the company_permissions rows in the migration", () => {
    const rows = migrationCatalog();
    expect(rows.map((r) => r.key).sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const row of rows) {
      const entry = permissionEntry(row.key as PermissionKey);
      expect({ key: row.key, scopable: row.scopable, requires: [...row.requires].sort() }).toEqual({
        key: entry.key,
        scopable: entry.scopable,
        requires: [...entry.requires].sort(),
      });
    }
  });

  it("seeds the same Member keys in SQL as the template (RP-REQ-004)", () => {
    expect(migrationArray("-- @member-keys").sort()).toEqual([...MEMBER_KEYS].sort());
  });

  it("names no role in its copy (RP-RISK-005)", () => {
    for (const p of PERMISSION_CATALOG) {
      expect(`${p.label} ${p.description} ${p.deny}`).not.toMatch(/\badmins?\b/i);
    }
  });
});

describe("expandDependencies (RP-REQ-009)", () => {
  it("adds dependencies recursively at the dependent's scope", () => {
    expect(expandDependencies([{ key: "jobs.edit", scope: "assigned" }])).toEqual(
      new Map([
        ["jobs.edit", "assigned"],
        ["jobs.view", "assigned"],
      ]),
    );
    expect(expandDependencies([{ key: "jobs.edit", scope: "all" }]).get("jobs.view")).toBe("all");
    expect(expandDependencies([{ key: "notes.manage", scope: "assigned" }])).toEqual(
      new Map([
        ["notes.manage", "assigned"],
        ["notes.write", "assigned"],
        ["notes.view", "assigned"],
      ]),
    );
  });

  it("keeps a wider grant that already exists", () => {
    const out = expandDependencies([
      { key: "jobs.view", scope: "all" },
      { key: "jobs.edit", scope: "assigned" },
    ]);
    expect(out.get("jobs.view")).toBe("all");
    expect(out.get("jobs.edit")).toBe("assigned");
  });

  it("widens an existing narrower dependency", () => {
    const out = expandDependencies([
      { key: "jobs.view", scope: "assigned" },
      { key: "jobs.edit", scope: "all" },
    ]);
    expect(out.get("jobs.view")).toBe("all");
  });

  it("gives non-scopable keys and dependencies scope all", () => {
    expect(expandDependencies([{ key: "talent.view", scope: "assigned" }]).get("talent.view")).toBe("all");
    const out = expandDependencies([{ key: "jobs.assign", scope: "assigned" }]);
    expect(out.get("team.view")).toBe("all");
    expect(out.get("jobs.view")).toBe("assigned");
  });

  it("gives a non-scopable key's scopable dependency only assigned (RP-REQ-011)", () => {
    const out = expandDependencies([{ key: "jobs.create", scope: "all" }]);
    expect(out.get("jobs.create")).toBe("all");
    expect(out.get("jobs.view")).toBe("assigned");
    // An explicit wider grant wins.
    expect(
      expandDependencies([
        { key: "jobs.create", scope: "all" },
        { key: "jobs.view", scope: "all" },
      ]).get("jobs.view"),
    ).toBe("all");
  });

  it("names what pulled a key in", () => {
    const grants = expandDependencies([
      { key: "jobs.edit", scope: "all" },
      { key: "jobs.publish", scope: "all" },
    ]);
    expect(dependentsOf("jobs.view", grants)).toEqual(["jobs.edit", "jobs.publish"]);
    expect(dependentsOf("jobs.edit", grants)).toEqual([]);
  });
});

describe("can (RP-TEST-003)", () => {
  it("lets an owner do everything", () => {
    const owner = access([], { isOwner: true });
    for (const key of PERMISSION_KEYS) {
      expect(can(owner, key)).toBe(true);
      expect(can(owner, key, JOB_2)).toBe(true);
    }
  });

  it("allows scope all with or without a job", () => {
    const a = access([["applicants.view", "all"]]);
    expect(can(a, "applicants.view")).toBe(true);
    expect(can(a, "applicants.view", JOB_1)).toBe(true);
  });

  it("allows scope assigned only for an assigned job", () => {
    const a = access([["applicants.view", "assigned"]], { assignedJobIds: new Set([JOB_1]) });
    expect(can(a, "applicants.view", JOB_1)).toBe(true);
    expect(can(a, "applicants.view", JOB_2)).toBe(false);
    expect(can(a, "applicants.view")).toBe(false);
    expect(can(a, "applicants.view", null)).toBe(false);
  });

  it("refuses a missing grant, and no access at all", () => {
    expect(can(access([["jobs.view", "all"]]), "jobs.edit")).toBe(false);
    expect(can(null, "jobs.view")).toBe(false);
  });

  it("canAny: any scope", () => {
    expect(canAny(access([["applicants.view", "assigned"]]), "applicants.view")).toBe(true);
    expect(canAny(access(), "applicants.view")).toBe(false);
    expect(canAny(access([], { isOwner: true }), "billing.view")).toBe(true);
  });
});

describe("canGrant and isWithinCeiling (RP-REQ-012 rule 1)", () => {
  const actor = access(
    [
      ["jobs.view", "all"],
      ["applicants.view", "assigned"],
      ["roles.manage", "all"],
      ["roles.view", "all"],
    ],
    { limits: { outreach: 50 } },
  );

  it("grants only what the actor holds, at that scope or narrower", () => {
    expect(canGrant(actor, "jobs.view", "all")).toBe(true);
    expect(canGrant(actor, "jobs.view", "assigned")).toBe(true);
    expect(canGrant(actor, "applicants.view", "assigned")).toBe(true);
    expect(canGrant(actor, "applicants.view", "all")).toBe(false);
    expect(canGrant(actor, "billing.view", "all")).toBe(false);
  });

  it("lets an owner grant anything", () => {
    const owner = access([], { isOwner: true });
    expect(canGrant(owner, "billing.view", "all")).toBe(true);
    expect(isWithinCeiling(owner, [{ key: "jobs.delete", scope: "all" }], { outreach: 9999 })).toBe(true);
  });

  it("checks every grant", () => {
    expect(isWithinCeiling(actor, [{ key: "jobs.view", scope: "all" }])).toBe(true);
    expect(
      isWithinCeiling(actor, [
        { key: "jobs.view", scope: "all" },
        { key: "billing.view", scope: "all" },
      ]),
    ).toBe(false);
    expect(isWithinCeiling(actor, new Map([["applicants.view", "all"]]))).toBe(false);
  });

  it("caps limits at the actor's own", () => {
    expect(isWithinCeiling(actor, [], { outreach: 50 })).toBe(true);
    expect(isWithinCeiling(actor, [], { outreach: 51 })).toBe(false);
    // No cap of their own on screenings: any cap is within it.
    expect(isWithinCeiling(actor, [], { screenings: 1000 })).toBe(true);
  });
});

describe("screening interview keys (SIT-004)", () => {
  it("adds interviews.view and interviews.manage, both scopable to assigned jobs", () => {
    expect(isPermissionKey("interviews.view")).toBe(true);
    expect(isPermissionKey("interviews.manage")).toBe(true);
    expect(permissionEntry("interviews.view" as PermissionKey).scopable).toBe(true);
    expect(permissionEntry("interviews.manage" as PermissionKey).scopable).toBe(true);
  });

  it("view needs applicants.view, and manage needs view", () => {
    expect(permissionEntry("interviews.view" as PermissionKey).requires).toEqual(["applicants.view"]);
    expect(permissionEntry("interviews.manage" as PermissionKey).requires).toEqual(["interviews.view"]);
    const grants = expandDependencies([{ key: "interviews.manage" as PermissionKey, scope: "assigned" }]);
    expect(grants.get("interviews.view" as PermissionKey)).toBe("assigned");
    expect(grants.get("applicants.view")).toBe("assigned");
    expect(grants.get("jobs.view")).toBe("assigned");
  });

  it("is in the Applicants group", () => {
    expect(permissionEntry("interviews.view" as PermissionKey).group).toBe("Applicants");
    expect(permissionEntry("interviews.manage" as PermissionKey).group).toBe("Applicants");
  });

  it("names the missing permission in the 403 copy", () => {
    expect(forbiddenMessage("interviews.view" as PermissionKey)).toBe(
      "Your role can't view AI interviews.",
    );
    expect(forbiddenMessage("interviews.manage" as PermissionKey, { forJob: true })).toBe(
      "Your role can't manage AI interviews for this job.",
    );
  });

  it("gives Admin both and Member only interviews.view", () => {
    const admin = templateGrants(roleTemplate("admin")!);
    const member = templateGrants(roleTemplate("member")!);
    expect(admin.get("interviews.view" as PermissionKey)).toBe("all");
    expect(admin.get("interviews.manage" as PermissionKey)).toBe("all");
    expect(member.get("interviews.view" as PermissionKey)).toBe("all");
    expect(member.has("interviews.manage" as PermissionKey)).toBe(false);
  });
});

describe("forbiddenMessage", () => {
  it("comes from the catalog", () => {
    expect(forbiddenMessage("jobs.edit")).toBe("Your role can't edit job posts.");
    expect(forbiddenMessage("applicants.view", { forJob: true })).toBe(
      "Your role can't view applicants for this job.",
    );
  });
});

describe("role templates (RP-REQ-005)", () => {
  it("each expands to a valid, closed grant set", () => {
    for (const t of ROLE_TEMPLATES) {
      const grants = templateGrants(t);
      for (const [key, scope] of grants) {
        expect(isPermissionKey(key)).toBe(true);
        if (!permissionEntry(key).scopable) expect(scope, `${t.key}: ${key}`).toBe("all");
      }
      // Expanding again changes nothing.
      expect(expandDependencies([...grants].map(([key, scope]) => ({ key, scope })))).toEqual(grants);
    }
  });

  it("Admin and Member equal RP-REQ-004 exactly, at scope all", () => {
    const admin = templateGrants(roleTemplate("admin")!);
    const member = templateGrants(roleTemplate("member")!);
    expect([...admin.keys()].sort()).toEqual([...ADMIN_KEYS].sort());
    expect([...member.keys()].sort()).toEqual([...MEMBER_KEYS].sort());
    expect(new Set([...admin.values(), ...member.values()])).toEqual(new Set(["all"]));
    expect(admin.has("company.profile")).toBe(false);
    expect(admin.has("billing.view")).toBe(true);
  });

  it("scopes the Hiring manager's job permissions to assigned jobs", () => {
    const hm = templateGrants(roleTemplate("hiring_manager")!);
    expect(hm.get("applicants.view")).toBe("assigned");
    expect(hm.get("jobs.edit")).toBe("assigned");
    expect(hm.get("jobs.create")).toBe("all");
    expect(hm.get("jobs.view")).toBe("assigned");
    expect(hm.has("billing.view")).toBe(false);
  });

  it("gives the Interviewer only notes on top of reading applicants", () => {
    const i = templateGrants(roleTemplate("interviewer")!);
    expect([...i.keys()].sort()).toEqual(["applicants.view", "jobs.view", "notes.view", "notes.write"]);
  });
});

describe("grantsWithinCeiling (RP-REQ-012 rule 1, prefilling the editor)", () => {
  it("keeps everything for an owner", () => {
    const grants = roleTemplate("admin")!.grants;
    expect(grantsWithinCeiling(access([], { isOwner: true }), grants)).toHaveLength(templateGrants(roleTemplate("admin")!).size);
  });

  it("drops what the actor doesn't hold and narrows what they hold only for assigned jobs", () => {
    const actor = access([
      ["jobs.view", "assigned"],
      ["applicants.view", "assigned"],
      ["notes.view", "all"],
    ]);
    const result = grantsWithinCeiling(actor, [
      { key: "applicants.view", scope: "all" },
      { key: "notes.view", scope: "all" },
      { key: "billing.view", scope: "all" },
    ]);
    expect(new Map(result.map((g) => [g.key, g.scope]))).toEqual(
      new Map([
        ["jobs.view", "assigned"],
        ["applicants.view", "assigned"],
        ["notes.view", "all"],
      ]),
    );
  });
});

describe("grantSummary (RP-REQ-014)", () => {
  it("counts permissions and the assigned-only ones", () => {
    expect(grantSummary([])).toBe("0 permissions");
    expect(grantSummary([{ key: "jobs.view", scope: "all" }])).toBe("1 permission");
    expect(
      grantSummary([
        { key: "jobs.view", scope: "assigned" },
        { key: "notes.view", scope: "all" },
      ]),
    ).toBe("2 permissions · assigned jobs only for 1");
  });
});
