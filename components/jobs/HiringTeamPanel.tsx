"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [selected, setSelected] = useState("");

  const assigned = members.filter((m) => m.assigned);
  const candidates = members.filter((m) => !m.assigned && m.assignable);

  async function run(key: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setBusy(key);
    try {
      const result = await action();
      if (!result.ok) return void toast.error(result.error);
      toast.success(success);
      setSelected("");
      router.refresh();
    } finally {
      setBusy(null);
    }
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
            <Select value={selected} onValueChange={setSelected} disabled={busy !== null}>
              <SelectTrigger aria-label="Team member to add" className="sm:max-w-xs">
                <SelectValue placeholder="Choose a team member" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {displayName(m)}
                    {m.role ? ` · ${m.role.name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!selected || busy !== null}
              onClick={() => {
                const member = candidates.find((m) => m.userId === selected);
                if (!member) return;
                void run(
                  "add",
                  () => assignJobAction({ jobPostId, userId: member.userId }),
                  `Added ${displayName(member)}.`,
                );
              }}
            >
              <UserPlus className="h-4 w-4" />
              Add to hiring team
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
