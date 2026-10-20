"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import StickyActionBar from "@/components/StickyActionBar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createRoleAction } from "@/app/actions/roles/create-role";
import { updateRoleAction } from "@/app/actions/roles/update-role";
import {
  canGrant,
  dependentsOf,
  expandDependencies,
  grantList,
  grantSummary,
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  permissionEntry,
  type CompanyAccess,
  type PermissionGrant,
  type PermissionKey,
  type PermissionScope,
  type RoleLimitKey,
  type RoleLimits as RoleLimitsValue,
} from "@/helpers/companies/permissions";
import {
  grantsWithinCeiling,
  ROLE_COLORS,
  ROLE_TEMPLATES,
  type RoleColor,
} from "@/helpers/companies/role-templates";
import { cn } from "@/utils/utils";
import RoleBadge from "./RoleBadge";
import RoleLimits from "./RoleLimits";
import { inviteWithRoleHref } from "@/helpers/team/invite-roles";

export type RoleEditorValues = {
  name: string;
  description: string;
  color: RoleColor;
  grants: PermissionGrant[];
  limits: RoleLimitsValue;
  templateKey?: string | null;
};

/** The viewer's own access, serialisable (RP-REQ-012 ceiling). */
export type EditorViewer = {
  isOwner: boolean;
  grants: PermissionGrant[];
  limits: RoleLimitsValue;
};

type Props = {
  mode: "create" | "edit";
  roleId?: string;
  initial: RoleEditorValues;
  viewer: EditorViewer;
  /** RP-REQ-014: with only roles.view, or a role above the viewer, nothing is editable. */
  readOnly?: boolean;
  /** RP-REQ-012 rule 5: the viewer's own role; name and description stay editable. */
  ownRole?: boolean;
  /** "Start from template" (create only). */
  showTemplates?: boolean;
  /** Create only: "invite" goes back to the invite dialog with the new role picked. */
  returnTo?: "invite";
};

const NOT_HELD = "You don't have this permission";
const OWN_ROLE = "You can't change what your own role allows. You can still rename it.";

function toAccess(viewer: EditorViewer): CompanyAccess {
  return {
    isOwner: viewer.isOwner,
    grants: new Map(viewer.grants.map((g) => [g.key, g.scope])),
    assignedJobIds: new Set(),
    limits: viewer.limits,
  };
}

/**
 * RP-REQ-014 / RPT-033: the role editor. Permissions grouped as in the
 * catalog; a checkbox per row and, on rows that can be limited to assigned
 * jobs, an All jobs / Assigned jobs toggle. Dependencies are added and shown
 * as "Needed by …" (RP-REQ-009); rows above the viewer's own role are
 * disabled (RP-REQ-012). The server checks all of it again.
 */
export default function RoleEditor({
  mode,
  roleId,
  initial,
  viewer,
  readOnly = false,
  ownRole = false,
  showTemplates = false,
  returnTo,
}: Props) {
  const router = useRouter();
  const access = useMemo(() => toAccess(viewer), [viewer]);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [color, setColor] = useState<RoleColor>(initial.color);
  const [grants, setGrants] = useState(() => expandDependencies(initial.grants));
  const [limits, setLimits] = useState<RoleLimitsValue>(initial.limits);
  const [templateKey, setTemplateKey] = useState<string | null>(initial.templateKey ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const permissionsLocked = readOnly || ownRole;

  /** The widest scope the viewer may grant for `key`, or null. */
  const maxScope = (key: PermissionKey): PermissionScope | null =>
    canGrant(access, key, "all") ? "all" : canGrant(access, key, "assigned") ? "assigned" : null;

  const neededBy = (key: PermissionKey) => dependentsOf(key, grants);

  function check(key: PermissionKey, on: boolean) {
    setGrants((current) => {
      if (on) {
        const scope = permissionEntry(key).scopable ? (maxScope(key) ?? "assigned") : "all";
        return expandDependencies([...grantList(current), { key, scope }]);
      }
      if (dependentsOf(key, current).length > 0) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }

  function setScope(key: PermissionKey, scope: PermissionScope) {
    setGrants((current) => {
      const next = new Map(current);
      next.set(key, scope);
      return expandDependencies(grantList(next));
    });
  }

  function applyTemplate(key: string) {
    const template = ROLE_TEMPLATES.find((t) => t.key === key);
    if (!template) return;
    setTemplateKey(template.key);
    setName((n) => n || template.name);
    setDescription((d) => d || template.description);
    setColor(template.color);
    // Only what the viewer may grant; anything else is left out (rule 1).
    setGrants(expandDependencies(grantsWithinCeiling(access, template.grants)));
  }

  const summary = useMemo(() => grantSummary(grantList(grants)), [grants]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    setBusy(true);
    setError(null);
    try {
      const values = {
        name: name.trim(),
        description: description.trim(),
        color,
        grants: grantList(grants),
        limits,
      };
      const result =
        mode === "create"
          ? await createRoleAction({ ...values, templateKey })
          : await updateRoleAction({
              roleId: roleId!,
              name: values.name,
              description: values.description,
              color: values.color,
              // Rule 5: your own role's grants and limits aren't sent at all.
              ...(ownRole ? {} : { grants: values.grants, limits: values.limits }),
            });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(mode === "create" ? "Role created." : "Role saved.");
      // Editing stays on the page; a new role has nowhere to stay yet.
      if (mode === "create") {
        router.push(
          returnTo === "invite" && "id" in result && typeof result.id === "string"
            ? inviteWithRoleHref(result.id)
            : "/company/settings/roles",
        );
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6" aria-label="Role">
      <section className="flex flex-col gap-4 rounded-lg border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Details</h2>
          <RoleBadge role={{ name: name.trim() || "New role", color }} />
        </div>
        {showTemplates && !readOnly && (
          <div className="grid gap-2">
            <Label htmlFor="role-template">Start from template</Label>
            <Select value={templateKey ?? ""} onValueChange={applyTemplate}>
              <SelectTrigger id="role-template" aria-label="Start from template" className="w-full sm:w-72">
                <SelectValue placeholder="Blank" />
              </SelectTrigger>
              <SelectContent>
                {ROLE_TEMPLATES.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="role-name">Name</Label>
          <Input
            id="role-name"
            value={name}
            maxLength={40}
            disabled={readOnly}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="role-description">Description</Label>
          <Textarea
            id="role-description"
            value={description}
            maxLength={200}
            rows={2}
            disabled={readOnly}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <fieldset className="grid gap-2" disabled={readOnly}>
          <legend className="text-sm font-medium">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {ROLE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn(
                  "rounded-md border p-0.5 disabled:cursor-not-allowed",
                  color === c ? "border-foreground" : "border-transparent",
                )}
              >
                <RoleBadge role={{ name: c, color: c }} />
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="flex flex-col gap-3" aria-label="Permissions">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Permissions</h2>
            <p className="text-sm text-muted-foreground">{summary}</p>
          </div>
        </div>
        {ownRole && !readOnly && (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{OWN_ROLE}</p>
        )}
        <div className="rounded-md border">
          {PERMISSION_GROUPS.map((group) => (
            <div key={group} role="group" aria-label={group} className="border-b last:border-b-0">
              <h3 className="bg-muted/30 px-4 py-1.5 text-xs font-medium text-muted-foreground">{group}</h3>
              <ul>
                {PERMISSION_CATALOG.filter((p) => p.group === group).map((p) => (
                  <PermissionRow
                    key={p.key}
                    permission={p.key}
                    scope={grants.get(p.key) ?? null}
                    neededBy={neededBy(p.key)}
                    assignedBlocked={neededBy(p.key).some(
                      (k) => permissionEntry(k).scopable && grants.get(k) === "all",
                    )}
                    maxScope={maxScope(p.key)}
                    locked={permissionsLocked}
                    onCheck={(on) => check(p.key, on)}
                    onScope={(scope) => setScope(p.key, scope)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <RoleLimits
        value={limits}
        ceiling={viewer.isOwner ? {} : viewer.limits}
        disabled={permissionsLocked}
        onChange={setLimits}
      />

      {!readOnly && (
        // In the sticky bar, so the error shows wherever Save was clicked.
        <StickyActionBar>
          <Button type="submit" variant="brand" disabled={busy || !name.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save role
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </StickyActionBar>
      )}
    </form>
  );
}

/** One catalog permission: checkbox, label, "Needed by …" and the scope toggle (RPT-033). */
export function PermissionRow({
  permission,
  scope,
  neededBy,
  assignedBlocked = false,
  maxScope,
  locked,
  onCheck,
  onScope,
}: {
  permission: PermissionKey;
  scope: PermissionScope | null;
  neededBy: PermissionKey[];
  /** A permission that needs this one is granted for all jobs, so this can't be narrower. */
  assignedBlocked?: boolean;
  maxScope: PermissionScope | null;
  locked: boolean;
  onCheck: (on: boolean) => void;
  onScope: (scope: PermissionScope) => void;
}) {
  const entry = permissionEntry(permission);
  const checked = scope !== null;
  const notHeld = maxScope === null;
  const needed = neededBy.length > 0;
  const neededText = needed ? `Needed by ${neededBy.map((k) => permissionEntry(k).label).join(", ")}` : null;
  // Unchecking a needed permission is blocked; checking one you don't hold too.
  const disabled = locked || (checked ? needed : notHeld);
  const id = `perm-${permission.replace(".", "-")}`;

  return (
    <li className="flex flex-col gap-2 border-t px-4 py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(v) => onCheck(v === true)}
          aria-describedby={`${id}-help`}
          className="mt-0.5"
        />
        <div className="min-w-0">
          <Label htmlFor={id} className={cn("font-medium", disabled && "cursor-not-allowed")}>
            {entry.label}
          </Label>
          <p id={`${id}-help`} className="text-xs text-muted-foreground">
            {entry.description}
            {neededText && <span className="block">{neededText}</span>}
            {!checked && notHeld && !locked && <span className="block">{NOT_HELD}</span>}
          </p>
        </div>
      </div>
      {entry.scopable && checked && (
        <ScopeToggle
          label={entry.label}
          value={scope!}
          disabled={locked}
          allDisabled={maxScope !== "all"}
          assignedDisabled={assignedBlocked}
          onChange={onScope}
        />
      )}
    </li>
  );
}

/** All jobs / Assigned jobs, for scopable rows only (RP-REQ-014). */
export function ScopeToggle({
  label,
  value,
  disabled,
  allDisabled,
  assignedDisabled,
  onChange,
}: {
  label: string;
  value: PermissionScope;
  disabled: boolean;
  allDisabled: boolean;
  assignedDisabled: boolean;
  onChange: (scope: PermissionScope) => void;
}) {
  const options: { scope: PermissionScope; text: string; off: boolean }[] = [
    { scope: "all", text: "All jobs", off: allDisabled },
    { scope: "assigned", text: "Assigned jobs", off: assignedDisabled },
  ];
  return (
    <div role="group" aria-label={`Scope for ${label}`} className="inline-flex shrink-0 rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.scope}
          type="button"
          aria-pressed={value === o.scope}
          disabled={disabled || (o.off && value !== o.scope)}
          title={o.off && value !== o.scope ? NOT_HELD : undefined}
          onClick={() => onChange(o.scope)}
          className={cn(
            "rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            value === o.scope ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

export type { RoleLimitKey };
