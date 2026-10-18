import {
  PERMISSION_CATALOG,
  canGrant,
  expandDependencies,
  type CompanyAccess,
  type PermissionGrant,
  type PermissionKey,
  type PermissionScope,
} from "./permissions";

// RP-REQ-005: read-only presets that prefill the role editor. Changing one
// never changes the roles created from it. Admin and Member are also what
// every company is seeded with (RP-REQ-004); the migration's seed function
// must list the same keys (permissions.test.ts checks it).

export type RoleTemplateKey =
  | "admin"
  | "member"
  | "recruiter"
  | "hiring_manager"
  | "interviewer"
  | "coordinator"
  | "finance";

export type RoleTemplate = {
  key: RoleTemplateKey;
  name: string;
  description: string;
  color: RoleColor;
  grants: PermissionGrant[];
};

/** RP-GUD-001: a fixed set of badge colours, each mapped to theme tokens in RoleBadge. */
export const ROLE_COLORS = ["slate", "indigo", "emerald", "amber", "rose", "sky", "violet", "teal"] as const;
export type RoleColor = (typeof ROLE_COLORS)[number];

const all = (keys: PermissionKey[]): PermissionGrant[] => keys.map((key) => ({ key, scope: "all" }));

const scoped = (keys: PermissionKey[], scope: PermissionScope): PermissionGrant[] =>
  keys.map((key) => ({ key, scope }));

/** RP-REQ-004: every permission except `company.profile` (owner-only before roles). */
export const ADMIN_KEYS: PermissionKey[] = PERMISSION_CATALOG.map((p) => p.key).filter(
  (k) => k !== "company.profile",
);

/** RP-REQ-004: what a member could do before roles. */
export const MEMBER_KEYS: PermissionKey[] = [
  "jobs.view",
  "applicants.view",
  "pipeline.move",
  "applicants.screen",
  "interviews.view",
  "notes.view",
  "notes.write",
  "talent.view",
  "talent.save",
  "talent_lists.manage",
  "matching.run",
  "outreach.view",
  "outreach.send",
  "agent.use",
  "team.view",
  "roles.view",
  "billing.view",
];

const JOB_SCOPED_KEYS: PermissionKey[] = PERMISSION_CATALOG.filter((p) => p.scopable).map((p) => p.key);

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "admin",
    name: "Admin",
    description: "Everything except billing management and owner changes.",
    color: "indigo",
    grants: all(ADMIN_KEYS),
  },
  {
    key: "member",
    name: "Member",
    description: "Works with applicants, talent and outreach across every job.",
    color: "slate",
    grants: all(MEMBER_KEYS),
  },
  {
    key: "recruiter",
    name: "Recruiter",
    description: "Runs hiring end to end: job posts, applicants, talent and outreach.",
    color: "emerald",
    grants: all([
      "jobs.view",
      "jobs.create",
      "jobs.edit",
      "jobs.publish",
      "applicants.view",
      "pipeline.move",
      "applicants.screen",
      "notes.view",
      "notes.write",
      "talent.view",
      "talent.save",
      "talent_lists.manage",
      "matching.run",
      "outreach.view",
      "outreach.send",
      "agent.use",
      "team.view",
      "roles.view",
    ]),
  },
  {
    key: "hiring_manager",
    name: "Hiring manager",
    description: "Manages their own jobs and those jobs' applicants only.",
    color: "amber",
    grants: [...scoped(JOB_SCOPED_KEYS, "assigned"), ...all(["jobs.create", "agent.use"])],
  },
  {
    key: "interviewer",
    name: "Interviewer",
    description: "Reads applicants and writes notes on the jobs they're assigned to.",
    color: "sky",
    grants: scoped(["jobs.view", "applicants.view", "notes.view", "notes.write"], "assigned"),
  },
  {
    key: "coordinator",
    name: "Coordinator",
    description: "Moves applicants and looks after email templates and scheduling.",
    color: "violet",
    grants: all([
      "jobs.view",
      "applicants.view",
      "pipeline.move",
      "notes.view",
      "settings.templates",
      "settings.scheduling",
      "team.view",
    ]),
  },
  {
    key: "finance",
    name: "Finance",
    description: "Sees the plan, usage and invoices, and who's on the team.",
    color: "teal",
    grants: all(["billing.view", "team.view"]),
  },
];

export function roleTemplate(key: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((t) => t.key === key);
}

/** A template's grants with every dependency added (RP-REQ-009). */
export function templateGrants(template: RoleTemplate) {
  return expandDependencies(template.grants);
}

/**
 * RP-REQ-012 rule 1: grants narrowed to what `actor` may give. A permission
 * the actor holds only for assigned jobs is offered at that scope; one they
 * don't hold is left out. Used to prefill the editor from a template or a
 * duplicated role.
 */
export function grantsWithinCeiling(actor: CompanyAccess, grants: PermissionGrant[]): PermissionGrant[] {
  const narrowed = grants.flatMap((g): PermissionGrant[] => {
    if (canGrant(actor, g.key, g.scope)) return [g];
    if (canGrant(actor, g.key, "assigned")) return [{ key: g.key, scope: "assigned" }];
    return [];
  });
  return [...expandDependencies(narrowed)].map(([key, scope]) => ({ key, scope }));
}
