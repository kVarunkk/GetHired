"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { listRoles } from "@/helpers/companies/list-roles";
import { diffRole, toGrantMap, toLimits, type RoleDiff } from "@/helpers/companies/role-diff";
import { listTeam } from "@/helpers/team/list-team";

const ROLE_TOOLS = ["createRole", "updateRole", "deleteRole", "assignRole", "assignToJob", "unassignFromJob"] as const;

const inputSchema = z.object({ tool: z.enum(ROLE_TOOLS), input: z.record(z.string(), z.unknown()) }).strict();

export type PreviewAgentRoleResult =
  | {
      ok: true;
      /** The role the call creates or changes (createRole: the new name). */
      role: { name: string; members: number } | null;
      diff: RoleDiff | null;
      /** deleteRole: where the members go. assignRole: from → to. */
      replacement: string | null;
      member: string | null;
      from: string | null;
      to: string | null;
      job: string | null;
      /** RP-REQ-012: the RPC will refuse it (above the user's role, their own role). */
      warning: string | null;
    }
  | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * The approval card's preview for the agent's role tools (RP-REQ-032): the
 * exact before/after of grants and limits, the member and role names, and a
 * warning when the RPC would refuse. Read-only; the company comes from the
 * session and the tool input holds only ids and fields.
 */
export async function previewAgentRoleAction(input: z.input<typeof inputSchema>): Promise<PreviewAgentRoleResult> {
  const parsed = inputSchema.safeParse(input);
  // Hiring-team changes need only the team; role changes need the roles.
  const hiringTeam = parsed.success && (parsed.data.tool === "assignToJob" || parsed.data.tool === "unassignFromJob");
  const auth = await requireCompanyForAction({ permission: hiringTeam ? "team.view" : "roles.view" });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!parsed.success) return { ok: false, error: "Couldn't read the change." };
  const { tool, input: args } = parsed.data;

  const roles = hiringTeam ? [] : ((await listRoles(auth.supabase, auth.company)) ?? []);
  const byId = new Map(roles.map((r) => [r.id, r]));
  const empty = { role: null, diff: null, replacement: null, member: null, from: null, to: null, job: null, warning: null };

  if (tool === "createRole") {
    const diff = diffRole({ grants: new Map(), limits: {} }, { grants: toGrantMap(args.grants), limits: toLimits(args.limits ?? {}) });
    return { ok: true, ...empty, role: { name: str(args.name) ?? "New role", members: 0 }, diff };
  }

  if (tool === "updateRole" || tool === "deleteRole") {
    const role = byId.get(str(args.roleId) ?? "");
    if (!role) return { ok: false, error: "That role isn't in your company." };
    const before = { grants: toGrantMap(role.grants), limits: role.limits };
    const own = auth.company.role?.id === role.id;
    const warning = !role.withinCeiling
      ? "This role has permissions your role doesn't, so the change will be refused."
      : own && tool === "updateRole" && (args.grants !== undefined || args.limits !== undefined)
        ? "This is your own role: its permissions and limits can't be changed by you."
        : null;
    if (tool === "updateRole") {
      const diff = diffRole(before, {
        grants: args.grants !== undefined ? toGrantMap(args.grants) : null,
        limits: args.limits !== undefined ? toLimits(args.limits) : null,
      });
      return {
        ok: true,
        ...empty,
        role: { name: role.name, members: role.memberCount },
        diff,
        to: str(args.name) && str(args.name) !== role.name ? str(args.name) : null,
        warning,
      };
    }
    const replacement = byId.get(str(args.replacementRoleId) ?? "")?.name ?? null;
    return {
      ok: true,
      ...empty,
      role: { name: role.name, members: role.memberCount + role.inviteCount },
      replacement,
      warning:
        warning ??
        (role.isDefault
          ? "This is the role new invites get, so it can't be deleted."
          : role.memberCount + role.inviteCount > 0 && !replacement
            ? "People have this role: choose a role to move them to."
            : null),
    };
  }

  const team = await listTeam(auth.supabase, auth.company);
  const member = team.members.find((m) => m.userId === str(args.memberId));
  const memberName = member ? (member.name ?? member.email ?? "Team member") : null;
  if (!member) return { ok: false, error: "That person isn't on your team." };

  if (tool === "assignRole") {
    const to = byId.get(str(args.roleId) ?? "");
    return {
      ok: true,
      ...empty,
      member: memberName,
      from: member.isOwner ? "Owner" : (member.role?.name ?? null),
      to: to?.name ?? null,
      warning: member.isOwner
        ? "Owners don't have a role to change."
        : member.userId === auth.user.id
          ? "You can't change your own role."
          : to && !to.withinCeiling
            ? "That role has permissions yours doesn't, so the change will be refused."
            : null,
    };
  }

  const { data: job } = await auth.supabase
    .from("job_postings")
    .select("title")
    .eq("id", str(args.jobPostId) ?? "")
    .eq("company_id", auth.company.id)
    .maybeSingle();
  return {
    ok: true,
    ...empty,
    member: memberName,
    job: job?.title ?? null,
    warning: member.isOwner ? "Owners already see every job." : job ? null : "That job isn't in your company.",
  };
}
