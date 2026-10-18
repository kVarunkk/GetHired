"use client";

import { useEffect, useState } from "react";
import {
  previewAgentRoleAction,
  type PreviewAgentRoleResult,
} from "@/app/actions/roles/preview-agent-role";
import { describeGrantChange, describeLimitChange } from "@/helpers/companies/role-diff";

export const ROLE_APPROVAL_TOOLS = [
  "createRole",
  "updateRole",
  "deleteRole",
  "assignRole",
  "setDefaultRole",
  "removeTeamMember",
  "assignToJob",
  "unassignFromJob",
  "inviteTeamMember",
  "resendInvite",
  "revokeInvite",
] as const;
export type RoleApprovalTool = (typeof ROLE_APPROVAL_TOOLS)[number];

export const isRoleApprovalTool = (name: string): name is RoleApprovalTool =>
  (ROLE_APPROVAL_TOOLS as readonly string[]).includes(name);

/**
 * RP-REQ-032: the approval card for the agent's role and hiring-team changes,
 * showing exactly what changes: permissions added or removed (with their
 * scope), limits, who moves where, who an invite goes to. Loaded from a server preview, which also
 * warns when the RPC will refuse it.
 */
export function RoleApprovalDetails({ tool, input }: { tool: RoleApprovalTool; input: unknown }) {
  const [preview, setPreview] = useState<PreviewAgentRoleResult | null>(null);
  const key = JSON.stringify(input ?? {});

  useEffect(() => {
    let cancelled = false;
    previewAgentRoleAction({ tool, input: JSON.parse(key) })
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't load the preview." }));
    return () => {
      cancelled = true;
    };
  }, [tool, key]);

  if (!preview) return <p className="text-xs text-muted-foreground">Loading the change…</p>;
  if (!preview.ok) return <p className="text-xs text-destructive">{preview.error}</p>;

  const rows: [string, string][] = [];
  if (preview.email) rows.push(["Email", preview.email]);
  if (preview.role) rows.push([tool === "setDefaultRole" ? "New default" : "Role", preview.role.name]);
  if (preview.to && (tool === "updateRole" || tool === "assignRole")) {
    rows.push([tool === "updateRole" ? "New name" : "New role", preview.to]);
  }
  if (preview.member) rows.push(["Member", preview.member]);
  if (preview.from) rows.push([tool === "setDefaultRole" ? "Current default" : "Current role", preview.from]);
  if (preview.job) rows.push(["Job", preview.job]);
  if (tool === "deleteRole") {
    rows.push(["People moved", `${preview.role?.members ?? 0}${preview.replacement ? ` to ${preview.replacement}` : ""}`]);
  }

  const grants = preview.diff?.grants ?? [];
  const limits = preview.diff?.limits ?? [];

  return (
    <div className="flex flex-col gap-2 text-xs">
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {(grants.length > 0 || limits.length > 0) && (
        <div className="rounded-md border p-2">
          <p className="mb-1 text-muted-foreground">Permissions and limits</p>
          <ul className="flex flex-col gap-0.5" aria-label="Changes">
            {grants.map((g) => (
              <li key={g.key} className={g.kind === "removed" ? "text-destructive" : "text-foreground"}>
                {describeGrantChange(g)}
              </li>
            ))}
            {limits.map((l) => (
              <li key={l.key} className="text-foreground">
                {describeLimitChange(l)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {tool === "updateRole" && grants.length === 0 && limits.length === 0 && (
        <p className="text-muted-foreground">Permissions and limits stay the same.</p>
      )}
      {preview.warning && <p className="text-destructive">{preview.warning}</p>}
    </div>
  );
}
