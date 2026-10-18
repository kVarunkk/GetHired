// The company permission catalog (plan/recruiter-roles/feature-recruiter-roles-spec.md, RP-REQ-001/002).
//
// One list, mirrored in the `company_permissions` table so SQL can check the
// same keys (RP-TEST-002 compares the two). Adding a permission means a new
// entry here, an `insert into company_permissions` migration and its check
// (RP-CON-004). Keys are never reused.
//
// No server-only imports: the role editor uses this file too.

export type PermissionScope = "all" | "assigned";

export type PermissionGroup =
  | "Jobs"
  | "Applicants"
  | "Talent"
  | "Outreach"
  | "Agent"
  | "Settings"
  | "Team"
  | "Billing";

type CatalogEntry = {
  key: string;
  group: PermissionGroup;
  label: string;
  description: string;
  /** Whether it can be granted for assigned jobs only (RP-DEC-004). */
  scopable: boolean;
  requires: readonly string[];
  /** Completes "Your role can't …" (RP-RISK-005: never names a role). */
  deny: string;
};

export const PERMISSION_CATALOG = [
  // Jobs
  {
    key: "jobs.view",
    group: "Jobs",
    label: "View job posts",
    description: "See job posts, their settings and the job dashboard.",
    scopable: true,
    requires: [],
    deny: "view job posts",
  },
  {
    key: "jobs.create",
    group: "Jobs",
    label: "Create job posts",
    description: "Create job posts. The creator is assigned to the new job automatically.",
    scopable: false,
    requires: ["jobs.view"],
    deny: "create job posts",
  },
  {
    key: "jobs.edit",
    group: "Jobs",
    label: "Edit job posts",
    description: "Edit job posts, including the screening config.",
    scopable: true,
    requires: ["jobs.view"],
    deny: "edit job posts",
  },
  {
    key: "jobs.publish",
    group: "Jobs",
    label: "Open, pause and close jobs",
    description: "Change a job post's status.",
    scopable: true,
    requires: ["jobs.view"],
    deny: "open, pause or close job posts",
  },
  {
    key: "jobs.delete",
    group: "Jobs",
    label: "Delete job posts",
    description: "Delete job posts.",
    scopable: true,
    requires: ["jobs.view"],
    deny: "delete job posts",
  },
  {
    key: "jobs.assign",
    group: "Jobs",
    label: "Manage hiring teams",
    description: "Assign and unassign team members on a job.",
    scopable: true,
    requires: ["jobs.view", "team.view"],
    deny: "change the hiring team",
  },
  // Applicants
  {
    key: "applicants.view",
    group: "Applicants",
    label: "View applicants",
    description:
      "See applicants, applications, resumes, screening results, the activity timeline and the funnel.",
    scopable: true,
    requires: ["jobs.view"],
    deny: "view applicants",
  },
  {
    key: "pipeline.move",
    group: "Applicants",
    label: "Move applicants",
    description: "Move applicants between stages, including the stage emails that sends.",
    scopable: true,
    requires: ["applicants.view"],
    deny: "move applicants",
  },
  {
    key: "applicants.screen",
    group: "Applicants",
    label: "Run AI screening",
    description: "Run and rerun AI screening. Spends screenings.",
    scopable: true,
    requires: ["applicants.view"],
    deny: "run AI screening",
  },
  {
    key: "notes.view",
    group: "Applicants",
    label: "Read notes",
    description: "Read notes and ratings. Notes without an application need all jobs.",
    scopable: true,
    requires: [],
    deny: "read notes",
  },
  {
    key: "notes.write",
    group: "Applicants",
    label: "Write notes",
    description: "Add notes and ratings, and edit or delete your own.",
    scopable: true,
    requires: ["notes.view"],
    deny: "write notes",
  },
  {
    key: "notes.manage",
    group: "Applicants",
    label: "Manage everyone's notes",
    description: "Edit or delete other people's notes.",
    scopable: true,
    requires: ["notes.write"],
    deny: "edit other people's notes",
  },
  // Talent
  {
    key: "talent.view",
    group: "Talent",
    label: "Browse talent",
    description: "Browse the talent pool and candidate profiles.",
    scopable: false,
    requires: [],
    deny: "browse the talent pool",
  },
  {
    key: "talent.save",
    group: "Talent",
    label: "Save candidates",
    description: "Save and unsave candidates.",
    scopable: false,
    requires: ["talent.view"],
    deny: "save candidates",
  },
  {
    key: "talent_lists.manage",
    group: "Talent",
    label: "Manage talent lists",
    description: "Create, rename and delete talent lists, and add or remove candidates.",
    scopable: false,
    requires: ["talent.view"],
    deny: "manage talent lists",
  },
  {
    key: "matching.run",
    group: "Talent",
    label: "Run matching",
    description: "Run matching for a job, see matches and match explanations. Spends match explanations.",
    scopable: true,
    requires: ["jobs.view", "talent.view"],
    deny: "run matching",
  },
  // Outreach
  {
    key: "outreach.view",
    group: "Outreach",
    label: "View outreach",
    description: "See the company's outreach and replies. Outreach without a job needs all jobs.",
    scopable: true,
    requires: ["talent.view"],
    deny: "view outreach",
  },
  {
    key: "outreach.send",
    group: "Outreach",
    label: "Send outreach",
    description: "Draft and send invite-to-apply messages. Spends outreach.",
    scopable: true,
    requires: ["outreach.view"],
    deny: "send outreach",
  },
  {
    key: "outreach.withdraw",
    group: "Outreach",
    label: "Withdraw anyone's outreach",
    description: "Withdraw outreach sent by others. Senders can always withdraw their own.",
    scopable: true,
    requires: ["outreach.view"],
    deny: "withdraw other people's outreach",
  },
  // Agent
  {
    key: "agent.use",
    group: "Agent",
    label: "Use the recruiter agent",
    description: "Chat with the recruiter agent. Spends agent messages. Its tools follow the other permissions.",
    scopable: false,
    requires: [],
    deny: "use the recruiter agent",
  },
  // Settings
  {
    key: "settings.stages",
    group: "Settings",
    label: "Edit pipeline stages",
    description: "Add, rename, reorder and archive pipeline stages.",
    scopable: false,
    requires: [],
    deny: "edit pipeline stages",
  },
  {
    key: "settings.templates",
    group: "Settings",
    label: "Edit email templates",
    description: "Create, edit and delete email templates.",
    scopable: false,
    requires: [],
    deny: "edit email templates",
  },
  {
    key: "settings.scheduling",
    group: "Settings",
    label: "Set the scheduling link",
    description: "Set the scheduling link used in stage emails.",
    scopable: false,
    requires: [],
    deny: "change the scheduling link",
  },
  {
    key: "settings.notifications",
    group: "Settings",
    label: "Change notifications",
    description: "Change the company's notification settings.",
    scopable: false,
    requires: [],
    deny: "change notification settings",
  },
  {
    key: "careers.edit",
    group: "Settings",
    label: "Edit the careers page",
    description: "Claim the careers page address, edit its branding and sections, and publish it.",
    scopable: false,
    requires: [],
    deny: "edit the careers page",
  },
  {
    key: "question_sets.manage",
    group: "Settings",
    label: "Manage question sets",
    description: "Save, rename and delete reusable application question sets. Anyone who edits a job can apply one.",
    scopable: false,
    requires: ["jobs.view"],
    deny: "manage question sets",
  },
  {
    key: "company.profile",
    group: "Settings",
    label: "Edit the company profile",
    description: "Edit the company's name, logo, website and description.",
    scopable: false,
    requires: [],
    deny: "edit the company profile",
  },
  // Team
  {
    key: "team.view",
    group: "Team",
    label: "View the team",
    description: "See members, their roles and pending invites.",
    scopable: false,
    requires: [],
    deny: "view the team",
  },
  {
    key: "team.invite",
    group: "Team",
    label: "Invite people",
    description: "Invite people with a role, resend and revoke invites.",
    scopable: false,
    requires: ["team.view"],
    deny: "invite people",
  },
  {
    key: "team.remove",
    group: "Team",
    label: "Remove members",
    description: "Remove members from the company.",
    scopable: false,
    requires: ["team.view"],
    deny: "remove members",
  },
  {
    key: "team.assign_roles",
    group: "Team",
    label: "Change members' roles",
    description: "Change a member's role.",
    scopable: false,
    requires: ["team.view", "roles.view"],
    deny: "change members' roles",
  },
  {
    key: "roles.view",
    group: "Team",
    label: "View roles",
    description: "See the roles and what each one allows.",
    scopable: false,
    requires: [],
    deny: "view roles",
  },
  {
    key: "roles.manage",
    group: "Team",
    label: "Manage roles",
    description: "Create, edit, duplicate and delete roles, and set their usage limits.",
    scopable: false,
    requires: ["roles.view"],
    deny: "manage roles",
  },
  {
    key: "audit.view",
    group: "Team",
    label: "Read the audit log",
    description: "See who changed roles, members, owners and job assignments.",
    scopable: false,
    requires: ["team.view"],
    deny: "read the audit log",
  },
  // Billing
  {
    key: "billing.view",
    group: "Billing",
    label: "View billing",
    description: "See the plan, usage, credits and invoices (read only).",
    scopable: false,
    requires: [],
    deny: "view billing",
  },
] as const satisfies readonly CatalogEntry[];

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];
export type PermissionEntry = (typeof PERMISSION_CATALOG)[number];

export const PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key) as PermissionKey[];

export const PERMISSION_GROUPS: PermissionGroup[] = [
  "Jobs",
  "Applicants",
  "Talent",
  "Outreach",
  "Agent",
  "Settings",
  "Team",
  "Billing",
];

const BY_KEY = new Map<string, PermissionEntry>(PERMISSION_CATALOG.map((p) => [p.key, p]));

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && BY_KEY.has(value);
}

export function permissionEntry(key: PermissionKey): PermissionEntry {
  return BY_KEY.get(key)!;
}

export function isScopable(key: PermissionKey): boolean {
  return permissionEntry(key).scopable;
}

/** The allowance keys a role can cap per member (RP-REQ-040). */
export const ROLE_LIMIT_KEYS = [
  "screenings",
  "outreach",
  "agent_messages",
  "match_explanations",
  "interview_minutes",
] as const;
export type RoleLimitKey = (typeof ROLE_LIMIT_KEYS)[number];

export type PermissionGrant = { key: PermissionKey; scope: PermissionScope };
export type Grants = ReadonlyMap<PermissionKey, PermissionScope>;
export type RoleLimits = Partial<Record<RoleLimitKey, number>>;

/**
 * What the session user may do in their company (RP-SEC-001), loaded per
 * request from `my_company_access()` (RP-SEC-004). Owners have everything.
 */
export type CompanyAccess = {
  isOwner: boolean;
  grants: Grants;
  assignedJobIds: ReadonlySet<string>;
  /** The role's monthly per-member caps; owners have none (RP-REQ-040). */
  limits: RoleLimits;
};

const SCOPE_RANK: Record<PermissionScope, number> = { assigned: 1, all: 2 };

export function widerScope(a: PermissionScope | undefined, b: PermissionScope): PermissionScope {
  if (!a) return b;
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/**
 * RP-REQ-009: adds every `requires` dependency, recursively. A dependency gets
 * the wider of what it already has and what its dependent needs; a
 * non-scopable dependency is always `all`. A scopable dependency of a
 * non-scopable key (`jobs.create` → `jobs.view`) only needs `assigned`: the
 * creator is assigned to what they create (RP-REQ-011). A non-scopable key
 * asked at `assigned` is widened to `all`. Mirrors `expand_role_grants`.
 */
export function expandDependencies(grants: Iterable<PermissionGrant>): Map<PermissionKey, PermissionScope> {
  const out = new Map<PermissionKey, PermissionScope>();
  const add = (key: PermissionKey, scope: PermissionScope) => {
    const effective: PermissionScope = isScopable(key) ? scope : "all";
    const before = out.get(key);
    const next = widerScope(before, effective);
    if (before === next) return;
    out.set(key, next);
    const depScope: PermissionScope = isScopable(key) ? next : "assigned";
    for (const dep of permissionEntry(key).requires as readonly PermissionKey[]) add(dep, depScope);
  };
  for (const g of grants) add(g.key, g.scope);
  return out;
}

/** Which granted keys pulled `key` in as a dependency ("Needed by …"). */
export function dependentsOf(key: PermissionKey, grants: Grants): PermissionKey[] {
  return PERMISSION_KEYS.filter(
    (k) => k !== key && grants.has(k) && (permissionEntry(k).requires as readonly string[]).includes(key),
  );
}

/**
 * RP-SEC-001's TS check. Owners → true. `all` → true with or without a job.
 * `assigned` → only for one of the member's assigned jobs (false without a
 * job: rows without a job need `all`, RP-REQ-010). No grant → false.
 */
export function can(access: CompanyAccess | null | undefined, key: PermissionKey, jobId?: string | null): boolean {
  if (!access) return false;
  if (access.isOwner) return true;
  const scope = access.grants.get(key);
  if (scope === "all") return true;
  if (scope === "assigned") return Boolean(jobId) && access.assignedJobIds.has(jobId!);
  return false;
}

/**
 * Whether the user holds `key` at any scope: for showing a page or a control
 * whose rows RLS then filters (lists, the agent's tool set, RP-REQ-030).
 */
export function canAny(access: CompanyAccess | null | undefined, key: PermissionKey): boolean {
  if (!access) return false;
  return access.isOwner || access.grants.has(key);
}

/** RP-REQ-012 rule 1: you can grant `key` at `scope` only if you hold it at that scope or wider. */
export function canGrant(actor: CompanyAccess, key: PermissionKey, scope: PermissionScope): boolean {
  if (actor.isOwner) return true;
  const held = actor.grants.get(key);
  if (!held) return false;
  return SCOPE_RANK[held] >= SCOPE_RANK[scope];
}

/**
 * RP-REQ-012 rules 1–4: every grant (and every limit) is within what the actor
 * holds. Limits: a cap above the actor's own cap for that key is over the
 * ceiling; with no cap of their own, any cap is fine.
 */
export function isWithinCeiling(
  actor: CompanyAccess,
  grants: Iterable<PermissionGrant> | Grants,
  limits: RoleLimits = {},
): boolean {
  if (actor.isOwner) return true;
  const list: PermissionGrant[] =
    grants instanceof Map
      ? [...grants].map(([key, scope]) => ({ key, scope }))
      : [...(grants as Iterable<PermissionGrant>)];
  if (!list.every((g) => canGrant(actor, g.key, g.scope))) return false;
  return (Object.entries(limits) as [RoleLimitKey, number | undefined][]).every(([key, amount]) => {
    if (amount === undefined) return true;
    const own = actor.limits[key];
    return own === undefined || amount <= own;
  });
}

/** The 403 copy for a missing permission (RP-RISK-005: no role names). */
export function forbiddenMessage(key: PermissionKey, opts: { forJob?: boolean } = {}): string {
  return `Your role can't ${permissionEntry(key).deny}${opts.forJob ? " for this job" : ""}.`;
}

/** The message for an owner-only action (billing management, owners, RP-DEC-003). */
export const OWNER_ONLY_MESSAGE = "Only the company's owners can do this.";

/** Builds grants from a list, for templates and fixtures. */
export function grantsOf(entries: Iterable<PermissionGrant | PermissionKey>): Map<PermissionKey, PermissionScope> {
  return expandDependencies(
    [...entries].map((e) => (typeof e === "string" ? { key: e, scope: "all" as const } : e)),
  );
}

/** Grants as the RPCs take them: `[{ key, scope }]`, sorted by catalog order. */
export function grantList(grants: Grants): PermissionGrant[] {
  return PERMISSION_KEYS.filter((k) => grants.has(k)).map((key) => ({ key, scope: grants.get(key)! }));
}

/** RP-REQ-014: "14 permissions · assigned jobs only for 6", for the roles list and the editor. */
export function grantSummary(grants: readonly PermissionGrant[]): string {
  const assigned = grants.filter((g) => g.scope === "assigned").length;
  return `${grants.length} permission${grants.length === 1 ? "" : "s"}${assigned ? ` · assigned jobs only for ${assigned}` : ""}`;
}
