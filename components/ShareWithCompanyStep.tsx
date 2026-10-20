"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Mic, Sparkles } from "lucide-react";
import {
  listShareableSignalsAction,
  type ShareableSignals,
} from "@/app/actions/applications/attachments";
import { cn } from "@/utils/utils";

export type ShareSelection = { sessionId: string | null; reviewId: string | null };

function Option({
  selected,
  onClick,
  title,
  detail,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  detail: string | null;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-start text-sm transition-colors",
        selected ? "border-brand bg-brand/5" : "hover:bg-muted/60",
      )}
    >
      <span className="min-w-0 truncate font-medium">{title}</span>
      {detail && <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>}
    </button>
  );
}

/**
 * "Share with this company (optional)" in the application form (OR-REQ-030):
 * one completed mock interview and/or one completed resume review. Nothing
 * is shared unless picked. Also suggests a mock interview (OR-REQ-033).
 */
export default function ShareWithCompanyStep({
  allJobsId,
  value,
  onChange,
}: {
  allJobsId: string;
  value: ShareSelection;
  onChange: (next: ShareSelection) => void;
}) {
  const [signals, setSignals] = useState<ShareableSignals | null>(null);

  useEffect(() => {
    let active = true;
    listShareableSignalsAction()
      .then((result) => active && setSignals(result))
      .catch(() => active && setSignals({ sessions: [], reviews: [] }));
    return () => {
      active = false;
    };
  }, []);

  const interviewHref = `/interview?create=true&jobUrl=${encodeURIComponent(`/jobs/${allJobsId}`)}`;

  return (
    <section className="space-y-3 rounded-xl border p-4" aria-labelledby="share-with-company">
      <div className="space-y-1">
        <h4 id="share-with-company" className="text-sm font-semibold">
          Share with this company (optional)
        </h4>
        <p className="text-xs text-muted-foreground">
          The company sees an AI report of what you pick, never the interview transcript. You can
          remove it until they open it.
        </p>
      </div>

      {!signals ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {signals.sessions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Mock interview</p>
              {signals.sessions.map((s) => (
                <Option
                  key={s.id}
                  selected={value.sessionId === s.id}
                  onClick={() => onChange({ ...value, sessionId: value.sessionId === s.id ? null : s.id })}
                  title={s.label}
                  detail={s.endedAt ? new Date(s.endedAt).toLocaleDateString() : null}
                />
              ))}
            </div>
          )}

          {signals.reviews.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Resume review</p>
              {signals.reviews.map((r) => (
                <Option
                  key={r.id}
                  selected={value.reviewId === r.id}
                  onClick={() => onChange({ ...value, reviewId: value.reviewId === r.id ? null : r.id })}
                  title={r.label}
                  detail={r.score !== null ? `Score ${r.score}` : null}
                />
              ))}
            </div>
          )}

          {signals.sessions.length === 0 && (
            <Link
              href={interviewHref}
              className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm transition-colors hover:bg-muted/60"
            >
              <Sparkles className="h-4 w-4 text-brand" aria-hidden />
              <span>
                <span className="font-medium">Stand out: share a 10-minute AI interview</span>
                <span className="block text-xs text-muted-foreground">
                  Practise for this role, then share it with your next application.
                </span>
              </span>
              <Mic className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden />
            </Link>
          )}
        </>
      )}
    </section>
  );
}
