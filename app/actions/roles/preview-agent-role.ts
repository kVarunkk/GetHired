"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { listRoles } from "@/helpers/companies/list-roles";
import { diffRole, toGrantMap, toLimits, type RoleDiff } from "@/helpers/companies/role-diff";
import { can } from "@/helpers/companies/permissions";
import { roleTemplate } from "@/helpers/companies/role-templates";
import { listTeam } from "@/helpers/team/list-team";

const ROLE_TOOLS = [
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
const INVITE_TOOLS: readonly string[] = ["inviteTeamMember", "resendInvite", "revokeInvite"];

const inputSchema = z.object({ tool: z.enum(ROLE_TOOLS), input: z.record(z.string(), z.unknown()) }).strict();

export type PreviewAgentRoleResult =
  | {
      ok: true;
      /** The role the call creates or changes (createRole: the new name). */
      role: { name: string; members: number } | null;
      diff: RoleDiff | null;
      /** deleteRole: where the members go. assignRole: from → to. setDefaultRole: the current default in `from`. */
      replacement: string | null;
      member: string | null;
      from: string | null;
      to: string | null;
      job: string | null;
      /** Invite tools: who gets (or got) the invite. */
      email: string | null;
      /** RP-REQ-012: the RPC will refuse it (above the user's role, their own role). */
      warning: string | null;
    }
  | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * The approval card's preview for the agent's role tools (RP-REQ-032): the
 * exact before/after of grants and limits, the member and role names, and a
 * warning when the RPC would refuse. For the invite tools: the email and the
 * role it gets. Read-only; the company comes from the
 * session and the tool input holds only ids and fields.
 */
export async function previewAgentRoleAction(input: z.input<typeof inputSchema>): Promise<PreviewAgentRoleResult> {
  const parsed = inputSchema.safeParse(input);
  // Hiring-team changes need only the team; role changes need the roles.
  // Invites need team.invite, and show role names only if the user can see roles.
  // Removing a member needs team.remove and shows the member's role from the team list.
  const hiringTeam = parsed.success && (parsed.data.tool === "assignToJob" || parsed.data.tool === "unassignFromJob");
  const invite = parsed.success && INVITE_TOOLS.includes(parsed.data.tool);
  const remove = parsed.success && parsed.data.tool === "removeTeamMember";
  const auth = await requireCompanyForAction({
    permission: invite ? "team.invite" : remove ? "team.remove" : hiringTeam ? "team.view" : "roles.view",
  });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!parsed.success) return { ok: false, error: "Couldn't read the change." };
  const { tool, input: args } = parsed.data;

  const roles = hiringTeam || remove ? [] : ((await listRoles(auth.supabase, auth.company)) ?? []);
  const byId = new Map(roles.map((r) => [r.id, r]));
  const empty = {
    role: null,
    diff: null,
    replacement: null,
    member: null,
    from: null,
    to: null,
    job: null,
    email: null,
    warning: null,
  };

  if (tool === "inviteTeamMember") {
    const template = roleTemplate(str(args.templateKey) ?? "");
    const roleId = str(args.roleId);
    const chosen = roleId ? byId.get(roleId) : undefined;
    const name = template
      ? (roles.find((r) => r.templateKey === template.key)?.name ?? `${template.name} (new role)`)
      : roleId
        ? (chosen?.name ?? null)
        : (roles.find((r) => r.isDefault)?.name ?? "The default role");
    return {
      ok: true,
      ...empty,
      email: str(args.email)?.trim().toLowerCase() ?? null,
      role: name ? { name, members: 0 } : null,
      warning:
        template && !can(auth.company, "roles.manage")
          ? "Inviting with a new role needs permission to manage roles, so the invite will be refused."
          : chosen && !chosen.withinCeiling
            ? "That role has permissions yours doesn't, so the invite will be refused."
            : null,
    };
  }

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

  if (tool === "setDefaultRole") {
    const role = byId.get(str(args.roleId) ?? "");
    if (!role) return { ok: false, error: "That role isn't in your company." };
    return {
      ok: true,
      ...empty,
      role: { name: role.name, members: role.memberCount },
      from: roles.find((r) => r.isDefault)?.name ?? null,
      warning: role.isDefault
        ? "This is already the default role."
        : !role.withinCeiling
          ? "That role has permissions yours doesn't, so the change will be refused."
          : null,
    };
  }

  const team = await listTeam(auth.supabase, auth.company);

  if (tool === "resendInvite" || tool === "revokeInvite") {
    const open = team.invites.find((i) => i.id === str(args.inviteId));
    if (!open) return { ok: false, error: "That invite isn't open any more." };
    return { ok: true, ...empty, email: open.email, role: { name: open.role?.name ?? "The default role", members: 0 } };
  }

  const member = team.members.find((m) => m.userId === str(args.memberId));
  const memberName = member ? (member.name ?? member.email ?? "Team member") : null;
  if (!member) return { ok: false, error: "That person isn't on your team." };

  if (tool === "removeTeamMember") {
    return {
      ok: true,
      ...empty,
      member: memberName,
      from: member.isOwner ? "Owner" : (member.role?.name ?? null),
      warning:
        member.userId === auth.user.id
          ? "You can't remove yourself here."
          : member.isOwner
            ? "Owners can't be removed by the assistant."
            : null,
    };
  }

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
