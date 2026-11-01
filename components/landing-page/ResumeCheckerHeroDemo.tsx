"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, File, Loader2 } from "lucide-react";
import AnalysisPane from "@/components/resume-review/AnalysisPane";
import DigitalTwinMirror from "@/components/resume-review/DigitalTwinMirror";
import { scoreColorClass } from "@/components/resume-review/score";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils/utils";
import {
  DEMO_JOB_DESCRIPTION,
  DEMO_RESUME_NAME,
  demoReview,
} from "./resume-checker-demo";

// A sample resume review for the AI resume checker's hero. It renders the
// review page's own AnalysisPane and DigitalTwinMirror with a canned review,
// so hovering a suggestion highlights its line in the resume and clicking it
// copies the rewrite, as on /resume-review/[id]. "Tailor Resume" replays the
// analysis locally: nothing is saved and no API is called.

/** How long the replayed analysis spins before the results come back. */
export const DEMO_ANALYSIS_MS = 2400;

export default function ResumeCheckerHeroDemo() {
  const [analysed, setAnalysed] = useState(true);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [isJdPaneOpen, setIsJdPaneOpen] = useState(false);
  const [jd, setJd] = useState(DEMO_JOB_DESCRIPTION);
  const resumeRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const review = demoReview(analysed);
  const isAnalyzing = !analysed;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Bring the highlighted line into view inside the resume pane only. The
  // page uses scrollIntoView, which here would scroll the landing page too.
  useEffect(() => {
    const container = resumeRef.current;
    if (!activeHighlightId || !container) return;
    const line = container.querySelector<HTMLElement>(`#bullet-${activeHighlightId}`);
    if (!line) return;
    const offset =
      line.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      container.clientHeight / 2;
    container.scrollTo?.({ top: Math.max(0, offset), behavior: "smooth" });
  }, [activeHighlightId]);

  const runAnalysis = () => {
    window.clearTimeout(timer.current);
    setActiveHighlightId(null);
    setIsJdPaneOpen(false);
    setAnalysed(false);
    timer.current = window.setTimeout(() => setAnalysed(true), DEMO_ANALYSIS_MS);
  };

  return (
    <section
      aria-label="Example resume review"
      className="flex w-full flex-col overflow-hidden rounded-xl border bg-background text-left sm:h-[38rem] sm:flex-row"
    >
      {/* LEFT PANE: ANALYSIS & SUGGESTIONS (as in ResumeReviewClient) */}
      <aside className="flex flex-col border-r sm:w-[40%]">
        <div className="flex items-center justify-between border-b p-4">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold tracking-tight">Analysis Pane</h2>
            <p className="text-sm text-muted-foreground">{review.name}</p>
          </div>
          {review.score && (
            <div className="text-right">
              <div
                className={cn(
                  "text-2xl font-semibold tracking-tight",
                  scoreColorClass(review.score),
                )}
              >
                {review.score}
              </div>
              <div className="text-xs font-medium text-muted-foreground">Match Score</div>
            </div>
          )}
        </div>

        <AnalysisPane
          isParsed
          isResumeLinked
          isParsingFailed={false}
          currentReview={review}
          isAnalyzing={isAnalyzing}
          setActiveHighlightId={setActiveHighlightId}
          activeHighlightId={activeHighlightId}
        />
      </aside>

      {/* RIGHT PANE: RESUME VIEW & JD INPUT */}
      <div className="flex h-[34rem] min-w-0 flex-1 flex-col sm:h-auto">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-t sm:border-t-0">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b bg-background/50 p-4">
            <div className="text-lg font-semibold tracking-tight">Resume</div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <File className="h-4 w-4" />
              {DEMO_RESUME_NAME}
            </div>
          </div>
          <div ref={resumeRef} className="relative flex-1 overflow-y-auto p-4">
            <DigitalTwinMirror
              content={review.resumes?.content as Parameters<typeof DigitalTwinMirror>[0]["content"]}
              activeHighlightId={activeHighlightId}
            />
          </div>
        </div>

        {/* As in JdSection, without the save to the review. */}
        <div className="flex shrink-0 flex-col border-t bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <label htmlFor="demo-jd" className="text-lg font-semibold tracking-tight">
                  Target Job Description
                </label>
                <button
                  type="button"
                  className="rounded-md p-1 transition-colors hover:bg-muted"
                  onClick={() => setIsJdPaneOpen(!isJdPaneOpen)}
                  aria-expanded={isJdPaneOpen}
                  aria-label={isJdPaneOpen ? "Collapse job description" : "Expand job description"}
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform duration-300",
                      !isJdPaneOpen && "rotate-180",
                    )}
                  />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Analyze your experience against these specific requirements
              </p>
            </div>

            <Button
              size="sm"
              variant="brand"
              onClick={runAnalysis}
              disabled={!jd.trim() || isAnalyzing}
              className="disabled:opacity-40"
            >
              {isAnalyzing ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing
                </div>
              ) : (
                "Tailor Resume"
              )}
            </Button>
          </div>

          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-300 ease-out",
              isJdPaneOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div
              inert={!isJdPaneOpen}
              className={cn(
                "min-h-0 overflow-hidden transition-opacity duration-300",
                isJdPaneOpen ? "opacity-100" : "opacity-0",
              )}
            >
              <div className="px-0.5 pb-0.5 pt-5">
                <Textarea
                  id="demo-jd"
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                  placeholder="Paste the Job Description (JD) here"
                  className="h-40 w-full resize-none rounded-xl p-4 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
