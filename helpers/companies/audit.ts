import { diffRole, describeGrantChange, describeLimitChange, toGrantMap, toLimits } from "./role-diff";

// RP-REQ-015: audit log entries as `list_company_audit` returns them, and how
// the audit page words them. Pure, no server-only imports.

export const AUDIT_ACTIONS = [
  "role.created",
  "role.updated",
  "role.deleted",
  "role.default_changed",
  "member.role_changed",
  "member.removed",
  "member.left",
  "owner.added",
  "owner.removed",
  "owner.primary_changed",
  "invite.created",
  "invite.revoked",
  "invite.accepted",
  "job.assigned",
  "job.unassigned",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The filter's action types: `list_company_audit` matches a prefix (`role` → `role.*`). */
export const AUDIT_ACTION_GROUP_VALUES = ["role", "member", "owner", "invite", "job"] as const;
export type AuditActionGroup = (typeof AUDIT_ACTION_GROUP_VALUES)[number];

export const AUDIT_ACTION_GROUP_LABEL: Record<AuditActionGroup, string> = {
  role: "Roles",
  member: "Members",
  owner: "Owners",
  invite: "Invites",
  job: "Hiring teams",
};

export const AUDIT_PAGE_SIZE = 50;

export type AuditEntry = {
  id: number;
  actorUserId: string | null;
  actorName: string | null;
  actorKind: "user" | "agent" | "system";
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
};

export type AuditFilters = {
  actor?: string | null;
  action?: AuditActionGroup | null;
  /** Inclusive start day, `YYYY-MM-DD`. */
  since?: string | null;
  /** Inclusive end day, `YYYY-MM-DD`. */
  until?: string | null;
};

type RawEntry = {
  id: number | string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_kind: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
};

export function toAuditEntry(raw: RawEntry): AuditEntry {
  return {
    id: Number(raw.id),
    actorUserId: raw.actor_user_id,
    actorName: raw.actor_name,
    actorKind: raw.actor_kind === "agent" || raw.actor_kind === "system" ? raw.actor_kind : "user",
    action: raw.action,
    targetType: raw.target_type,
    targetId: raw.target_id,
    targetLabel: raw.target_label,
    before: raw.before,
    after: raw.after,
    createdAt: raw.created_at,
  };
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const roleName = (v: unknown) => str(obj(obj(v).role).name);

/** "Priya Shah" or, when the actor has no name (or the system acted), a fallback. */
export function auditActorLabel(entry: AuditEntry): string {
  if (entry.actorKind === "system") return "GetHired";
  return entry.actorName ?? "A former member";
}

/**
 * What happened, after the actor's name ("changed Sam's role from Member to
 * Recruiter"), plus detail lines: the grant and limit diff for role edits.
 */
export function describeAuditEntry(entry: AuditEntry): { text: string; details: string[] } {
  const target = entry.targetLabel ?? "someone";
  const before = obj(entry.before);
  const after = obj(entry.after);
  const via = entry.actorKind === "agent" ? " with the recruiter agent" : "";

  switch (entry.action) {
    case "role.created": {
      const grants = toGrantMap(after.grants);
      return {
        text: `created the role ${target}${via}`,
        details: grants.size ? [`${grants.size} permission${grants.size === 1 ? "" : "s"}`] : [],
      };
    }
    case "role.updated": {
      const details: string[] = [];
      const fromName = str(before.name);
      const toName = str(after.name);
      if (fromName && toName && fromName !== toName) details.push(`Renamed from ${fromName} to ${toName}`);
      if (str(before.description) !== str(after.description)) details.push("Description changed");
      if (str(before.color) !== str(after.color) && after.color) details.push(`Colour changed to ${after.color}`);
      const diff = diffRole(
        { grants: toGrantMap(before.grants), limits: toLimits(before.limits) },
        { grants: toGrantMap(after.grants), limits: toLimits(after.limits) },
      );
      details.push(...diff.grants.map(describeGrantChange), ...diff.limits.map(describeLimitChange));
      return { text: `edited the role ${target}${via}`, details };
    }
    case "role.deleted": {
      const replacement = str(obj(after.replacement).name);
      const moved = typeof after.moved === "number" ? after.moved : 0;
      return {
        text: `deleted the role ${target}${via}`,
        details: replacement && moved > 0 ? [`${moved} moved to ${replacement}`] : [],
      };
    }
    case "role.default_changed": {
      const previous = str(before.name);
      return {
        text: `made ${target} the default role for invites${via}`,
        details: previous ? [`Was ${previous}`] : [],
      };
    }
    case "member.role_changed": {
      const from = roleName(before);
      const to = roleName(after);
      return {
        text: `changed ${target}'s role${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}${via}`,
        details: [],
      };
    }
    case "member.removed":
      return { text: `removed ${target} from the team${via}`, details: [] };
    case "member.left":
      return { text: "left the team", details: [] };
    case "owner.added":
      return { text: `made ${target} an owner${via}`, details: [] };
    case "owner.removed": {
      const to = roleName(after);
      return { text: `removed ${target} as an owner${via}`, details: to ? [`New role: ${to}`] : [] };
    }
    case "owner.primary_changed": {
      const previous = str(before.name);
      return {
        text: `made ${target} the primary owner${via}`,
        details: previous ? [`Was ${previous}`] : [],
      };
    }
    case "invite.created": {
      const role = roleName(after);
      return { text: `invited ${target}${role ? ` as ${role}` : ""}${via}`, details: [] };
    }
    case "invite.revoked":
      return { text: `revoked the invite for ${target}${via}`, details: [] };
    case "invite.accepted": {
      const role = roleName(after);
      return {
        text: `accepted the invite${role ? ` and joined as ${role}` : ""}`,
        details: after.fell_back === true ? ["The invite's role was deleted, so they got the default role"] : [],
      };
    }
    case "job.assigned": {
      const who = str(after.name) ?? "a member";
      if (after.creator === true) return { text: `added ${who} to the hiring team for ${target}`, details: ["They created the job"] };
      return { text: `added ${who} to the hiring team for ${target}${via}`, details: [] };
    }
    case "job.unassigned":
      return { text: `removed ${str(before.name) ?? "a member"} from the hiring team for ${target}${via}`, details: [] };
    default:
      return { text: `${entry.action.replace(/[._]/g, " ")} ${target}`.trim(), details: [] };
  }
}

/** The RPC's date bounds: `since` at the start of its day, `until` at the start of the next day. */
export function auditDateBounds(filters: Pick<AuditFilters, "since" | "until">) {
  const day = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const since = day(filters.since);
  const until = day(filters.until);
  let untilNext: string | null = null;
  if (until) {
    const d = new Date(`${until}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    untilNext = d.toISOString();
  }
  return { since: since ? `${since}T00:00:00.000Z` : null, until: untilNext };
}
