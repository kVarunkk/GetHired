"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import RoleBadge from "@/components/roles/RoleBadge";
import MemberAvatar from "@/components/team/MemberAvatar";
import { assignJobAction } from "@/app/actions/jobs/assign-job";
import { unassignJobAction } from "@/app/actions/jobs/unassign-job";
import type { HiringTeamsJob, HiringTeamsMember } from "@/helpers/team/list-company-hiring-teams";

type StatusFilter = "all" | HiringTeamsJob["status"];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All jobs" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const displayName = (m: HiringTeamsMember) => m.name ?? m.email ?? "Team member";
const cellKey = (jobId: string, userId: string) => `${jobId}:${userId}`;

function assignmentsOf(jobs: HiringTeamsJob[]): Set<string> {
  return new Set(jobs.flatMap((j) => j.assignedUserIds.map((u) => cellKey(j.id, u))));
}

/**
 * RP-REQ-011: every job the viewer can assign on against the members who can
 * be on a hiring team, one checkbox per pair. Owners aren't columns: they see
 * every job anyway. The flags come from `list_company_hiring_teams`, and the
 * RPCs check again.
 */
export default function HiringTeamsMatrix({
  jobs,
  members,
}: {
  jobs: HiringTeamsJob[];
  members: HiringTeamsMember[];
}) {
  const router = useRouter();
  const [assigned, setAssigned] = useState(() => assignmentsOf(jobs));
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  // A refresh brings the server's view (the viewer may have lost a job).
  useEffect(() => setAssigned(assignmentsOf(jobs)), [jobs]);

  // Members who can be assigned, plus anyone already on a listed job.
  const columns = useMemo(() => {
    const onAJob = new Set(jobs.flatMap((j) => j.assignedUserIds));
    return members.filter((m) => !m.isOwner && (m.assignable || onAJob.has(m.userId)));
  }, [jobs, members]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => (status === "all" || j.status === status) && (!q || j.title.toLowerCase().includes(q)));
  }, [jobs, query, status]);

  const jobCount = (userId: string) => jobs.filter((j) => assigned.has(cellKey(j.id, userId))).length;

  async function toggle(job: HiringTeamsJob, member: HiringTeamsMember, next: boolean) {
    const key = cellKey(job.id, member.userId);
    const flip = (on: boolean) =>
      setAssigned((prev) => {
        const copy = new Set(prev);
        if (on) copy.add(key);
        else copy.delete(key);
        return copy;
      });

    setPending((prev) => new Set(prev).add(key));
    flip(next);
    try {
      const input = { jobPostId: job.id, userId: member.userId };
      const result = next ? await assignJobAction(input) : await unassignJobAction(input);
      if (!result.ok) {
        flip(!next);
        toast.error(result.error);
        return;
      }
      toast.success(
        next ? `Added ${displayName(member)} to ${job.title}.` : `Removed ${displayName(member)} from ${job.title}.`,
      );
      router.refresh();
    } catch {
      flip(!next);
      toast.error("Something went wrong. Try again.");
    } finally {
      setPending((prev) => {
        const copy = new Set(prev);
        copy.delete(key);
        return copy;
      });
    }
  }

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-sm text-muted-foreground">
        There are no jobs you can change the hiring team of yet.
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-sm text-muted-foreground">
        Nobody can be assigned to jobs yet. Only members whose role has job-level permissions can be on a hiring
        team.{" "}
        <Link href="/company/settings/team" className="underline underline-offset-4 hover:text-brand">
          Go to the team
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex items-center sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 z-10 h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs"
            aria-label="Search jobs"
            className="pl-8"
          />
        </div>
        <div role="group" aria-label="Job status" className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={status === f.value ? "secondary" : "ghost"}
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-[12rem] bg-background px-3 py-2 text-left font-medium text-muted-foreground"
              >
                Job
              </th>
              {columns.map((m) => (
                <th key={m.userId} scope="col" className="min-w-[7.5rem] px-2 py-2 text-center align-bottom font-normal">
                  <div className="flex flex-col items-center gap-1">
                    <MemberAvatar name={m.name} email={m.email} />
                    <span className="max-w-[7rem] truncate text-xs font-medium" title={m.email ?? undefined}>
                      {displayName(m)}
                    </span>
                    <RoleBadge role={m.role} className="max-w-[7rem] truncate text-[10px]" />
                    <span className="text-[11px] text-muted-foreground">
                      {jobCount(m.userId)} {jobCount(m.userId) === 1 ? "job" : "jobs"}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                  No jobs match.
                </td>
              </tr>
            ) : (
              rows.map((job) => (
                <tr key={job.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-normal">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href={`/company/job-posts/${job.id}`}
                        className="max-w-[16rem] truncate font-medium hover:text-brand"
                      >
                        {job.title}
                      </Link>
                      {job.status === "inactive" && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </div>
                  </th>
                  {columns.map((m) => {
                    const key = cellKey(job.id, m.userId);
                    const on = assigned.has(key);
                    const locked = on ? !m.removable : !m.assignable;
                    const reason = !locked
                      ? undefined
                      : on || !m.removable
                        ? "Their role has permissions you don't"
                        : "Their role has no job-level permissions";
                    return (
                      <td key={m.userId} className="px-2 py-2 text-center" title={reason}>
                        <Checkbox
                          checked={on}
                          disabled={locked || pending.has(key)}
                          aria-label={`${displayName(m)} on ${job.title}`}
                          onCheckedChange={(v) => void toggle(job, m, v === true)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
