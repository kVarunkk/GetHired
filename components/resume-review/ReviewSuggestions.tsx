"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { mutate } from "swr";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { applyReviewSuggestionsAction } from "@/app/actions/resume-review/apply-suggestions";
import { undoReviewSuggestionAction } from "@/app/actions/resume-review/undo-suggestion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { downloadResume } from "@/helpers/resume/download-resume";
import { readResume } from "@/helpers/resume/read-resume";
import { hasPlaceholder, readSuggestions, resumeBullets } from "@/helpers/resume-review/suggestions";
import type { TResumeReviewServer } from "@/utils/types/review.types";
import SuggestionCard, { type SuggestionState } from "./SuggestionCard";

type Target = "copy" | "original";
type ApplyItem = { bulletId: string; text?: string };

const APPLY_FAILED = "We couldn't apply that. Please try again.";

const TARGET_LABELS: Record<Target, string> = { copy: "a copy", original: "this resume" };

/** Applying, undoing and the state of each suggestion on the review page (RE-REQ-060). */
export default function ReviewSuggestions({
  review,
  activeHighlightId,
  setActiveHighlightId,
  onRerun,
  readOnly = false,
}: {
  review: TResumeReviewServer;
  activeHighlightId: string | null;
  setActiveHighlightId: Dispatch<SetStateAction<string | null>>;
  onRerun?: () => void;
  readOnly?: boolean;
}) {
  const [target, setTarget] = useState<Target>("copy");
  const [isBusy, setIsBusy] = useState(false);
  const [changedIds, setChangedIds] = useState<ReadonlySet<string>>(new Set());
  /** An apply to the original, waiting on the dialog. `settle` answers whoever asked. */
  const [confirming, setConfirming] = useState<{
    items: ApplyItem[];
    settle: (applied: boolean | Promise<boolean>) => void;
  } | null>(null);

  const suggestions = useMemo(() => readSuggestions(review.ai_response), [review.ai_response]);
  const bulletIds = useMemo(
    () => new Set(resumeBullets(readResume({ content: review.resumes?.content }).content).map((bullet) => bullet.id)),
    [review.resumes?.content],
  );

  const targetResumeId = target === "copy" ? review.applied_copy_id : review.resume_id;
  const appliedIds = new Set(
    (review.resume_review_applied ?? [])
      .filter((applied) => applied.target_resume_id === targetResumeId)
      .map((applied) => applied.bullet_id),
  );

  const stateOf = (bulletId: string): SuggestionState => {
    if (readOnly) return "read_only";
    if (appliedIds.has(bulletId)) return "applied";
    return bulletIds.has(bulletId) ? "ready" : "missing";
  };

  // A review from before the placeholder rule stored no revision (RE-REQ-059a).
  const isOlderReview = review.resume_revision == null;
  const isOutOfDate = !readOnly && !isOlderReview && review.resumes?.revision !== review.resume_revision;
  const canApplyAll = (suggestion: (typeof suggestions)[number]) =>
    !isOlderReview &&
    stateOf(suggestion.bullet_id) === "ready" &&
    !changedIds.has(suggestion.bullet_id) &&
    !hasPlaceholder(suggestion.suggested);
  const applyAllItems = suggestions.filter(canApplyAll).map((suggestion) => ({ bulletId: suggestion.bullet_id }));
  const openCount = suggestions.filter(
    (suggestion) => stateOf(suggestion.bullet_id) === "ready" && !changedIds.has(suggestion.bullet_id),
  ).length;
  const skippedCount = openCount - applyAllItems.length;

  const refresh = () => mutate(`/api/resume-review/${review.id}`);

  const apply = async (items: ApplyItem[]): Promise<boolean> => {
    setIsBusy(true);
    try {
      const result = await applyReviewSuggestionsAction({ reviewId: review.id, target, items });
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }

      const changed = result.items.filter((item) => item.status !== "applied").map((item) => item.bulletId);
      setChangedIds((current) => new Set([...current, ...changed]));

      const appliedCount = result.items.length - changed.length;
      if (appliedCount > 0) {
        toast.success(`Applied ${appliedCount} to ${TARGET_LABELS[target]}.`);
        await refresh();
      }
      if (changed.length > 0) {
        toast.error(`${changed.length} ${changed.length === 1 ? "bullet has" : "bullets have"} changed since the review.`);
      }
      return appliedCount > 0;
    } catch {
      toast.error(APPLY_FAILED);
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  /** Changing the original asks first. A card keeps its editor open if the answer is no. */
  const requestApply = (items: ApplyItem[]): Promise<boolean> => {
    if (target !== "original") return apply(items);
    return new Promise((settle) => setConfirming({ items, settle }));
  };

  // The action button also closes the dialog, which settles again with false.
  // A promise keeps its first answer, so that second call does nothing.
  const settleConfirm = (applied: boolean | Promise<boolean>) => {
    confirming?.settle(applied);
    setConfirming(null);
  };

  const undo = async (bulletId: string) => {
    if (!targetResumeId) return;
    setIsBusy(true);
    try {
      const result = await undoReviewSuggestionAction({ reviewId: review.id, bulletId, targetResumeId });
      if (result.ok) await refresh();
      else toast.error(result.error);
    } catch {
      toast.error("We couldn't undo that. Please try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const download = async (resumeId: string) => {
    setIsBusy(true);
    const result = await downloadResume(resumeId, "pdf");
    setIsBusy(false);
    if (!result.ok) toast.error(result.error);
  };

  return (
    <div className="space-y-4">
      {isOutOfDate && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            This score is for an earlier version of the resume.
            <Button size="sm" variant="outline" onClick={onRerun}>
              Run a new review
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {suggestions.length > 0 && !readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Apply to</span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={target}
              disabled={isBusy}
              onValueChange={(value) => value && setTarget(value as Target)}
            >
              <ToggleGroupItem value="copy">A copy</ToggleGroupItem>
              <ToggleGroupItem value="original">This resume</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {openCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={isBusy || applyAllItems.length === 0}
              onClick={() => requestApply(applyAllItems)}
            >
              {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Apply all changes{applyAllItems.length > 0 && ` (${applyAllItems.length})`}
            </Button>
          )}
        </div>
      )}

      {skippedCount > 0 && !readOnly && (
        <p className="text-xs text-muted-foreground">
          {isOlderReview
            ? "This older review may have estimated numbers, so check and apply each change yourself."
            : `${skippedCount} ${skippedCount === 1 ? "change needs" : "changes need"} your real numbers first, so apply ${skippedCount === 1 ? "it" : "them"} one at a time.`}
        </p>
      )}

      {appliedIds.size > 0 && targetResumeId && !readOnly && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
          <span className="text-xs text-muted-foreground">Applied to {TARGET_LABELS[target]}</span>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/resume/${targetResumeId}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </Link>
          </Button>
          <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => download(targetResumeId)}>
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
        </div>
      )}

      {suggestions.map((suggestion) => (
        <SuggestionCard
          key={suggestion.bullet_id}
          suggestion={suggestion}
          state={stateOf(suggestion.bullet_id)}
          isActive={activeHighlightId === suggestion.bullet_id}
          isBusy={isBusy}
          isChanged={changedIds.has(suggestion.bullet_id)}
          checkNumbers={isOlderReview}
          onHighlight={setActiveHighlightId}
          onApply={(text) => requestApply([{ bulletId: suggestion.bullet_id, text }])}
          onUndo={() => undo(suggestion.bullet_id)}
        />
      ))}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && settleConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change your original resume?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.items.length === 1 ? "This rewrites 1 bullet" : `This rewrites ${confirming?.items.length} bullets`}{" "}
              on {review.resumes?.name ?? "your resume"} instead of a copy. You can undo each change from this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirming && settleConfirm(apply(confirming.items))}>
              Apply to original
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
