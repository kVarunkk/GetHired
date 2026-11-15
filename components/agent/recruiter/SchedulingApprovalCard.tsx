"use client";

import { useEffect, useState } from "react";
import { previewAgentSchedulingAction } from "@/app/actions/interviews/preview-agent-scheduling";
import {
  isSchedulingPreviewTool,
  schedulingApprovalTitle,
  type SchedulingPreview,
} from "@/helpers/interviews/agent-scheduling-schema";

export { isSchedulingPreviewTool, schedulingApprovalTitle };

const formatTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
};

/**
 * What a recruiter agent scheduling call would do, for its approval card:
 * who, which interview, when, who's emailed. The preview comes from the
 * server and writes nothing; times show in the viewer's time zone.
 */
export function SchedulingApprovalDetails({ tool, input }: { tool: string; input: unknown }) {
  const [preview, setPreview] = useState<SchedulingPreview | null>(null);
  const key = JSON.stringify(input ?? null);

  useEffect(() => {
    let cancelled = false;
    previewAgentSchedulingAction(tool, JSON.parse(key))
      .then((result) => !cancelled && setPreview(result))
      .catch(() => !cancelled && setPreview({ ok: false, error: "Couldn't load the preview." }));
    return () => {
      cancelled = true;
    };
  }, [tool, key]);

  if (!preview) return <p className="text-xs text-muted-foreground">Loading the preview…</p>;
  if (!preview.ok) return <p className="text-xs text-destructive">This won&apos;t go through: {preview.error}</p>;

  return (
    <div className="flex flex-col gap-2 text-xs">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {preview.rows.map((row, i) => (
          <div key={`${row.label}-${i}`} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="break-words text-foreground">{row.time ? formatTime(row.value) : row.value}</dd>
          </div>
        ))}
      </dl>
      {preview.notices.map((notice) => (
        <p key={notice} className="text-muted-foreground">
          {notice}
        </p>
      ))}
      {preview.warning && <p className="text-destructive">{preview.warning}</p>}
    </div>
  );
}
