"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, MapPin } from "lucide-react";
import MatchScoreBadge from "@/components/matching/MatchScoreBadge";
import { cn } from "@/utils/utils";
import { isInAppHref, NEW_TAB } from "../links";

// Result rows for the recruiter agent's tools (RA-REQ-008, RA spec §4.7).
// Rows link only into the app; candidate-provided URLs are never rendered.

export type CandidateRowData = {
  id: string;
  name: string | null;
  roles?: string[];
  experienceYears?: number | null;
  locations?: string[];
  salary?: string | null;
  matchScore?: number | null;
  url: string;
};

export type ApplicantRowData = {
  applicationId: string;
  name: string | null;
  job?: { id: string; title: string } | null;
  status: string;
  appliedAt?: string | null;
  fitScore?: number | null;
  url: string;
};

/** Longer lists start collapsed to this many rows. */
const COLLAPSED_COUNT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const ROW_CLASS =
  "flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none";

export const statusLabel = (status: string) =>
  status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");

function appliedAgo(appliedAt: string | null | undefined) {
  if (!appliedAt) return null;
  const days = Math.floor((Date.now() - new Date(appliedAt).getTime()) / DAY_MS);
  if (Number.isNaN(days) || days < 0) return null;
  if (days === 0) return "Today";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** A row that links into the app, or plain text when the URL isn't the app's. */
function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (!isInAppHref(href)) return <div className={ROW_CLASS}>{children}</div>;
  return (
    <Link {...NEW_TAB} href={href} className={ROW_CLASS}>
      {children}
    </Link>
  );
}

function Collapsible<T>({
  items,
  noun,
  render,
}: {
  items: T[];
  noun: [string, string];
  render: (item: T) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = items.length - COLLAPSED_COUNT;
  const visible = expanded ? items : items.slice(0, COLLAPSED_COUNT);

  return (
    <div className="overflow-hidden rounded-lg border">
      <ul className="divide-y">{visible.map(render)}</ul>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="flex w-full items-center justify-center gap-1.5 border-t px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:outline-none"
        >
          {expanded ? `Show fewer ${noun[1]}` : `Show ${hidden} more ${hidden === 1 ? noun[0] : noun[1]}`}
          <ChevronDown aria-hidden className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

/** Candidates as scannable rows: name, roles and experience, location, score. */
export function CandidateResults({ candidates }: { candidates: CandidateRowData[] }) {
  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">No candidates found.</p>;
  }

  return (
    <Collapsible
      items={candidates}
      noun={["candidate", "candidates"]}
      render={(candidate) => {
        const headline = [
          candidate.roles?.slice(0, 2).join(", "),
          candidate.experienceYears != null ? `${candidate.experienceYears} yrs` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={candidate.id}>
            <RowLink href={candidate.url}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">
                  {candidate.name ?? "Unnamed candidate"}
                </span>
                <span className="flex min-w-0 items-center gap-3 text-[13px] text-muted-foreground">
                  {headline && <span className="min-w-0 truncate">{headline}</span>}
                  {candidate.locations && candidate.locations.length > 0 && (
                    <span className="flex min-w-0 shrink-[3] items-center gap-1">
                      <MapPin aria-hidden className="h-3 w-3 shrink-0" />
                      <span className="truncate">{candidate.locations.join(", ")}</span>
                    </span>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <MatchScoreBadge score={candidate.matchScore} />
                {candidate.salary && (
                  <span className="text-xs tabular-nums text-muted-foreground">{candidate.salary}</span>
                )}
              </span>
            </RowLink>
          </li>
        );
      }}
    />
  );
}

/** Applications as rows: name, job and status, fit score, applied when. */
export function ApplicantResults({ applicants }: { applicants: ApplicantRowData[] }) {
  if (applicants.length === 0) {
    return <p className="text-sm text-muted-foreground">No applicants found.</p>;
  }

  return (
    <Collapsible
      items={applicants}
      noun={["applicant", "applicants"]}
      render={(applicant) => {
        const applied = appliedAgo(applicant.appliedAt);
        return (
          <li key={applicant.applicationId}>
            <RowLink href={applicant.url}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">
                  {applicant.name ?? "Applicant"}
                </span>
                <span className="truncate text-[13px] text-muted-foreground">
                  {[applicant.job?.title, statusLabel(applicant.status)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <MatchScoreBadge score={applicant.fitScore} />
                {applied && (
                  <span className="text-xs tabular-nums text-muted-foreground" suppressHydrationWarning>
                    {applied}
                  </span>
                )}
              </span>
            </RowLink>
          </li>
        );
      }}
    />
  );
}
