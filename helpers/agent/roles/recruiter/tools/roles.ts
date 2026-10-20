import { tool } from "ai";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { listRoles, type CompanyRoleView } from "@/helpers/companies/list-roles";
import { forbiddenMessage, permissionEntry, PERMISSION_KEYS } from "@/helpers/companies/permissions";
import {
  grantsSchema,
  limitsSchema,
  roleColorSchema,
  roleDescriptionSchema,
  roleNameSchema,
} from "@/helpers/companies/role-input";
import {
  assignJob,
  assignMemberRole,
  createRole,
  deleteRole,
  setDefaultRole,
  unassignJob,
  updateRole,
} from "@/helpers/companies/role-rpc";
import {
  AUDIT_ACTION_GROUP_VALUES,
  auditActorLabel,
  describeAuditEntry,
} from "@/helpers/companies/audit";
import { listAudit } from "@/helpers/companies/list-audit";
import { ROLE_TEMPLATES } from "@/helpers/companies/role-templates";
import { inviteMember, inviteTemplateKeySchema, resendInvite, revokeInvite } from "@/helpers/team/invites";
import type { CreateInviteResult } from "@/helpers/team/send-invite";
import { listCompanyHiringTeams } from "@/helpers/team/list-company-hiring-teams";
import { listTeam } from "@/helpers/team/list-team";
import { removeMember } from "@/helpers/team/remove-member";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";
import { planLimitError, type RecruiterToolContext, uuidInput, withToolErrors } from "./shared";

export const ROLES_URL = "/company/settings/roles";
export const TEAM_URL = "/company/settings/team";
export const HIRING_TEAMS_URL = "/company/settings/hiring-teams";
export const AUDIT_URL = "/company/settings/audit";
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

/** An invite result as the model sees it. Plan limits (seats) point to the upgrade page. */
function inviteOutput(result: CreateInviteResult) {
  if (!result.ok) return typeof result.error === "string" ? { error: result.error } : planLimitError(result.error);
  return { invited: result.invite.email, role: result.invite.role.name, inviteId: result.invite.id, url: TEAM_URL };
}

const dayInput = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
    .describe(`${what}, YYYY-MM-DD (inclusive)`);

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

    listHiringTeams: tool({
      description:
        "List who is on each job's hiring team, for every job the user can assign people to, plus the members who can be added. Use the ids with assignToJob and unassignFromJob.",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "listHiringTeams", async () => {
          const teams = await listCompanyHiringTeams(supabase);
          if (!teams) return { error: forbiddenMessage("jobs.assign") };
          const nameOf = new Map(
            teams.members.map((m) => [m.userId, m.name ?? m.email?.split("@")[0] ?? "Unnamed member"]),
          );
          return {
            jobs: teams.jobs.map((j) => ({
              id: j.id,
              title: j.title,
              status: j.status,
              hiringTeam: j.assignedUserIds.map((id) => ({ id, name: nameOf.get(id) ?? "A former member" })),
            })),
            members: teams.members.map((m) => ({
              id: m.userId,
              name: nameOf.get(m.userId),
              role: m.isOwner ? "Owner" : (m.role?.name ?? null),
              canAdd: m.assignable,
              canRemove: m.removable,
              you: m.userId === ctx.user.id,
            })),
            url: HIRING_TEAMS_URL,
          };
        }),
    }),

    getAuditLog: tool({
      description:
        "Read the company's audit log, newest first (up to 50 entries): changes to roles, owners, members, invites and hiring teams, who made them and when. Filter by member (ids from listTeam), kind of change and date range.",
      inputSchema: z
        .object({
          memberId: uuidInput("team member who made the change").optional(),
          kind: z.enum(AUDIT_ACTION_GROUP_VALUES).optional().describe("Only this kind of change"),
          since: dayInput("First day").optional(),
          until: dayInput("Last day").optional(),
        })
        .strict(),
      execute: ({ memberId, kind, since, until }) =>
        withToolErrors(ctx, "getAuditLog", async () => {
          const page = await listAudit(supabase, {
            actor: memberId ?? null,
            action: kind ?? null,
            since: since ?? null,
            until: until ?? null,
          });
          if (!page) return { error: forbiddenMessage("audit.view") };
          return {
            entries: page.entries.map((entry) => {
              const { text, details } = describeAuditEntry(entry);
              return {
                at: entry.createdAt,
                who: auditActorLabel(entry),
                what: text,
                ...(details.length ? { details } : {}),
              };
            }),
            more: page.nextBefore !== null,
            url: AUDIT_URL,
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

    setDefaultRole: tool({
      description:
        "Make a role the default for new invites (invites sent without a role get it). Only a role within the user's own permissions. Role ids come from listRoles.",
      inputSchema: z.object({ roleId: uuidInput("role") }).strict(),
      execute: ({ roleId }) =>
        withToolErrors(ctx, "setDefaultRole", async () => {
          const result = await setDefaultRole(supabase, roleId, "agent");
          if (!result.ok) return { error: result.error };
          return { defaultRoleId: roleId, url: ROLES_URL };
        }),
    }),

    removeTeamMember: tool({
      description:
        "Remove someone from the team: they lose access to the company and its hiring teams. Not the user themselves and not an owner. Member ids come from listTeam. Only when the user asks.",
      inputSchema: z.object({ memberId: uuidInput("team member") }).strict(),
      execute: ({ memberId }) =>
        withToolErrors(ctx, "removeTeamMember", async () => {
          // The action's leave-the-company path (your own id) isn't exposed to the agent.
          if (memberId === ctx.user.id) {
            return { error: "You can't remove yourself here. To leave the company, use the team page." };
          }
          const member = (await listTeam(supabase, company)).members.find((m) => m.userId === memberId);
          if (!member) return { error: "That person isn't on your team." };
          if (member.isOwner) return { error: "Owners can't be removed by the assistant. Use the team page." };

          const result = await removeMember(supabase, memberId, "agent");
          if (!result.ok) return { error: result.error };
          await eventCaptureServer({
            event: PostHogEvent.TeamMemberRemoved,
            distinctId: ctx.user.id,
            properties: { left: false, source: "agent" },
          });
          return { removed: member.name ?? member.email?.split("@")[0] ?? "Team member", url: TEAM_URL };
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

    // Invites go through the same helpers as the team page (helpers/team/invites.ts),
    // so the seat limit, the role ceiling and the email are the same.
    listInvites: tool({
      description:
        "List the company's open invites: email, role and when each expires, plus seats used. Use invite ids from here for resendInvite and revokeInvite.",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "listInvites", async () => {
          const team = await listTeam(supabase, company);
          return {
            invites: team.invites.map((i) => ({
              id: i.id,
              email: i.email,
              role: i.role?.name ?? "Default role",
              sentAt: i.createdAt,
              expiresAt: i.expiresAt,
            })),
            seats: team.seats,
            url: TEAM_URL,
          };
        }),
    }),

    inviteTeamMember: tool({
      description: `Invite someone to the team by email; they get an email with a link to join. Pass roleId (from listRoles) for one of the company's roles, or templateKey for a standard role the company doesn't have yet (it's created first, which needs permission to manage roles): ${ROLE_TEMPLATES.map((t) => `${t.key} (${t.name})`).join(", ")}. Pass neither for the company's default role. The user can only invite with roles within their own permissions.`,
      inputSchema: z
        .object({
          email: z.string().trim().toLowerCase().email().max(320).describe("The person's email address"),
          roleId: uuidInput("role").optional(),
          templateKey: inviteTemplateKeySchema.optional().describe("A standard role to create and invite with"),
        })
        .strict()
        .refine((input) => !(input.roleId && input.templateKey), { message: "Pass roleId or templateKey, not both." }),
      execute: (input) =>
        withToolErrors(ctx, "inviteTeamMember", async () => {
          const result = await inviteMember(ctx, input, "agent");
          if (result.ok) revalidatePath(TEAM_URL);
          return inviteOutput(result);
        }),
    }),

    resendInvite: tool({
      description:
        "Resend an open invite: the old link stops working and a new email goes out with the same role. Invite ids come from listInvites.",
      inputSchema: z.object({ inviteId: uuidInput("invite") }).strict(),
      execute: ({ inviteId }) =>
        withToolErrors(ctx, "resendInvite", async () => {
          const result = await resendInvite(ctx, inviteId, "agent");
          revalidatePath(TEAM_URL);
          return inviteOutput(result);
        }),
    }),

    revokeInvite: tool({
      description: "Revoke an open invite, so its link stops working. Invite ids come from listInvites.",
      inputSchema: z.object({ inviteId: uuidInput("invite") }).strict(),
      execute: ({ inviteId }) =>
        withToolErrors(ctx, "revokeInvite", async () => {
          const result = await revokeInvite(supabase, inviteId, "agent");
          if (!result.ok) return { error: result.error };
          revalidatePath(TEAM_URL);
          return { revoked: inviteId, url: TEAM_URL };
        }),
    }),
  };
}
