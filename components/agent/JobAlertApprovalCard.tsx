"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { previewAgentJobAlertAction } from "@/app/actions/job-alerts/preview-agent-job-alert";
import type { JobAlertPreview, JobAlertTool } from "@/helpers/job-alerts/preview";
import { inlineLink, NEW_TAB } from "./links";

const FREQUENCY = { daily: "Daily", weekly: "Weekly, on Mondays" } as const;

/**
 * What a proposed job alert call will do, for its approval card. For a new
 * alert: its name, how often it's emailed and a few jobs it matches now. For a
 * change: what it is now and what it becomes. The preview comes from the server
 * with the same checks as the call, so one that would fail says so here first.
 */
export function JobAlertApprovalDetails({ tool, input }: { tool: JobAlertTool; input: unknown }) {
  const [preview, setPreview] = useState<JobAlertPreview | null>(null);
  const key = JSON.stringify(input ?? null);

  useEffect(() => {
    let cancelled = false;
    previewAgentJobAlertAction(tool, JSON.parse(key))
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't load the preview." }));
    return () => {
      cancelled = true;
    };
  }, [tool, key]);

  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) {
    return <p className="text-xs text-destructive">This won&apos;t go through: {preview.error}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Alert</dt>
        <dd className="break-words text-foreground">{preview.name}</dd>
        {preview.action === "create" ? (
          <>
            <dt className="text-muted-foreground">Emails</dt>
            <dd className="text-foreground">{FREQUENCY[preview.frequency]}</dd>
          </>
        ) : (
          preview.changes.map(({ label, before, after }) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-foreground">{before === after ? after : `${before} → ${after}`}</dd>
            </div>
          ))
        )}
      </dl>
      {preview.action === "create" && (
        <>
          {preview.existing && (
            <p className="text-xs text-muted-foreground">
              You already have this alert
              {preview.existing.on ? `, sent ${preview.existing.frequency}.` : ". It's paused, so this turns it on."}
            </p>
          )}
          <Sample sample={preview.sample} />
        </>
      )}
    </div>
  );
}

function Sample({ sample }: { sample: Extract<JobAlertPreview, { action: "create" }>["sample"] }) {
  if (!sample) return <p className="text-xs text-muted-foreground">Couldn&apos;t load matching jobs.</p>;
  if (sample.jobs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No jobs match right now. You&apos;ll get an email when new ones do.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-xs">
      <p className="text-muted-foreground">
        {sample.total === 1 ? "1 job matches now" : `${sample.total.toLocaleString("en-US")} jobs match now, such as`}
      </p>
      <ul className="flex flex-col gap-0.5">
        {sample.jobs.map((job) => (
          <li key={job.id} className="break-words text-foreground">
            <Link {...NEW_TAB} href={`/jobs/${job.id}`} className={inlineLink}>
              {job.title} at {job.company}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
