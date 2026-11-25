"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarClock, Lock, MapPin, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveMenu,
  ResponsiveMenuItem,
  ResponsiveMenuSeparator,
  ResponsiveMenuSub,
} from "@/components/ui/responsive-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { appliedAgo, isFollowUpDue, shortDate, sourceMark } from "@/helpers/tracker/card";
import { trackedApplicationPath } from "@/helpers/tracker/paths";
import { APPLIED_STATUSES, suggestsGhosted, trackedStatusLabel, type AppliedStatus } from "@/helpers/tracker/status";
import type { TrackerItem } from "@/helpers/tracker/types";
import { cn } from "@/utils/utils";

export const LOCKED_TOOLTIP = "The company updates this status.";

/** The badge on a card whose board job the company has closed. */
export const JOB_CLOSED_LABEL = "Posting closed";
export const JOB_CLOSED_TOOLTIP = "The company is no longer taking applications. Your application is unchanged.";

/** A card's page. An old external row has none until it's moved, so it opens its board job. */
export const cardHref = (item: TrackerItem) =>
  item.legacy && item.allJobsId ? `/jobs/${item.allJobsId}` : trackedApplicationPath(item.id);

/**
 * One application on the board or in the mobile list (AT-REQ-016,
 * AT-REQ-017, AT-REQ-022). GetHired cards are locked; tracked cards have
 * Move to…, Edit and Remove.
 */
export default function TrackerCard({
  item,
  onMove,
  onRemove,
  handle,
  now = new Date(),
}: {
  item: TrackerItem;
  onMove: (status: AppliedStatus) => void;
  onRemove: () => void;
  /** The drag handle on desktop. */
  handle?: ReactNode;
  now?: Date;
}) {
  const locked = item.kind === "gethired";
  const source = sourceMark(item);
  const followUpDue = isFollowUpDue(item.nextFollowUpAt, now);
  const ghosted = item.kind === "tracked" && item.status !== null && suggestsGhosted(item.status, item.statusChangedAt, now);

  return (
    <article
      aria-label={`${item.jobTitle} at ${item.companyName}`}
      className="flex min-w-0 items-start gap-2 overflow-hidden rounded-md border bg-background p-3 text-sm"
    >
      {handle}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">{item.companyName}</p>
            <Link href={cardHref(item)} className="line-clamp-2 break-words font-medium leading-snug hover:underline">
              {item.jobTitle}
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {locked && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} aria-label={LOCKED_TOOLTIP} className="text-muted-foreground">
                      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{LOCKED_TOOLTIP}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <CardMenu item={item} onMove={onMove} onRemove={onRemove} />
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">{appliedAgo(item.appliedAt, now)}</span>
          {source && <span className="max-w-full truncate">{source}</span>}
          {item.location && (
            <span className="inline-flex max-w-full min-w-0 items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{item.location}</span>
            </span>
          )}
          {item.nextFollowUpAt && (
            <span
              className={cn("inline-flex max-w-full items-center gap-1 whitespace-nowrap", followUpDue && "font-medium text-destructive")}
              title={followUpDue ? "Follow-up due" : "Follow-up"}
            >
              <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
              Follow up {shortDate(item.nextFollowUpAt, now)}
            </span>
          )}
        </div>

        {(item.column === "closed" || item.onHold || item.jobClosed) && (
          <div className="flex flex-wrap gap-1">
            {item.column === "closed" && (
              <Badge variant="outline" className="px-1.5 py-0 font-normal">
                {item.statusLabel}
              </Badge>
            )}
            {item.onHold && (
              <Badge variant="outline" className="px-1.5 py-0 font-normal">
                On hold
              </Badge>
            )}
            {item.jobClosed && (
              <Badge variant="outline" className="px-1.5 py-0 font-normal text-muted-foreground" title={JOB_CLOSED_TOOLTIP}>
                {JOB_CLOSED_LABEL}
              </Badge>
            )}
          </div>
        )}

        {ghosted && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-2 py-1 text-xs">
            <span className="text-muted-foreground">No reply in 30 days. Mark as ghosted?</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onMove("ghosted")}>
              Mark as ghosted
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

function CardMenu({ item, onMove, onRemove }: { item: TrackerItem; onMove: (status: AppliedStatus) => void; onRemove: () => void }) {
  return (
    <ResponsiveMenu
      title={item.jobTitle}
      description={item.companyName}
      trigger={
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 sm:h-6 sm:w-6" aria-label={`Actions for ${item.jobTitle}`}>
          <MoreHorizontal className="h-4 w-4 shrink-0" />
        </Button>
      }
    >
      {item.kind === "gethired" ? (
        <>
          {item.allJobsId && (
            <ResponsiveMenuItem asChild>
              <Link href={`/jobs/${item.allJobsId}`}>View job</Link>
            </ResponsiveMenuItem>
          )}
          <ResponsiveMenuItem asChild>
            <Link href={trackedApplicationPath(item.id)}>Add a note or follow-up</Link>
          </ResponsiveMenuItem>
          {item.screeningInterviewId && (
            <ResponsiveMenuItem asChild>
              <Link href={`/interview/screening/${item.screeningInterviewId}`}>Open AI interview</Link>
            </ResponsiveMenuItem>
          )}
        </>
      ) : (
        <>
          <ResponsiveMenuSub label="Move to…">
            {APPLIED_STATUSES.filter((status) => status !== item.status).map((status) => (
              <ResponsiveMenuItem key={status} onClick={() => onMove(status)}>
                {trackedStatusLabel(status)}
              </ResponsiveMenuItem>
            ))}
          </ResponsiveMenuSub>
          {!item.legacy && (
            <>
              <ResponsiveMenuSeparator />
              <ResponsiveMenuItem asChild>
                <Link href={trackedApplicationPath(item.id)}>Edit</Link>
              </ResponsiveMenuItem>
            </>
          )}
          <ResponsiveMenuSeparator />
          <ResponsiveMenuItem destructive onClick={onRemove}>
            Remove
          </ResponsiveMenuItem>
        </>
      )}
    </ResponsiveMenu>
  );
}
