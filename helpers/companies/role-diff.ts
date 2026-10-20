import {
  expandDependencies,
  isPermissionKey,
  PERMISSION_KEYS,
  permissionEntry,
  ROLE_LIMIT_KEYS,
  type PermissionGrant,
  type PermissionKey,
  type PermissionScope,
  type RoleLimits,
} from "./permissions";

// RP-REQ-032: what a role change does, for the agent's approval card and the
// audit log page. Pure, no server-only imports.

export type GrantChange =
  | { kind: "added"; key: PermissionKey; label: string; scope: PermissionScope }
  | { kind: "removed"; key: PermissionKey; label: string; scope: PermissionScope }
  | { kind: "scope"; key: PermissionKey; label: string; from: PermissionScope; to: PermissionScope };

export type LimitChange = { key: string; from: number | null; to: number | null };

export type RoleDiff = { grants: GrantChange[]; limits: LimitChange[] };

const label = (key: PermissionKey) => permissionEntry(key).label;

/** Reads grants from the RPC/audit shapes: `[{ key, scope }]` or `{ key: scope }`. */
export function toGrantMap(value: unknown): Map<PermissionKey, PermissionScope> {
  const out = new Map<PermissionKey, PermissionScope>();
  const put = (key: unknown, scope: unknown) => {
    if (isPermissionKey(key) && (scope === "all" || scope === "assigned")) out.set(key, scope);
  };
  if (Array.isArray(value)) {
    for (const g of value) if (g && typeof g === "object") put((g as PermissionGrant).key, (g as PermissionGrant).scope ?? "all");
  } else if (value && typeof value === "object") {
    for (const [key, scope] of Object.entries(value)) put(key, scope);
  }
  return out;
}

export function toLimits(value: unknown): RoleLimits {
  const out: RoleLimits = {};
  if (!value || typeof value !== "object") return out;
  for (const key of ROLE_LIMIT_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "number") out[key] = v;
  }
  return out;
}

/**
 * The difference between two grant sets and limit sets, in catalog order.
 * `after` grants get their dependencies first (the RPC adds them, RP-REQ-009),
 * so the card shows exactly what will be saved. A null `after` side means
 * unchanged.
 */
export function diffRole(
  before: { grants: Map<PermissionKey, PermissionScope>; limits: RoleLimits },
  after: { grants?: Map<PermissionKey, PermissionScope> | null; limits?: RoleLimits | null },
): RoleDiff {
  const grants: GrantChange[] = [];
  if (after.grants) {
    const next = expandDependencies([...after.grants].map(([key, scope]) => ({ key, scope })));
    for (const key of PERMISSION_KEYS) {
      const from = before.grants.get(key);
      const to = next.get(key);
      if (!from && to) grants.push({ kind: "added", key, label: label(key), scope: to });
      else if (from && !to) grants.push({ kind: "removed", key, label: label(key), scope: from });
      else if (from && to && from !== to) grants.push({ kind: "scope", key, label: label(key), from, to });
    }
  }
  const limits: LimitChange[] = [];
  if (after.limits) {
    for (const key of ROLE_LIMIT_KEYS) {
      const from = before.limits[key] ?? null;
      const to = after.limits[key] ?? null;
      if (from !== to) limits.push({ key, from, to });
    }
  }
  return { grants, limits };
}

const scopeText = (scope: PermissionScope) => (scope === "assigned" ? "assigned jobs" : "all jobs");

/** One line per change, for cards and the audit log. */
export function describeGrantChange(change: GrantChange): string {
  switch (change.kind) {
    case "added":
      return `+ ${change.label} (${scopeText(change.scope)})`;
    case "removed":
      return `− ${change.label}`;
    case "scope":
      return `${change.label}: ${scopeText(change.from)} → ${scopeText(change.to)}`;
  }
}

export function describeLimitChange(change: LimitChange): string {
  const what = change.key.replace(/_/g, " ");
  const n = (v: number | null) => (v === null ? "no limit" : `${v} a month`);
  return `${what}: ${n(change.from)} → ${n(change.to)}`;
}
