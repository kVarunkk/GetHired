"use client";

import { useState } from "react";
import { Bot, Check, Loader2, Minus, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/utils/utils";
import type { ApplicationInterviewView, InterviewAttempt } from "@/helpers/interview/screening/application-interview";

const END_REASON_LABELS: Record<string, string> = {
  completed: "Interviewer finished",
  time_limit: "Time limit reached",
  inactivity: "Candidate went quiet",
  client_disconnect: "Connection dropped",
  error: "Technical error",
  no_callback: "No transcript received",
};

/** What the company sees before there's a report. */
const STATUS_COPY: Record<string, string> = {
  invited: "Invited. Waiting for the applicant to take the interview.",
  paused: "The applicant asked for an alternative format. The deadline is paused until you extend, waive or cancel.",
  in_progress: "The applicant is taking the interview now.",
  expired: "The deadline passed before the interview was taken.",
  declined: "The applicant declined the interview. Their application stands.",
  cancelled: "The interview was cancelled.",
  withdrawn: "The application was withdrawn.",
};

const formatDuration = (seconds: number | null) => {
  if (seconds === null) return "–";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const turnElementId = (turnId: number) => `interview-turn-${turnId}`;

/**
 * The applicant page's AI interview tab (SI-REQ-031/033, SIT-063): status
 * and attempts, the evidence-linked report and the transcript. Labelled as
 * AI-generated; no recommendation (SI-GUD-001).
 */
export default function InterviewReport({ interview }: { interview: ApplicationInterviewView }) {
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const report = interview.report?.result ?? null;
  const transcriptAttempt =
    interview.attempts.find((a) => a.id === interview.report?.sessionId) ?? interview.attempts.at(-1) ?? null;

  const showTurn = (turnId: number) => {
    document.getElementById(turnElementId(turnId))?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(turnId);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">AI interview</CardTitle>
            <Badge variant="outline" className="font-normal">
              AI-generated, verify before deciding
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {interview.durationMinutes}-minute voice interview · invited {formatDate(interview.createdAt)} · attempts{" "}
            {interview.attemptsUsed} of {interview.maxAttempts}
            {interview.status === "invited" || interview.status === "paused"
              ? ` · due ${formatDate(interview.deadlineAt)}`
              : ""}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {interview.status !== "completed" ? (
            <div className="space-y-2">
              <p className="text-sm">{STATUS_COPY[interview.status] ?? interview.status}</p>
              {interview.status === "paused" && interview.accommodationRequest && (
                <blockquote className="rounded-lg border border-border p-3 text-sm whitespace-pre-wrap">
                  {interview.accommodationRequest}
                </blockquote>
              )}
            </div>
          ) : !interview.report ? (
            <p className="text-sm font-medium">Interview incomplete (technical)</p>
          ) : !report ? (
            interview.report.status === "failed" ? (
              <p className="text-sm">Couldn&apos;t generate the report. We&apos;ll keep trying.</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Preparing the report. It&apos;s usually ready within a few
                minutes.
              </p>
            )
          ) : (
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-semibold tabular-nums">
                {report.overallScore === null ? "–" : `${report.overallScore.toFixed(1)} / 5`}
              </span>
              <span className="text-sm text-muted-foreground">
                {report.overallScore === null ? "No competency could be assessed" : "average of the assessed competencies"}
              </span>
            </div>
          )}

          {interview.attempts.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">Attempts</h4>
              <ul aria-label="Attempts" className="space-y-1 text-sm">
                {interview.attempts.map((attempt, i) => (
                  <AttemptRow key={attempt.id} attempt={attempt} n={i + 1} />
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {report && (
        <>
          {report.summary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{report.summary}</p>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {report.competencies.map((competency) => (
              <section
                key={competency.name}
                aria-label={competency.name}
                className="space-y-2 rounded-xl border border-border p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold">{competency.name}</h4>
                  {competency.score === null ? (
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      Not assessed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="tabular-nums">
                      {competency.score} / 5
                    </Badge>
                  )}
                </div>
                {competency.rationale && <p className="text-sm text-muted-foreground">{competency.rationale}</p>}
                {competency.evidence.length > 0 && (
                  <ul className="space-y-1">
                    {competency.evidence.map((e, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => showTurn(e.turnId)}
                          className="w-full rounded-md border-l-2 border-border bg-muted/40 px-3 py-1.5 text-left text-sm hover:bg-muted"
                        >
                          &ldquo;{e.quote}&rdquo;
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          {report.questionCoverage.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Must-ask questions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {report.questionCoverage.map((q, i) => (
                    <li key={i} className="flex items-start justify-between gap-3">
                      <span>{q.question}</span>
                      {q.asked ? (
                        q.turnId !== null ? (
                          <button
                            type="button"
                            onClick={() => showTurn(q.turnId!)}
                            className="flex shrink-0 items-center gap-1 text-success hover:underline"
                          >
                            <Check className="h-4 w-4" /> Asked
                          </button>
                        ) : (
                          <span className="flex shrink-0 items-center gap-1 text-success">
                            <Check className="h-4 w-4" /> Asked
                          </span>
                        )
                      ) : (
                        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                          <Minus className="h-4 w-4" /> Not asked
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <ListCard title="Strengths" items={report.strengths} />
            <ListCard title="Concerns" items={report.concerns} />
            <ListCard title="Follow-up questions" items={report.followUpQuestions} />
          </div>
        </>
      )}

      {transcriptAttempt && transcriptAttempt.turns.length > 0 && (
        <section aria-label="Transcript" className="space-y-3 rounded-xl border border-border p-4">
          <h4 className="font-semibold">Transcript</h4>
          <ol className="space-y-3">
            {transcriptAttempt.turns.map((turn) => (
              <li
                key={turn.turn_id}
                id={turnElementId(turn.turn_id)}
                className={cn(
                  "space-y-2 rounded-lg p-2 transition-colors",
                  highlighted === turn.turn_id && "bg-brandSoft",
                )}
              >
                {turn.assistant && (
                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Bot className="mt-0.5 h-4 w-4 shrink-0" aria-label="Interviewer" />
                    <span>{turn.assistant}</span>
                  </p>
                )}
                {turn.user && (
                  <p className="flex items-start gap-2 text-sm">
                    <User className="mt-0.5 h-4 w-4 shrink-0" aria-label="Candidate" />
                    <span>{turn.user}</span>
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Screening signal only. The scores come from an AI reading of the transcript and can be wrong. Read the
        evidence and the transcript, and make the decision yourself.
      </p>
    </div>
  );
}

function AttemptRow({ attempt, n }: { attempt: InterviewAttempt; n: number }) {
  return (
    <li className="flex flex-wrap justify-between gap-2 text-muted-foreground">
      <span>
        Attempt {n} · {formatDate(attempt.startedAt)}
      </span>
      <span>
        {attempt.endReason ? (END_REASON_LABELS[attempt.endReason] ?? attempt.endReason) : "In progress"} ·{" "}
        {formatDuration(attempt.durationSeconds)}
      </span>
    </li>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None noted.</p>
        )}
      </CardContent>
    </Card>
  );
}
