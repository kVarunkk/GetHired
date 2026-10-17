import { tool } from "ai";
import { z } from "zod";
import { listRoles, type CompanyRoleView } from "@/helpers/companies/list-roles";
import { permissionEntry, PERMISSION_KEYS } from "@/helpers/companies/permissions";
import {
  grantsSchema,
  limitsSchema,
  roleColorSchema,
  roleDescriptionSchema,
  roleNameSchema,
} from "@/helpers/companies/role-input";
import { assignJob, assignMemberRole, createRole, deleteRole, unassignJob, updateRole } from "@/helpers/companies/role-rpc";
import { listTeam } from "@/helpers/team/list-team";
import { type RecruiterToolContext, uuidInput, withToolErrors } from "./shared";

export const ROLES_URL = "/company/settings/roles";
export const TEAM_URL = "/company/settings/team";
const roleUrl = (id: string) => `${ROLES_URL}/${id}`;

/** A role as the model sees it: names, not ids, for permissions; the id for later calls. */
function compactRole(role: CompanyRoleView) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isDefault: role.isDefault,
    members: role.memberCount,
    openInvites: role.inviteCount,
    permissions: role.grants.map((g) => ({
      key: g.key,
      label: permissionEntry(g.key).label,
      scope: g.scope === "assigned" ? "assigned jobs only" : "all jobs",
    })),
    limits: role.limits,
    /** RP-REQ-012: whether this user may edit, delete or assign it. */
    canManage: role.withinCeiling,
    url: roleUrl(role.id),
  };
}

const notFound = { error: "That role isn't in your company." } as const;

/**
 * RP-REQ-032: the agent manages roles and hiring teams through the same RPCs
 * as the UI (helpers/companies/role-rpc.ts), so RP-REQ-012 applies unchanged,
 * and every write asks for approval (approval.ts). There is no tool for
 * owners or billing (RP-DEC-003). Writes are recorded with actor_kind 'agent'.
 */
export function createRoleTools(ctx: RecruiterToolContext) {
  const { supabase, company } = ctx;

  const loadRoles = async () => (await listRoles(supabase, company)) ?? [];
  const findRole = async (roleId: string) => (await loadRoles()).find((r) => r.id === roleId) ?? null;

  return {
    listTeam: tool({
      description:
        "List the company's team: each member's name, role (or Owner), and how many jobs they're assigned to, plus open invites. Use member ids from here for assignRole, assignToJob and unassignFromJob.",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "listTeam", async () => {
          const team = await listTeam(supabase, company);
          return {
            members: team.members.map((m) => ({
              id: m.userId,
              name: m.name ?? m.email?.split("@")[0] ?? null,
              role: m.isOwner ? "Owner" : (m.role?.name ?? null),
              primaryOwner: m.isPrimaryOwner,
              assignedJobs: m.assignedJobIds.length,
              you: m.userId === ctx.user.id,
            })),
            openInvites: team.invites.map((i) => ({ role: i.role?.name ?? "Default role", expiresAt: i.expiresAt })),
            seats: team.seats,
            url: TEAM_URL,
          };
        }),
    }),

    listRoles: tool({
      description:
        "List the company's roles: name, description, member count, whether it's the default for invites, its permissions (each for all jobs or assigned jobs only) and per-member monthly limits.",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "listRoles", async () => ({
          roles: (await loadRoles()).map(compactRole),
          permissionKeys: PERMISSION_KEYS,
          url: ROLES_URL,
        })),
    }),

    getRole: tool({
      description: "Read one role: its permissions, limits and who has it.",
      inputSchema: z.object({ roleId: uuidInput("role") }),
      execute: ({ roleId }) =>
        withToolErrors(ctx, "getRole", async () => {
          const role = await findRole(roleId);
          if (!role) return notFound;
          return { ...compactRole(role), holders: role.members.map((m) => m.name) };
        }),
    }),

    createRole: tool({
      description:
        "Create a role from permission keys (see listRoles' permissionKeys). Each permission can be for all jobs or assigned jobs only. Dependencies are added automatically. You can only grant what the user's own role has. Limits cap each member's monthly use of screenings, outreach, agent_messages, match_explanations or interview_minutes.",
      inputSchema: z
        .object({
          name: roleNameSchema,
          description: roleDescriptionSchema.optional(),
          color: roleColorSchema.optional(),
          grants: grantsSchema,
          limits: limitsSchema.optional(),
        })
        .strict(),
      execute: (input) =>
        withToolErrors(ctx, "createRole", async () => {
          const result = await createRole(
            supabase,
            {
              name: input.name,
              description: input.description ?? "",
              color: input.color ?? "slate",
              grants: input.grants,
              limits: input.limits ?? {},
            },
            "agent",
          );
          if (!result.ok) return { error: result.error };
          return { id: result.id, name: input.name, url: roleUrl(result.id) };
        }),
    }),

    updateRole: tool({
      description:
        "Change a role. Pass only what changes; grants and limits replace the role's whole list. The user can't change their own role's permissions, or a role with permissions they don't have.",
      inputSchema: z
        .object({
          roleId: uuidInput("role"),
          name: roleNameSchema.optional(),
          description: roleDescriptionSchema.optional(),
          color: roleColorSchema.optional(),
          grants: grantsSchema.optional(),
          limits: limitsSchema.optional(),
        })
        .strict()
        .refine((input) => Object.keys(input).some((key) => key !== "roleId"), {
          message: "Pass at least one field to change.",
        }),
      execute: ({ roleId, ...fields }) =>
        withToolErrors(ctx, "updateRole", async () => {
          const result = await updateRole(supabase, roleId, fields, "agent");
          if (!result.ok) return { error: result.error };
          return { id: roleId, updated: Object.keys(fields), url: roleUrl(roleId) };
        }),
    }),

    deleteRole: tool({
      description:
        "Delete a role. If anyone has it (or an open invite uses it), pass replacementRoleId: they move to that role in the same step. The default invite role can't be deleted.",
      inputSchema: z
        .object({ roleId: uuidInput("role"), replacementRoleId: uuidInput("replacement role").optional() })
        .strict(),
      execute: ({ roleId, replacementRoleId }) =>
        withToolErrors(ctx, "deleteRole", async () => {
          const result = await deleteRole(supabase, roleId, replacementRoleId ?? null, "agent");
          if (!result.ok) return { error: result.error };
          return { deleted: roleId, moved: result.moved, url: ROLES_URL };
        }),
    }),

    assignRole: tool({
      description:
        "Give a team member a different role (not an owner, and not the user themselves). Member ids come from listTeam, role ids from listRoles.",
      inputSchema: z.object({ memberId: uuidInput("team member"), roleId: uuidInput("role") }).strict(),
      execute: ({ memberId, roleId }) =>
        withToolErrors(ctx, "assignRole", async () => {
          const result = await assignMemberRole(supabase, memberId, roleId, "agent");
          if (!result.ok) return { error: result.error };
          return { memberId, roleId, url: TEAM_URL };
        }),
    }),

    assignToJob: tool({
      description:
        "Add a team member to a job's hiring team, so roles limited to assigned jobs cover it. Member ids come from listTeam.",
      inputSchema: z.object({ jobPostId: uuidInput("job post"), memberId: uuidInput("team member") }).strict(),
      execute: ({ jobPostId, memberId }) =>
        withToolErrors(ctx, "assignToJob", async () => {
          const result = await assignJob(supabase, jobPostId, memberId, "agent");
          if (!result.ok) return { error: result.error };
          return { jobPostId, memberId, url: `/company/job-posts/${jobPostId}` };
        }),
    }),

    unassignFromJob: tool({
      description: "Remove a team member from a job's hiring team.",
      inputSchema: z.object({ jobPostId: uuidInput("job post"), memberId: uuidInput("team member") }).strict(),
      execute: ({ jobPostId, memberId }) =>
        withToolErrors(ctx, "unassignFromJob", async () => {
          const result = await unassignJob(supabase, jobPostId, memberId, "agent");
          if (!result.ok) return { error: result.error };
          return { jobPostId, memberId, url: `/company/job-posts/${jobPostId}` };
        }),
    }),
  };
}
