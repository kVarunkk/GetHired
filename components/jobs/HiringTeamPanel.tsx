"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ChevronsUpDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import RoleBadge from "@/components/roles/RoleBadge";
import MemberAvatar from "@/components/team/MemberAvatar";
import { assignJobAction } from "@/app/actions/jobs/assign-job";
import { unassignJobAction } from "@/app/actions/jobs/unassign-job";
import type { HiringTeamMember } from "@/helpers/team/list-job-hiring-team";

const displayName = (m: HiringTeamMember) => m.name ?? m.email ?? "Team member";

/**
 * RP-REQ-011: who is assigned to a job (the job's Hiring team page). A role whose permissions are limited
 * to "Assigned jobs" only reaches the jobs its members are on here. Only
 * rendered for viewers with jobs.assign on the job; the RPCs check again.
 */
export default function HiringTeamPanel({
  jobPostId,
  members,
}: {
  jobPostId: string;
  members: HiringTeamMember[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const assigned = members.filter((m) => m.assigned);
  const candidates = members.filter((m) => !m.assigned && m.assignable);
  const chosen = candidates.filter((m) => selected.includes(m.userId));

  function toggle(userId: string) {
    setSelected((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  async function run(key: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setBusy(key);
    try {
      const result = await action();
      if (!result.ok) return void toast.error(result.error);
      toast.success(success);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  /** Adds each chosen member in turn; the RPC checks every one on its own. */
  async function addChosen() {
    if (chosen.length === 0) return;
    setBusy("add");
    const added: HiringTeamMember[] = [];
    const failed: string[] = [];
    try {
      for (const member of chosen) {
        const result = await assignJobAction({ jobPostId, userId: member.userId });
        if (result.ok) added.push(member);
        else failed.push(`${displayName(member)}: ${result.error}`);
      }
    } finally {
      setBusy(null);
    }
    if (added.length > 0) {
      toast.success(
        added.length === 1 ? `Added ${displayName(added[0])}.` : `Added ${added.length} members to the hiring team.`,
      );
    }
    for (const message of failed) toast.error(message);
    // Keep the ones that failed selected, so they can be retried.
    setSelected((prev) => prev.filter((id) => !added.some((m) => m.userId === id)));
    if (added.length > 0) router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
        {assigned.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is assigned to this job yet.</p>
        ) : (
          <ul aria-label="Assigned members" className="flex flex-col divide-y rounded-lg border">
            {assigned.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 px-3 py-2">
                <MemberAvatar name={m.name} email={m.email} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{displayName(m)}</p>
                  {m.name && m.email && <p className="truncate text-xs text-muted-foreground">{m.email}</p>}
                </div>
                <RoleBadge role={m.role} owner={m.isOwner} className="hidden sm:inline-flex" />
                {m.removable ? (
                  <Button
                    variant="destructive-ghost"
                    size="sm"
                    disabled={busy !== null}
                    aria-label={`Remove ${displayName(m)}`}
                    onClick={() =>
                      run(
                        `remove:${m.userId}`,
                        () => unassignJobAction({ jobPostId, userId: m.userId }),
                        `Removed ${displayName(m)}.`,
                      )
                    }
                  >
                    Remove
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground" title="Their role has permissions you don't">
                    Can&apos;t remove
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {candidates.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  aria-label="Team members to add"
                  disabled={busy !== null}
                  className="w-full justify-between font-normal sm:max-w-xs"
                >
                  <span className={chosen.length === 0 ? "truncate text-muted-foreground" : "truncate"}>
                    {chosen.length === 0
                      ? "Choose team members"
                      : chosen.length === 1
                        ? displayName(chosen[0])
                        : `${chosen.length} members selected`}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search team members..." />
                  <CommandList>
                    <CommandEmpty>No team members found.</CommandEmpty>
                    <CommandGroup>
                      {candidates.map((m) => {
                        const checked = selected.includes(m.userId);
                        return (
                          <CommandItem
                            key={m.userId}
                            value={`${displayName(m)} ${m.email ?? ""} ${m.userId}`}
                            onSelect={() => toggle(m.userId)}
                            aria-selected={checked}
                            className="cursor-pointer"
                          >
                            <Checkbox checked={checked} tabIndex={-1} aria-hidden className="pointer-events-none" />
                            <span className="truncate">
                              {displayName(m)}
                              {m.role ? ` · ${m.role.name}` : ""}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <Button variant="outline" disabled={chosen.length === 0 || busy !== null} onClick={() => void addChosen()}>
              <UserPlus className="h-4 w-4" />
              {chosen.length > 1 ? `Add ${chosen.length} to hiring team` : "Add to hiring team"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No one else can be added. Only members whose role has job-level permissions can be assigned.
          </p>
        )}
    </div>
  );
}
