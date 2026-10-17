"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inviteMemberAction } from "@/app/actions/team/invite-member";
import { domainNotice } from "@/helpers/team/free-mail-domains";
import { NEW_ROLE_FOR_INVITE_HREF, type InviteRoleOption } from "@/helpers/team/invite-roles";

type Props = {
  /** The owner's email, for the TM-REQ-010 domain notice. */
  ownerEmail: string | null;
  seats: { used: number; limit: number | null };
  /** RP-REQ-007/013: the company's roles, then unused templates (`inviteRoleOptions`). */
  roles: InviteRoleOption[];
  /** roles.manage: offer "Create a custom role", which comes back here. */
  canCreateRole?: boolean;
  /** A role to open the dialog with, after creating it for this invite. */
  initialRoleId?: string;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const optionValue = (option: InviteRoleOption) =>
  option.kind === "role" ? option.id : `template:${option.key}`;

export const seatsLabel = ({ used, limit }: Props["seats"]) =>
  limit === null ? `${used} seats used` : `${used} of ${limit} seats used`;

/** TM-REQ-002 / RP-REQ-007: invite someone by email with one of the company's roles. */
export default function InviteDialog({ ownerEmail, seats, roles, canCreateRole = false, initialRoleId }: Props) {
  const router = useRouter();
  const initialOption = roles.find((r) => r.kind === "role" && r.id === initialRoleId);
  const [open, setOpen] = useState(Boolean(initialOption));
  const [email, setEmail] = useState("");
  const defaultOption = initialOption ?? roles.find((r) => r.kind === "role" && r.isDefault) ?? roles[0];
  const [value, setValue] = useState(defaultOption ? optionValue(defaultOption) : "");
  const selected = roles.find((r) => optionValue(r) === value);
  const existing = roles.filter((r) => r.kind === "role");
  const templates = roles.filter((r) => r.kind === "template");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const full = seats.limit !== null && seats.used >= seats.limit;
  const valid = EMAIL.test(email.trim());

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Opened from ?invite=<role id>: drop it so a reload doesn't reopen.
    if (!next && initialRoleId) router.replace("/company/settings/team", { scroll: false });
  };
  const notice = valid ? domainNotice(ownerEmail, email) : null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return setError("Enter a valid email address.");
    setBusy(true);
    setError(null);
    try {
      const result = await inviteMemberAction({
        email,
        ...(selected?.kind === "role" ? { roleId: selected.id } : {}),
        ...(selected?.kind === "template" ? { templateKey: selected.key } : {}),
      });
      if (!result.ok) {
        setError(
          typeof result.error === "string"
            ? result.error
            : result.error.message,
        );
        return;
      }
      toast.success(`Invite sent to ${result.invite.email}.`);
      onOpenChange(false);
      setEmail("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted-foreground">{seatsLabel(seats)}</span>
      {full && (
        <Link
          href="/company/billing"
          className="text-sm font-medium underline underline-offset-4 hover:text-brand"
        >
          Upgrade for more seats
        </Link>
      )}
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogTrigger asChild>
          <Button variant="brand" disabled={full}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite
          </Button>
        </ResponsiveDialogTrigger>
        <ResponsiveDialogContent>
          <form
            onSubmit={onSubmit}
            noValidate
            className="flex min-h-0 flex-col gap-4"
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Invite a teammate</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                They get an email with a link that works once and expires in 7
                days.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  aria-invalid={!!error && !valid}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {notice && (
                  <p className="text-sm text-muted-foreground">{notice}</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={value} onValueChange={setValue}>
                  <SelectTrigger id="invite-role" aria-label="Role">
                    <SelectValue placeholder="Choose a role">{selected?.name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)]">
                    <SelectGroup>
                      {templates.length > 0 && <SelectLabel>Your roles</SelectLabel>}
                      {existing.map((role) => (
                        <RoleItem key={optionValue(role)} option={role} />
                      ))}
                    </SelectGroup>
                    {templates.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>New role from a template</SelectLabel>
                        {templates.map((role) => (
                          <RoleItem key={optionValue(role)} option={role} />
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                {selected?.kind === "template" && (
                  <p className="text-xs text-muted-foreground">
                    Sending the invite adds the {selected.name} role to your company. You can edit it later.
                  </p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link
                    href="/company/settings/team#role-permissions"
                    className="w-fit text-xs text-muted-foreground underline underline-offset-4 hover:text-brand"
                  >
                    See what each role can do
                  </Link>
                  {canCreateRole && (
                    <Link
                      href={NEW_ROLE_FOR_INVITE_HREF}
                      className="w-fit text-xs text-muted-foreground underline underline-offset-4 hover:text-brand"
                    >
                      Create a custom role
                    </Link>
                  )}
                </div>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button type="submit" variant="brand" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send invite
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}

function RoleItem({ option }: { option: InviteRoleOption }) {
  return (
    <SelectItem value={optionValue(option)}>
      <span className="flex flex-col gap-0.5 whitespace-normal">
        <span>{option.name}</span>
        {option.description && (
          <span className="text-xs text-muted-foreground">{option.description}</span>
        )}
      </span>
    </SelectItem>
  );
}
