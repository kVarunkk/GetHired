"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { formatDistanceToNow } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import DataTable from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import RoleBadge from "@/components/roles/RoleBadge";
import { changeRoleAction } from "@/app/actions/team/change-role";
import { makePrimaryOwnerAction } from "@/app/actions/team/make-primary-owner";
import { removeMemberAction } from "@/app/actions/team/remove-member";
import { resendInviteAction } from "@/app/actions/team/resend-invite";
import { revokeInviteAction } from "@/app/actions/team/revoke-invite";
import { setOwnerAction } from "@/app/actions/team/set-owner";
import type { TeamInvite, TeamMember } from "@/helpers/team/list-team";
import MemberAvatar from "./MemberAvatar";

export type TeamRoleOption = {
  id: string;
  name: string;
  color: string;
  /** RP-REQ-012 rules 3–4: within the viewer's own permissions. */
  withinCeiling: boolean;
};

export type TeamViewer = {
  userId: string;
  isOwner: boolean;
  isPrimaryOwner: boolean;
  canAssignRoles: boolean;
  canRemove: boolean;
  canInvite: boolean;
};

type Props = {
  members: TeamMember[];
  invites: TeamInvite[];
  /** The company's roles; empty when the viewer can't see roles. */
  roles: TeamRoleOption[];
  me: TeamViewer;
  companyName: string;
};

const ago = (iso: string | null) =>
  iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "Never";

type ActionResult = { ok: boolean; error?: unknown };
const errorText = (r: ActionResult) =>
  typeof r.error === "string"
    ? r.error
    : ((r.error as { message?: string })?.message ?? "Something went wrong.");

const RULE5 = "You can't change your own role.";
const ABOVE = "Their role has permissions yours doesn't.";

type PendingConfirm =
  | { kind: "leave" }
  | { kind: "remove"; member: TeamMember }
  | { kind: "revoke"; invite: TeamInvite };

/**
 * TM-REQ-006 / RP-REQ-013: members and pending invites. The viewer's
 * permissions decide the controls; the server computes them, and the actions
 * and RPCs check again (RP-REQ-016).
 */
export default function TeamTable({ members, invites, roles, me, companyName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [demote, setDemote] = useState<TeamMember | null>(null);
  const [makePrimary, setMakePrimary] = useState<TeamMember | null>(null);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const roleWithin = new Map(roles.map((r) => [r.id, r.withinCeiling]));
  const assignable = roles.filter((r) => r.withinCeiling);

  async function run(key: string, action: () => Promise<ActionResult>, success: string, after?: () => void) {
    setBusy(key);
    try {
      const result = await action();
      if (!result.ok) {
        toast.error(errorText(result));
        return false;
      }
      toast.success(success);
      after?.();
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  /** Rule 4: nobody but an owner acts on an owner, or on someone above them. */
  const canActOn = (member: TeamMember) => {
    if (member.userId === me.userId) return false;
    if (member.isOwner) return me.isOwner;
    return me.isOwner || (member.role ? roleWithin.get(member.role.id) === true : false);
  };

  const memberColumns: ColumnDef<TeamMember>[] = [
    {
      id: "member",
      header: "Member",
      cell: ({ row: { original: member } }) => (
        <div className="flex min-w-48 items-center gap-3">
          <MemberAvatar name={member.name} email={member.email} />
          <div className="min-w-0">
            <p className="max-w-64 truncate font-medium">
              {member.name ?? member.email}
              {member.userId === me.userId && <span className="text-muted-foreground"> (you)</span>}
            </p>
            {member.name && <p className="max-w-64 truncate text-xs text-muted-foreground">{member.email}</p>}
          </div>
        </div>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: ({ row: { original: member } }) => {
        // Rule 4/5: the picker shows but is disabled on your own row and on
        // members whose role is above yours.
        const showPicker = me.canAssignRoles && !member.isOwner;
        if (!showPicker || !member.role) {
          return <RoleBadge role={member.role} owner={member.isOwner} primary={member.isPrimaryOwner} />;
        }
        const pickerDisabledReason = member.userId === me.userId ? RULE5 : !canActOn(member) ? ABOVE : null;
        const options = !assignable.some((r) => r.id === member.role!.id)
          ? [{ ...member.role, withinCeiling: false }, ...assignable]
          : assignable;
        return (
          <Select
            value={member.role.id}
            disabled={busy !== null || pickerDisabledReason !== null}
            onValueChange={(roleId) =>
              run(`role:${member.userId}`, () => changeRoleAction({ userId: member.userId, roleId }), "Role changed.")
            }
          >
            <SelectTrigger
              className="h-8 w-40"
              aria-label={`Role for ${member.email ?? member.name}`}
              title={pickerDisabledReason ?? undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((role) => (
                <SelectItem key={role.id} value={role.id} disabled={!role.withinCeiling}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      id: "joined",
      header: "Joined",
      cell: ({ row }) => ago(row.original.joinedAt),
      meta: { className: "text-muted-foreground" },
    },
    {
      id: "lastActive",
      header: "Last active",
      cell: ({ row }) => ago(row.original.lastActiveAt),
      meta: { className: "text-muted-foreground" },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: member } }) => {
        const isMe = member.userId === me.userId;
        const ownerItems = me.isOwner
          ? [
              !member.isOwner && { key: "make-owner", label: "Make owner" },
              member.isOwner && !member.isPrimaryOwner && { key: "remove-owner", label: "Remove owner role" },
              member.isOwner && !member.isPrimaryOwner && { key: "make-primary", label: "Make primary owner" },
            ].filter(Boolean)
          : [];
        const canRemoveThem = !isMe && me.canRemove && canActOn(member) && !member.isPrimaryOwner;
        return (
          <div className="flex items-center justify-end gap-1">
            {canRemoveThem && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => setPending({ kind: "remove", member })}
              >
                Remove
              </Button>
            )}
            {isMe &&
              (me.isPrimaryOwner ? (
                <span className="text-xs text-muted-foreground">Make another owner primary to leave.</span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setPending({ kind: "leave" })}
                >
                  Leave team
                </Button>
              ))}
            {ownerItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={busy !== null}
                    aria-label={`Owner actions for ${member.email ?? member.name}`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {ownerItems.map((item) =>
                    item ? (
                      <DropdownMenuItem
                        key={item.key}
                        onSelect={() => {
                          if (item.key === "make-owner") {
                            void run(
                              `owner:${member.userId}`,
                              () => setOwnerAction({ userId: member.userId, isOwner: true }),
                              "They're now an owner.",
                            );
                          } else if (item.key === "remove-owner") {
                            setDemote(member);
                          } else {
                            setMakePrimary(member);
                          }
                        }}
                      >
                        {item.label}
                      </DropdownMenuItem>
                    ) : null,
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      },
    },
  ];

  const inviteColumns: ColumnDef<TeamInvite>[] = [
    {
      id: "email",
      header: "Email",
      cell: ({ row }) => (
        <div className="flex min-w-48 items-center gap-3">
          <MemberAvatar name={null} email={row.original.email} />
          <p className="max-w-64 truncate font-medium">{row.original.email}</p>
        </div>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: ({ row }) =>
        row.original.role ? (
          <RoleBadge role={row.original.role} />
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Default role
          </Badge>
        ),
    },
    {
      id: "invitedBy",
      header: "Invited by",
      cell: ({ row }) => row.original.invitedBy ?? "-",
      meta: { className: "text-muted-foreground" },
    },
    {
      id: "expires",
      header: "Expires",
      cell: ({ row }) => ago(row.original.expiresAt),
      meta: { className: "text-muted-foreground" },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: invite } }) =>
        me.canInvite && (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                run(`resend:${invite.id}`, () => resendInviteAction({ inviteId: invite.id }), "Invite resent.")
              }
            >
              Resend
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => setPending({ kind: "revoke", invite })}
            >
              Revoke
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <DataTable
        aria-label="Members"
        data={members}
        columns={memberColumns}
        noun="members"
        getRowId={(member) => member.userId}
      />

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">Pending invites</h3>
        <DataTable
          aria-label="Pending invites"
          data={invites}
          columns={inviteColumns}
          noun="invites"
          emptyMessage="No pending invites."
          getRowId={(invite) => invite.id}
        />
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        {...confirmCopy(pending, companyName)}
        onConfirm={() => {
          if (pending?.kind === "leave") {
            return run(
              "leave",
              () => removeMemberAction({ userId: me.userId }),
              "You left the team.",
              () => router.push("/company"),
            );
          }
          if (pending?.kind === "remove") {
            const { userId } = pending.member;
            return run(`remove:${userId}`, () => removeMemberAction({ userId }), "Removed.");
          }
          if (pending?.kind === "revoke") {
            const inviteId = pending.invite.id;
            return run(`revoke:${inviteId}`, () => revokeInviteAction({ inviteId }), "Invite revoked.");
          }
        }}
      />
      <DemoteDialog
        member={demote}
        roles={roles}
        busy={busy === "demote"}
        onClose={() => setDemote(null)}
        onConfirm={(roleId) =>
          run(
            "demote",
            () => setOwnerAction({ userId: demote!.userId, isOwner: false, roleId }),
            "Owner role removed.",
            () => setDemote(null),
          )
        }
      />
      <PrimaryOwnerDialog
        member={makePrimary}
        companyName={companyName}
        busy={busy === "primary"}
        onClose={() => setMakePrimary(null)}
        onConfirm={(confirmName) =>
          run(
            "primary",
            () => makePrimaryOwnerAction({ userId: makePrimary!.userId, confirmName }),
            "Primary owner changed.",
            () => setMakePrimary(null),
          )
        }
      />
    </div>
  );
}

/** What leaving, removing and revoking say before they happen. */
function confirmCopy(pending: PendingConfirm | null, companyName: string) {
  switch (pending?.kind) {
    case "remove": {
      const who = pending.member.name ?? pending.member.email ?? "This member";
      return {
        title: `Remove ${who}?`,
        description: `${who} loses access to ${companyName} right away. To bring them back, you'll need to invite them again.`,
        confirmLabel: "Remove",
      };
    }
    case "revoke":
      return {
        title: "Revoke invite?",
        description: `The invite link sent to ${pending.invite.email} stops working. You can invite them again later.`,
        confirmLabel: "Revoke invite",
      };
    default:
      return {
        title: `Leave ${companyName}?`,
        description: "You lose access to this company right away. To come back, you'll need a new invite.",
        confirmLabel: "Leave team",
      };
  }
}

/** RP-REQ-006: a demoted owner gets a role in the same step. */
function DemoteDialog({
  member,
  roles,
  busy,
  onClose,
  onConfirm,
}: {
  member: TeamMember | null;
  roles: TeamRoleOption[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (roleId: string) => void;
}) {
  const [roleId, setRoleId] = useState("");
  return (
    <ResponsiveDialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) {
          setRoleId("");
          onClose();
        }
      }}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Remove owner role</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {member?.name ?? member?.email} stops being an owner. Choose the role they&apos;ll have instead.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="grid gap-2">
          <Label htmlFor="demote-role">Role</Label>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger id="demote-role" aria-label="New role">
              <SelectValue placeholder="Choose a role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="default" disabled={!roleId || busy} onClick={() => onConfirm(roleId)}>
            Remove owner role
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** RP-DEC-002: the primary owner is the billing contact; typing the name confirms. */
function PrimaryOwnerDialog({
  member,
  companyName,
  busy,
  onClose,
  onConfirm,
}: {
  member: TeamMember | null;
  companyName: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (confirmName: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === companyName.trim().toLowerCase();

  return (
    <ResponsiveDialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) {
          setTyped("");
          onClose();
        }
      }}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Make primary owner</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {member?.name ?? member?.email} becomes the billing contact: receipts, plan emails and mail for
            members who leave go to them. Every owner keeps full access.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="grid gap-2">
          <Label htmlFor="primary-confirm">Type {companyName} to confirm</Label>
          <Input id="primary-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="default" disabled={!matches || busy} onClick={() => onConfirm(typed)}>
            Make primary owner
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
