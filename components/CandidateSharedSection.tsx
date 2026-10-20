import { Loader2 } from "lucide-react";
import type { CompanyInterviewAnalysisResult } from "@/helpers/interview/company-analysis-prompt";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

type Props = {
  interview: {
    status: "queued" | "processing" | "completed" | "failed";
    result: CompanyInterviewAnalysisResult | null;
  } | null;
  review: { score: number | null; summary: string | null } | null;
};

const LABEL = "Shared by the candidate · AI-generated";

function InterviewReport({ result }: { result: CompanyInterviewAnalysisResult }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="whitespace-pre-wrap">{result.summary}</p>
      {result.competencies.length > 0 && (
        <div className="space-y-2">
          <p className="font-semibold">Competencies</p>
          <ul className="divide-y rounded-lg border">
            {result.competencies.map((c, i) => (
              <li key={i} className="space-y-1 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">{c.score}/5</span>
                </div>
                <p className="text-muted-foreground">{c.evidence}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.evidence_quotes.length > 0 && (
        <div className="space-y-2">
          <p className="font-semibold">Evidence</p>
          <ul className="space-y-2">
            {result.evidence_quotes.map((q, i) => (
              <li key={i} className="border-l-2 pl-3">
                <p className="italic">&ldquo;{q.quote}&rdquo;</p>
                <p className="text-muted-foreground">{q.relevance}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.concerns.length > 0 && (
        <div className="space-y-2">
          <p className="font-semibold">Concerns</p>
          <ul className="list-disc space-y-1 pl-5">
            {result.concerns.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.title}.</span>{" "}
                <span className="text-muted-foreground">{c.evidence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.follow_up_questions.length > 0 && (
        <div className="space-y-2">
          <p className="font-semibold">Suggested follow-up questions</p>
          <ul className="list-disc space-y-1 pl-5">
            {result.follow_up_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The "Candidate-shared" section of the company's applicant page
 * (OR-REQ-032): the company-perspective report on a mock interview and the
 * resume review score and summary the candidate chose to share. Nothing
 * when they shared nothing.
 */
export default function CandidateSharedSection({ interview, review }: Props) {
  if (!interview && !review) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Candidate-shared</CardTitle>
        <CardDescription>The candidate chose to share these with you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {interview && (
          <section className="space-y-3" aria-labelledby="shared-interview">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="shared-interview" className="font-semibold">
                Mock interview report
              </h3>
              <Badge variant="outline">{LABEL}</Badge>
            </div>
            {interview.status === "completed" && interview.result ? (
              <InterviewReport result={interview.result} />
            ) : interview.status === "failed" ? (
              <p className="text-sm text-muted-foreground">The report couldn&apos;t be generated.</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Report in progress
              </p>
            )}
          </section>
        )}

        {review && (
          <section className="space-y-3" aria-labelledby="shared-review">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="shared-review" className="font-semibold">
                Resume review
              </h3>
              <Badge variant="outline">{LABEL}</Badge>
            </div>
            {review.score !== null && (
              <p className="text-sm">
                Score: <span className="font-semibold">{review.score}</span>/100
              </p>
            )}
            {review.summary && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{review.summary}</p>}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
