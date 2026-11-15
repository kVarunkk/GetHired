"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Lock } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { saveScorecardDraftAction } from "@/app/actions/interviews/save-scorecard-draft";
import { submitScorecardAction } from "@/app/actions/interviews/submit-scorecard";
import { SCORECARD_LIMITS } from "@/helpers/interviews/config";
import { RATING_LABELS, type CandidateRating } from "@/helpers/pipeline/ratings";

const RATINGS = Object.keys(RATING_LABELS) as CandidateRating[];

/** How long after the last change the draft is saved. */
export const AUTOSAVE_MS = 1000;

export type ScorecardCompetency = { id: string; name: string; description: string };
export type ScorecardValue = {
  status: "draft" | "submitted";
  overall: CandidateRating | null;
  overallNote: string;
  ratings: Record<string, { rating: CandidateRating | null; note: string }>;
  lockedAt: string | null;
};

/**
 * What the member can still change (IV-REQ-031, D19): everything on a draft;
 * only the notes for 24 hours after submitting; nothing after that, or on a
 * cancelled or no-show interview.
 */
export function scorecardEditMode(
  card: Pick<ScorecardValue, "status" | "lockedAt"> | null,
  interviewStatus: string,
  now: number,
): "draft" | "notes_only" | "locked" {
  if (interviewStatus === "cancelled" || interviewStatus === "no_show") return "locked";
  if (!card || card.status === "draft") return "draft";
  if (card.lockedAt && now < Date.parse(card.lockedAt)) return "notes_only";
  return "locked";
}

/** "5h 12m" until `lockedAt`. */
export function timeLeft(lockedAt: string, now: number): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(lockedAt) - now) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function RatingControl({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: CandidateRating | null;
  disabled: boolean;
  onChange: (rating: CandidateRating | null) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value ?? ""}
      disabled={disabled}
      onValueChange={(v) => onChange(v ? (v as CandidateRating) : null)}
      aria-label={label}
      className="flex-wrap justify-start"
    >
      {RATINGS.map((r) => (
        <ToggleGroupItem key={r} value={r} className="data-[state=on]:border-foreground/40">
          {RATING_LABELS[r]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * The member's own scorecard in the interview kit (IVT-019, IV-REQ-030/031):
 * a rating and a note per competency, an overall recommendation and a note.
 * Saves itself a second after each change. Submitting locks the ratings for
 * good; the notes stay editable for 24 hours, each edit recorded.
 */
export default function ScorecardForm({
  interviewId,
  interviewStatus,
  started,
  competencies,
  initial,
}: {
  interviewId: string;
  interviewStatus: string;
  /** Whether the interview has started: submitting needs it. */
  started: boolean;
  competencies: ScorecardCompetency[];
  initial: ScorecardValue | null;
}) {
  const router = useRouter();
  const [card, setCard] = useState<ScorecardValue>(
    initial ?? { status: "draft", overall: null, overallNote: "", ratings: {}, lockedAt: null },
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ScorecardValue | null>(null);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const mode = scorecardEditMode(card, interviewStatus, now);
  const ratingsLocked = mode !== "draft";
  const notesLocked = mode === "locked";

  const save = useCallback(
    async (value: ScorecardValue) => {
      setSaveState("saving");
      try {
        const result = await saveScorecardDraftAction({
          interviewId,
          ratings: value.ratings,
          overall: value.overall,
          overallNote: value.overallNote,
        });
        if (!result.ok) {
          setSaveState("error");
          setError(result.error);
          return false;
        }
        setSaveState("saved");
        setError(null);
        return true;
      } catch {
        setSaveState("error");
        setError("Couldn't save your scorecard. Your changes are kept here; try again.");
        return false;
      }
    },
    [interviewId],
  );

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = pending.current;
    pending.current = null;
    return value ? save(value) : true;
  }, [save]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const change = (next: ScorecardValue) => {
    setCard(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  };

  const setRating = (id: string, patch: Partial<{ rating: CandidateRating | null; note: string }>) => {
    const current = card.ratings[id] ?? { rating: null, note: "" };
    change({ ...card, ratings: { ...card.ratings, [id]: { ...current, ...patch } } });
  };

  const submit = async () => {
    if (!(await flush())) return false;
    const result = await submitScorecardAction({ interviewId });
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setCard((c) => ({ ...c, status: "submitted", lockedAt: result.lockedAt }));
    setError(null);
    router.refresh();
    return true;
  };

  const canSubmit = card.status === "draft" && mode === "draft" && started && card.overall !== null;

  return (
    <div className="flex flex-col gap-6">
      {competencies.length > 0 ? (
        <div className="divide-y rounded-xl border">
          {competencies.map((c) => {
            const value = card.ratings[c.id] ?? { rating: null, note: "" };
            return (
              <div key={c.id} className="flex flex-col gap-2 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
                </div>
                <RatingControl
                  label={`${c.name} rating`}
                  value={value.rating}
                  disabled={ratingsLocked}
                  onChange={(rating) => setRating(c.id, { rating })}
                />
                <Textarea
                  aria-label={`${c.name} notes`}
                  value={value.note}
                  rows={2}
                  maxLength={SCORECARD_LIMITS.competencyNote}
                  disabled={notesLocked}
                  placeholder="What you saw."
                  onChange={(e) => setRating(c.id, { note: e.target.value })}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This interview has no competencies to rate. Give your overall view.</p>
      )}

      <div className="flex flex-col gap-2">
        <Label>Overall recommendation</Label>
        <RatingControl
          label="Overall recommendation"
          value={card.overall}
          disabled={ratingsLocked}
          onChange={(overall) => change({ ...card, overall })}
        />
        <Textarea
          aria-label="Overall notes"
          value={card.overallNote}
          rows={4}
          maxLength={SCORECARD_LIMITS.overallNote}
          disabled={notesLocked}
          placeholder="Your summary for the hiring team."
          onChange={(e) => change({ ...card, overallNote: e.target.value })}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="mr-auto text-sm text-muted-foreground" aria-live="polite">
          {error ? (
            <span role="alert" className="text-destructive">
              {error}
            </span>
          ) : mode === "locked" && card.status === "submitted" ? (
            <span className="inline-flex items-center gap-1">
              <Lock className="h-3.5 w-3.5" /> Submitted and locked.
            </span>
          ) : mode === "locked" ? (
            "This interview has no scorecards."
          ) : mode === "notes_only" && card.lockedAt ? (
            `Submitted. Ratings are locked; notes can be edited for ${timeLeft(card.lockedAt, now)}.`
          ) : saveState === "saving" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </span>
          ) : saveState === "saved" ? (
            <span className="inline-flex items-center gap-1">
              <Check className="h-3.5 w-3.5" /> Draft saved
            </span>
          ) : !started ? (
            "You can submit once the interview has started."
          ) : card.overall === null ? (
            "Pick an overall recommendation to submit."
          ) : null}
        </p>
        {card.status === "draft" && mode === "draft" && (
          <Button type="button" variant="brand" disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
            Submit scorecard
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Submit your scorecard?"
        description="Your ratings and recommendation lock when you submit. You can still edit your notes for 24 hours. Teammates on the panel see your feedback once they've submitted theirs."
        confirmLabel="Submit"
        confirmVariant="brand"
        onConfirm={submit}
      />
    </div>
  );
}
