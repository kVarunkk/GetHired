"use client";

import type { InterviewAnalysisResult } from "@/helpers/interview/interview-analysis";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Clock3, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import ModifiedLink from "./ModifiedLink";

type SessionReportLink = {
  id: string;
  startedAt: string;
  status: string;
};

type TranscriptTurn = {
  id: string;
  user?: string;
  assistant?: string;
};

export function InterviewAnalysisReport({
  interviewId,
  interviewName,
  sessionId,
  sessionStartedAt,
  sessionEndedAt,
  sessionStatus,
  transcript,
  analysisStatus,
  result,
  sessions,
}: {
  interviewId: string;
  interviewName: string;
  sessionId: string;
  sessionStartedAt: string;
  sessionEndedAt: string | null;
  sessionStatus: string;
  transcript: TranscriptTurn[];
  analysisStatus: string | null;
  result: InterviewAnalysisResult | null;
  sessions: SessionReportLink[];
}) {
  const router = useRouter();
  const pending =
    analysisStatus === "queued" || analysisStatus === "processing";
  const sessionNumber =
    sessions.findIndex((session) => session.id === sessionId) + 1;

  useEffect(() => {
    if (!pending) return;
    const interval = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [pending, router]);

  return (
    <main className="mb-20 flex w-full flex-col gap-6 p-4">
      <Link
        href={`/interview/${interviewId}`}
        aria-label="Back to interview"
        className="w-fit rounded-md p-2 pl-0 text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>

      <header className="mt-1 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">
            Interview analysis
          </h1>
          <p className="text-sm text-muted-foreground">{interviewName}</p>

          <p className="mt-2 text-sm text-muted-foreground">
            Session {sessionNumber || 1} ·{" "}
            <LocalDateTime value={sessionStartedAt} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ModifiedLink href={`/interview/${interviewId}`}>
            <Button>
              View interview
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </ModifiedLink>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          {sessionStatus === "ineligible" ? (
            <Card aria-live="polite">
              <CardHeader>
                <CardTitle className="text-xl">
                  Not enough interview content
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  This session needs at least three candidate responses and
                  three interviewer questions before an analysis can be
                  generated. Your interview transcript is still saved.
                </p>
              </CardContent>
            </Card>
          ) : pending ? (
            <Card aria-live="polite">
              <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <CardTitle className="text-xl">Analysis in progress</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  We’re reviewing your interview answers. This page will update
                  automatically when your feedback is ready.
                </p>
              </CardContent>
            </Card>
          ) : analysisStatus === "failed" ? (
            <Card aria-live="polite">
              <CardHeader>
                <CardTitle className="text-xl">
                  Analysis couldn’t be completed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  Your transcript is saved. Please try again later or contact
                  support if this continues.
                </p>
              </CardContent>
            </Card>
          ) : result ? (
            <>
              <Card>
                <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                  <CardTitle className="text-xl">Overall feedback</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-line leading-7">
                    {result.overall_feedback}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-xl">Your strengths</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="grid gap-4 sm:grid-cols-2">
                    {result.strengths.map((item, index) => (
                      <li
                        key={`${item.title}-${index}`}
                        className="rounded-lg  bg-background p-4"
                      >
                        <h3 className="font-semibold">{item.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {item.evidence}
                        </p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-xl">Areas to improve</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="grid gap-4">
                    {result.improvement_areas.map((item, index) => (
                      <li
                        key={`${item.title}-${index}`}
                        className="rounded-lg  bg-background p-4"
                      >
                        <h3 className="font-semibold">{item.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {item.evidence}
                        </p>
                        <p className="mt-3 text-sm leading-6">
                          <span className="font-medium">Try this: </span>
                          {item.suggestion}
                        </p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                  <CardTitle className="text-xl">Practice tips</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="grid gap-3 sm:grid-cols-2">
                    {result.practice_tips.map((tip, index) => (
                      <li
                        key={`${tip}-${index}`}
                        className="flex gap-3 rounded-lg  bg-background p-4"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                          {index + 1}
                        </span>
                        <span className="text-sm leading-6">{tip}</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">
                  Analysis is not available
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  No candidate analysis has been created for this session.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Interview transcript</CardTitle>
              <p className="text-sm text-muted-foreground">
                Full conversation from this session.
              </p>
            </CardHeader>
            <CardContent className="max-h-[32rem] overflow-y-auto">
              {transcript.length > 0 ? (
                <ol className="grid gap-4">
                  {transcript.map((turn) => (
                    <li key={turn.id} className="grid gap-3">
                      {turn.user?.trim() && (
                        <TranscriptMessage
                          speaker="You"
                          message={turn.user}
                          variant="candidate"
                        />
                      )}
                      {turn.assistant?.trim() && (
                        <TranscriptMessage
                          speaker="Interviewer"
                          message={turn.assistant}
                          variant="interviewer"
                        />
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No transcript was saved for this session.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="grid content-start gap-4">
          {sessions.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Session reports
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {[...sessions].reverse().map((session, index) => {
                  const isCurrent = session.id === sessionId;
                  return (
                    <ModifiedLink
                      key={session.id}
                      href={`/interview/${interviewId}/analysis/${session.id}`}
                      aria-current={isCurrent ? "page" : undefined}
                      className={`rounded-lg border p-3 transition-colors hover:bg-accent ${
                        isCurrent
                          ? "border-primary bg-accent/60"
                          : "bg-background"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          Session {sessions.length - index}
                        </span>
                        {isCurrent && (
                          <Badge variant="secondary">Current</Badge>
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        <LocalDateTime value={session.startedAt} />
                      </span>
                      <span className="mt-1 block text-xs capitalize text-muted-foreground">
                        {session.status}
                      </span>
                    </ModifiedLink>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {result && (
            <>
              <Scorecard
                title="Communication"
                score={result.communication.score}
                feedback={result.communication.feedback}
              />
              <Scorecard
                title="Role fit"
                score={result.role_fit.score}
                feedback={result.role_fit.feedback}
              />
            </>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Session details
              </CardTitle>
              <Clock3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Interview</p>
                <p className="font-medium">{interviewName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Started</p>
                <p className="text-sm font-medium">
                  <LocalDateTime value={sessionStartedAt} />
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ended</p>
                <p className="text-sm font-medium">
                  {sessionEndedAt ? (
                    <LocalDateTime value={sessionEndedAt} />
                  ) : (
                    "Not ended"
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Session status</p>
                <Badge variant="outline" className="mt-1 capitalize">
                  {sessionStatus}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function Scorecard({
  title,
  score,
  feedback,
}: {
  title: string;
  score: number;
  feedback: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Sparkles className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">
          {score}
          <span className="text-base font-medium text-muted-foreground">
            /5
          </span>
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {feedback}
        </p>
      </CardContent>
    </Card>
  );
}

function TranscriptMessage({
  speaker,
  message,
  variant,
}: {
  speaker: string;
  message: string;
  variant: "candidate" | "interviewer";
}) {
  return (
    <div
      className={`rounded-lg p-4 ${
        variant === "candidate" ? "bg-secondary/70" : "border bg-background"
      }`}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {speaker}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">
        {message}
      </p>
    </div>
  );
}

function LocalDateTime({ value }: { value: string }) {
  const [displayValue, setDisplayValue] = useState(() =>
    new Date(value)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, " UTC"),
  );

  useEffect(() => {
    setDisplayValue(new Date(value).toLocaleString());
  }, [value]);

  return <time dateTime={value}>{displayValue}</time>;
}
