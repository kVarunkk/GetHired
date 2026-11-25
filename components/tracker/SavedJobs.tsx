"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import toast from "react-hot-toast";
import { Bookmark, ExternalLink, MapPin, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ConfirmDialog from "@/components/ConfirmDialog";
import JobItem from "@/components/JobItem";
import { setTrackedStatusAction } from "@/app/actions/tracker/set-tracked-status";
import { removeTrackedApplicationAction } from "@/app/actions/tracker/remove-tracked-application";
import { appliedJobFor } from "@/helpers/tracker/applied-state";
import { shortDate, todayIso } from "@/helpers/tracker/card";
import { jobUrlDomain } from "@/helpers/tracker/job-url";
import { addJobPath, trackedApplicationPath } from "@/helpers/tracker/paths";
import { filterByKeyword } from "@/helpers/tracker/search";
import type { SavedJobItem } from "@/helpers/tracker/types";
import type { AllJobWithRelations } from "@/utils/types";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";
import KeywordSearch from "./KeywordSearch";

type TrackedSaved = Extract<SavedJobItem, { kind: "tracked" }>;

/**
 * The Saved tab (AT-REQ-026): board jobs as the feed's job cards, and jobs
 * saved from elsewhere as compact cards, newest saved first. The keyword
 * search is the only filter.
 */
export default function SavedJobs({
  items,
  boardJobs,
  matchedIds,
  q,
}: {
  items: SavedJobItem[];
  boardJobs: AllJobWithRelations[];
  matchedIds: string[];
  q?: string | null;
}) {
  const jobsById = useMemo(() => new Map(boardJobs.map((job) => [job.id, job])), [boardJobs]);
  const matched = useMemo(() => new Set(matchedIds), [matchedIds]);

  const { data: currentUser } = useSWR(PROFILE_API_KEY, fetcher, { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 });
  const profile = currentUser?.profile;
  const favoriteIds = useMemo(
    () => new Set<string>((profile?.user_favorites ?? []).map((fav: { job_id: string }) => fav.job_id)),
    [profile],
  );
  const hasCredits = (profile?.ai_credits ?? 0) > 0;

  // A board job leaves the tab once its star is removed. Only jobs the profile
  // has shown as saved can drop out, so a stale cached profile hides nothing.
  const seenSaved = useRef(new Set<string>());
  for (const id of favoriteIds) seenSaved.current.add(id);
  const unsaved = (item: SavedJobItem) =>
    item.kind === "favorite" && seenSaved.current.has(item.allJobsId) && !favoriteIds.has(item.allJobsId);
  const visible = filterByKeyword(items, q).filter((item) => !unsaved(item));

  const boardIds = useMemo(() => boardJobs.map((job) => job.id), [boardJobs]);
  const { data: urls, isLoading: urlsLoading } = useSWR(
    boardIds.length > 0 ? ["/api/jobs/urls", boardIds.join(",")] : null,
    () =>
      fetch("/api/jobs/urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_ids: boardIds }),
      }).then((res) => res.json()),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );
  const urlById = useMemo(
    () => new Map<string, { job_url?: string | null; company_url?: string | null }>((urls ?? []).map((u: { id: string }) => [u.id, u])),
    [urls],
  );

  return (
    <div className="space-y-4">
      <KeywordSearch />
      {visible.length === 0 ? (
        <EmptySaved searching={Boolean(q?.trim())} />
      ) : (
        <div className="flex flex-col divide-y rounded-lg border">
          {visible.map((item) => {
            if (item.kind === "tracked") return <SavedTrackedCard key={`t:${item.id}`} item={item} />;
            const job = jobsById.get(item.allJobsId);
            if (!job) return null;
            const patch = urlById.get(job.id);
            return (
              <JobItem
                key={`f:${item.id}`}
                job={{ ...job, job_url: patch?.job_url ?? null, company_url: patch?.company_url ?? null }}
                userId={profile?.user_id ?? null}
                isSuitable={matched.has(job.id)}
                isCompanyUser={false}
                isOnboardingComplete={profile?.filled ?? false}
                // Unsaving is the user's choice: until the profile loads, it shows as saved.
                isFavorite={profile ? favoriteIds.has(job.id) : true}
                appliedJob={appliedJobFor(profile, job.id, Boolean(job.is_platform_job))}
                isLoading={urlsLoading}
                hasCredits={hasCredits}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptySaved({ searching }: { searching: boolean }) {
  if (searching) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No saved jobs match your search.</p>;
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <Bookmark className="h-6 w-6 text-muted-foreground" aria-hidden />
      <div>
        <p className="font-semibold">No saved jobs yet</p>
        <p className="text-sm text-muted-foreground">Save jobs from Discover, or add one you found somewhere else.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline">
          <Link href="/jobs">Go to Discover</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={addJobPath("saved")}>Add job</Link>
        </Button>
      </div>
    </div>
  );
}

/** A job saved from elsewhere: Open posting, Mark as applied, Edit, Remove. */
export function SavedTrackedCard({ item }: { item: TrackedSaved }) {
  const router = useRouter();
  const [appliedAt, setAppliedAt] = useState(todayIso());
  const [marking, setMarking] = useState(false);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const domain = jobUrlDomain(item.jobUrl);

  const markAsApplied = async () => {
    setMarking(true);
    const result = await setTrackedStatusAction({ id: item.id, status: "applied", appliedAt: appliedAt || null });
    setMarking(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setOpen(false);
    toast.success("Moved to Applications");
    router.refresh();
  };

  const remove = async () => {
    const result = await removeTrackedApplicationAction(item.id);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Removed from My Jobs.");
    router.refresh();
  };

  return (
    <article aria-label={`${item.jobTitle} at ${item.companyName}`} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-1">
        <Link href={trackedApplicationPath(item.id)} className="block truncate font-semibold hover:underline">
          {item.jobTitle}
        </Link>
        <p className="text-sm text-muted-foreground">{item.companyName}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {domain && <span>{domain}</span>}
          {item.location && (
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="h-3 w-3" aria-hidden />
              {item.location}
            </span>
          )}
          <span>Saved {shortDate(item.savedAt)}</span>
        </div>
        {item.notes && <p className="line-clamp-2 text-sm text-muted-foreground">{item.notes}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.jobUrl && (
          <Button asChild variant="ghost" size="sm">
            <a href={item.jobUrl} target="_blank" rel="noopener noreferrer nofollow">
              Open posting <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              Mark as applied
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 space-y-3">
            <div className="space-y-1">
              <Label htmlFor={`applied-${item.id}`}>Applied on</Label>
              <Input
                id={`applied-${item.id}`}
                type="date"
                value={appliedAt}
                max={todayIso()}
                onChange={(event) => setAppliedAt(event.target.value)}
              />
            </div>
            <Button size="sm" className="w-full" onClick={markAsApplied} disabled={marking}>
              Move to Applications
            </Button>
          </PopoverContent>
        </Popover>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${item.jobTitle}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={trackedApplicationPath(item.id)}>Edit</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setRemoving(true)}>
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove this saved job?"
        description="It's removed from My Jobs, with its notes. This can't be undone."
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </article>
  );
}
