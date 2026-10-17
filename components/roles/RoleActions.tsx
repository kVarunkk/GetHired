"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteRoleAction } from "@/app/actions/roles/delete-role";
import { setDefaultRoleAction } from "@/app/actions/roles/set-default-role";

export type RoleActionsRole = {
  id: string;
  name: string;
  isDefault: boolean;
  memberCount: number;
  inviteCount: number;
};

const ROLES_PATH = "/company/settings/roles";

/**
 * RP-REQ-004/008: "Make default" and "Delete" for one role. Only rendered
 * for a viewer with roles.manage and a role within their ceiling; the RPCs
 * check both again. `replacements` are the other roles the viewer may move
 * holders to.
 */
export default function RoleActions({
  role,
  replacements,
  redirectOnDelete = false,
}: {
  role: RoleActionsRole;
  replacements: { id: string; name: string }[];
  /** On the role's own page, go back to the list after deleting it. */
  redirectOnDelete?: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  async function makeDefault() {
    setBusy(true);
    try {
      const result = await setDefaultRoleAction({ roleId: role.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`New invites now get ${role.name}.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${role.name}`} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!role.isDefault && <DropdownMenuItem onSelect={makeDefault}>Make default for invites</DropdownMenuItem>}
          <DropdownMenuItem
            disabled={role.isDefault}
            title={role.isDefault ? "Make another role the default first." : undefined}
            className="text-destructive focus:text-destructive"
            onSelect={() => setDeleting(true)}
          >
            Delete role
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteRoleDialog
        role={deleting ? role : null}
        replacements={replacements}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          setDeleting(false);
          if (redirectOnDelete) router.push(ROLES_PATH);
          router.refresh();
        }}
      />
    </>
  );
}

/** RP-REQ-008: deleting a role that people hold asks where to move them. */
export function DeleteRoleDialog({
  role,
  replacements,
  onClose,
  onDeleted,
}: {
  role: RoleActionsRole | null;
  replacements: { id: string; name: string }[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [replacementId, setReplacementId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const holders = role ? role.memberCount + role.inviteCount : 0;
  const needsReplacement = holders > 0;

  function close() {
    setReplacementId("");
    setError(null);
    onClose();
  }

  async function confirm() {
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteRoleAction({
        roleId: role.id,
        replacementRoleId: needsReplacement ? replacementId : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        result.moved > 0 ? `${role.name} deleted. ${result.moved} moved to the new role.` : `${role.name} deleted.`,
      );
      setReplacementId("");
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  const people = [
    role?.memberCount ? `${role.memberCount} member${role.memberCount === 1 ? "" : "s"}` : null,
    role?.inviteCount ? `${role.inviteCount} open invite${role.inviteCount === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  return (
    <ResponsiveDialog open={role !== null} onOpenChange={(open) => !open && close()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Delete {role?.name}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {needsReplacement
              ? `${people} ${holders === 1 ? "has" : "have"} this role. Choose the role they'll move to.`
              : "Nobody has this role. Deleting it can't be undone."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {needsReplacement && (
          <ResponsiveDialogBody className="grid gap-2">
            <Label htmlFor="replacement-role">Move them to</Label>
            <Select value={replacementId} onValueChange={setReplacementId}>
              <SelectTrigger id="replacement-role" aria-label="Replacement role">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                {replacements.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ResponsiveDialogBody>
        )}
        {error && (
          <p role="alert" className="px-4 text-sm text-destructive sm:px-0">
            {error}
          </p>
        )}
        <ResponsiveDialogFooter>
          <Button variant="destructive" disabled={busy || (needsReplacement && !replacementId)} onClick={confirm}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete role
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
