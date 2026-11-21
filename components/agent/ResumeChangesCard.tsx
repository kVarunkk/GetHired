"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronDown, Loader2 } from "lucide-react";
import { applyReviewSuggestionsAction } from "@/app/actions/resume-review/apply-suggestions";
import { loadResumeChangesAction } from "@/app/actions/resume-review/load-resume-changes";
import { undoReviewSuggestionAction } from "@/app/actions/resume-review/undo-suggestion";
import ResumeDiffView from "@/components/resume/ResumeDiffView";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils/utils";
import { buildResumeDocument } from "@/helpers/resume/render/document";
import type { ResumeContent } from "@/helpers/resume/resume-schema";
import { changeText, planChangeOperations, type ReviewChange } from "@/helpers/resume-review/changes";
import type { ChangesTarget, ResumeChangesView } from "@/helpers/resume-review/load-changes";
import { fillPlaceholders, hasPlaceholder, splitPlaceholders } from "@/helpers/resume-review/suggestions";
import { reviewJobLabel } from "@/helpers/resume-review/target";
import type { ApplySuggestionsInput } from "@/helpers/resume-review/apply-suggestions";
import { diffResume } from "@/helpers/resumes/resume-diff";
import { runResumeOperations } from "@/helpers/resumes/resume-operations";

export type ResumeChangesOutput = {
  status: "applied" | "discarded";
  applied: string[];
  skipped: string[];
  changed: string[];
  targetResumeId: string | null;
};

type Target = "copy" | "original";

/** What the user has done to one change. `text` is set once they edit the wording. */
type Draft = { checked: boolean; text?: string; values: string[]; editing: boolean };

const KIND_LABELS: Record<ReviewChange["kind"], string> = {
  rewrite: "Rewrite",
  add: "New bullet",
  remove: "Remove",
  move: "Move",
};

const LOAD_FAILED = "We couldn't load these changes. Please try again.";
const APPLY_FAILED = "We couldn't apply that. Please try again.";

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A longer summary is cut to three lines, with Show more. */
const SUMMARY_PREVIEW_CHARS = 220;

const resumeLabel = (name: string | null) => name?.trim() || "Untitled resume";

/**
 * The card's heading: which resume the review read, and what it was tailored
 * for. Text only: a job title comes from its posting.
 */
function TailoredFor({ view }: { view: Pick<ResumeChangesView, "target" | "resumeName" | "original"> }) {
  const { job, pastedJob, focus } = view.target;
  const resumeId = view.original.resumeId;
  const resumeName = resumeLabel(view.resumeName);
  return (
    <div className="flex flex-col gap-0.5">
      <p className="break-words text-sm font-semibold text-foreground">
        Changes to{" "}
        {resumeId ? (
          <Link href={`/resume/${resumeId}`} target="_blank" className="underline underline-offset-2">
            {resumeName}
          </Link>
        ) : (
          resumeName
        )}
      </p>
      <p className="break-words text-muted-foreground">
        {job ? (
          <>
            Tailored for{" "}
            <Link href={`/jobs/${job.id}`} target="_blank" className="font-medium text-foreground underline underline-offset-2">
              {reviewJobLabel(job)}
            </Link>
          </>
        ) : pastedJob ? (
          <>
            Tailored for <span className="font-medium text-foreground">the job description you pasted</span>
          </>
        ) : focus ? (
          <>
            Tailored for <span className="font-medium text-foreground">{focus}</span>
          </>
        ) : (
          "Not tailored to a job: reviewed on its own"
        )}
        {(job || pastedJob) && focus && <> · Focus: {focus}</>}
      </p>
    </div>
  );
}

/** A section that starts closed, so the changes stay the first thing on the card. */
function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1 self-start font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown aria-hidden className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />
        {label}
      </button>
      {open && children}
    </div>
  );
}

/** The review's summary, cut to a few lines until the user asks for the rest. */
function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > SUMMARY_PREVIEW_CHARS;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <p className={cn("whitespace-pre-line break-words text-foreground", long && !open && "line-clamp-3")}>{text}</p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function ErrorNote({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/** The text of the part a move is about, so the row can say what moves. */
function partText(content: ResumeContent, id: string) {
  for (const section of content.sections) {
    if (section.id === id) return section.title || section.type;
    for (const item of section.items) {
      if (item.id === id) return item.heading || "An entry";
      const bullet = item.bullets.find((candidate) => candidate.id === id);
      if (bullet) return bullet.text;
    }
  }
  return "This part";
}

/** The suggestion, with an inline input for each `[placeholder]` (RI-REQ-026). */
function FillableText({
  text,
  values,
  disabled,
  onValue,
}: {
  text: string;
  values: string[];
  disabled: boolean;
  onValue: (index: number, value: string) => void;
}) {
  let index = -1;
  return (
    <p className="whitespace-pre-line break-words leading-7 text-foreground">
      {splitPlaceholders(text).map((part, at) => {
        if (!part.placeholder) return <span key={at}>{part.text}</span>;
        index += 1;
        const position = index;
        return (
          <Input
            key={at}
            aria-label={`Value for ${part.text}`}
            placeholder={part.text}
            value={values[position] ?? ""}
            disabled={disabled}
            onChange={(event) => onValue(position, event.target.value)}
            className="mx-1 inline-block h-6 w-28 px-1.5 py-0 text-xs"
          />
        );
      })}
    </p>
  );
}

function ChangeRow({
  change,
  draft,
  content,
  disabled,
  onChange,
}: {
  change: ReviewChange;
  draft: Draft;
  content: ResumeContent;
  disabled: boolean;
  onChange: (next: Partial<Draft>) => void;
}) {
  const base = changeText(change, draft.text);
  const label =
    change.kind === "move"
      ? `${KIND_LABELS.move}: ${partText(content, change.target_id)}`
      : `${KIND_LABELS[change.kind]}: ${change.kind === "remove" ? change.original : base}`;

  const setValue = (index: number, value: string) => {
    const values = [...draft.values];
    values[index] = value;
    // Filling in the last value is as good as ticking it.
    const filled = base !== null && !hasPlaceholder(fillPlaceholders(base, values));
    onChange({ values, ...(filled ? { checked: true } : {}) });
  };

  const needsValues = base !== null && hasPlaceholder(fillPlaceholders(base, draft.values));

  return (
    <li className="flex items-start gap-2.5 border-t py-2.5 first:border-t-0">
      <Checkbox
        className="mt-0.5"
        aria-label={label}
        checked={draft.checked}
        disabled={disabled}
        onCheckedChange={(checked) => onChange({ checked: checked === true })}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-muted-foreground">
            {KIND_LABELS[change.kind]}
            {needsValues && <span className="font-normal"> · fill in the blanks</span>}
          </p>
          {base !== null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-my-1 h-6 shrink-0 px-1.5 text-xs"
              disabled={disabled}
              onClick={() => onChange({ editing: !draft.editing })}
            >
              {draft.editing ? "Done" : "Edit"}
            </Button>
          )}
        </div>
        {(change.kind === "rewrite" || change.kind === "remove") && (
          <del className="whitespace-pre-line break-words text-muted-foreground">{change.original}</del>
        )}
        {change.kind === "move" && <p className="break-words text-foreground">{partText(content, change.target_id)}</p>}
        {base !== null &&
          (draft.editing ? (
            <Textarea
              aria-label="Edit the wording"
              value={base}
              disabled={disabled}
              onChange={(event) => onChange({ text: event.target.value, values: [] })}
              className="min-h-16 text-xs"
            />
          ) : (
            <FillableText text={base} values={draft.values} disabled={disabled} onValue={setValue} />
          ))}
        <p className="break-words text-muted-foreground">{change.reason}</p>
      </div>
    </li>
  );
}

/** What a target would become with these changes, for the live diff (RI-REQ-027). */
/**
 * What the job wants and the resume doesn't show. Closed on the form, so the
 * changes come first; open on the result card, for answering after Apply.
 */
function GapQuestions({ gaps, collapsed = false }: { gaps: ResumeChangesView["gaps"]; collapsed?: boolean }) {
  if (gaps.length === 0) return null;
  const list = (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {gaps.map((gap) => (
          <li key={gap.requirement} className="break-words">
            <span className="font-medium text-foreground">{gap.requirement}: </span>
            <span className="text-muted-foreground">{gap.question}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">Answer in the chat, and the assistant will add what you say.</p>
    </div>
  );
  const label = `${count(gaps.length, "question")} to make it stronger`;
  return (
    <div className="border-t pt-2">
      {collapsed ? (
        <Disclosure label={label}>{list}</Disclosure>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium text-muted-foreground">{label}</p>
          {list}
        </div>
      )}
    </div>
  );
}

function previewOf(target: ChangesTarget, chosen: { change: ReviewChange; text?: string }[]) {
  const { content, contact, template } = target;
  const { operations } = planChangeOperations(content, chosen);
  const result = runResumeOperations({ content, contact }, operations);
  if (!result.ok) return null;
  return diffResume(
    buildResumeDocument({ content, contact, template }),
    buildResumeDocument({ content: result.content, contact: result.contact, template }),
  );
}

/** How the form writes the chosen changes. The landing-page demo passes a local one. */
export type ApplyChanges = (input: ApplySuggestionsInput) => ReturnType<typeof applyReviewSuggestionsAction>;

const applyFromAgent: ApplyChanges = (input) => applyReviewSuggestionsAction(input, "agent");

export function ChangesForm({
  view,
  onDone,
  onReload,
  applyChanges = applyFromAgent,
}: {
  view: ResumeChangesView;
  onDone: (output: ResumeChangesOutput) => void;
  onReload: () => void;
  applyChanges?: ApplyChanges;
}) {
  const [target, setTarget] = useState<Target>("copy");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      view.changes.map((change) => [
        change.id,
        { checked: !hasPlaceholder(changeText(change) ?? ""), values: [], editing: false },
      ]),
    ),
  );

  const current = view[target];
  const open = view.changes.filter((change) => current.states[change.id] === "pending");
  const staleCount = view.changes.filter((change) => current.states[change.id] === "changed").length;

  const finalText = (change: ReviewChange) => {
    const draft = drafts[change.id];
    const base = changeText(change, draft.text);
    return base === null ? undefined : fillPlaceholders(base, draft.values);
  };

  const chosen = open.filter((change) => drafts[change.id].checked);
  const chosenTexts = chosen.map((change) => ({ change, text: finalText(change) }));
  const unfilled = chosenTexts.some(({ text }) => text !== undefined && hasPlaceholder(text));
  const empty = chosenTexts.some(({ text }) => text !== undefined && !text.trim());

  const previewKey = JSON.stringify([target, chosenTexts.map(({ change, text }) => [change.id, text])]);
  const diff = useMemo(
    () => previewOf(current, chosenTexts),
    // `previewKey` is what `chosenTexts` holds, and a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewKey],
  );

  const update = (id: string, next: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [id]: { ...all[id], ...next } }));

  const tickAll = (checked: boolean) =>
    setDrafts((all) => {
      const next = { ...all };
      for (const change of open) next[change.id] = { ...next[change.id], checked };
      return next;
    });

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await applyChanges({
        reviewId: view.reviewId,
        target,
        items: chosenTexts.map(({ change, text }) => ({
          id: change.id,
          ...(text !== undefined && text !== changeText(change) ? { text } : {}),
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const applied = result.items
        .filter((item) => item.status === "applied" || item.status === "already_applied")
        .map((item) => item.id);
      if (applied.length === 0) {
        setError("These changes no longer fit the resume, because it changed since the review.");
        onReload();
        return;
      }

      const chosenIds = new Set(chosen.map((change) => change.id));
      onDone({
        status: "applied",
        applied,
        skipped: open.filter((change) => !chosenIds.has(change.id)).map((change) => change.id),
        changed: result.items.filter((item) => !applied.includes(item.id)).map((item) => item.id),
        targetResumeId: result.targetResumeId,
      });
    } catch {
      setError(APPLY_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const discard = () =>
    onDone({
      status: "discarded",
      applied: [],
      skipped: open.map((change) => change.id),
      changed: [],
      targetResumeId: null,
    });

  const tickedCount = chosen.length;
  const resumeName = resumeLabel(view.resumeName);
  const hasCopy = view.copy.resumeId !== null;
  const applyLabel =
    target === "original"
      ? `Apply ${count(tickedCount, "change")} to ${resumeName}`
      : hasCopy
        ? `Add ${count(tickedCount, "change")} to the copy`
        : `Create copy with ${count(tickedCount, "change")}`;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <TailoredFor view={view} />
      {view.summary && <Summary text={view.summary} />}

      {open.length > 0 ? (
        <div className="flex flex-col rounded-md border">
          <div className="flex items-center gap-2.5 border-b bg-muted/40 px-2.5 py-1.5">
            <Checkbox
              aria-label="Select all"
              checked={tickedCount === open.length ? true : tickedCount === 0 ? false : "indeterminate"}
              disabled={busy}
              onCheckedChange={() => tickAll(tickedCount !== open.length)}
            />
            <span className="font-medium text-muted-foreground">
              {tickedCount} of {count(open.length, "change")} selected
            </span>
          </div>
          <ul className="flex flex-col px-2.5">
            {open.map((change) => (
              <ChangeRow
                key={change.id}
                change={change}
                draft={drafts[change.id]}
                content={current.content}
                disabled={busy}
                onChange={(next) => update(change.id, next)}
              />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground">Nothing left to apply here.</p>
      )}

      {staleCount > 0 && (
        <p className="text-muted-foreground">
          {count(staleCount, "change")} left out, because the resume changed since the review.
        </p>
      )}

      {diff?.hasChanges && (
        <Disclosure label="Preview the whole resume">
          <ResumeDiffView diff={diff} />
        </Disclosure>
      )}

      <GapQuestions gaps={view.gaps} collapsed />

      {open.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2">
          {target === "copy" ? (
            <p className="break-words text-muted-foreground">
              {hasCopy ? "Saves to your copy " : "Saves as a new copy "}
              <span className="font-medium text-foreground">{view.copyName}</span>. {resumeName} stays as it is.
            </p>
          ) : (
            <p className="break-words text-muted-foreground">
              Changes <span className="font-medium text-foreground">{resumeName}</span> itself. Only rewrites can be
              undone: new bullets, removals and moves stay until you edit the resume.
            </p>
          )}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto self-start p-0 text-xs"
            disabled={busy}
            onClick={() => setTarget(target === "copy" ? "original" : "copy")}
          >
            {target === "copy" ? `Change ${resumeName} instead` : "Save as a copy instead"}
          </Button>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
      {unfilled && <p className="text-muted-foreground">Fill in the bracketed values, or untick those changes.</p>}

      <div className="flex flex-wrap items-center gap-2">
        {open.length > 0 && (
          <Button
            type="button"
            variant="brand"
            size="sm"
            disabled={busy || chosen.length === 0 || unfilled || empty}
            onClick={apply}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {applyLabel}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={discard}>
          {open.length > 0 ? "Discard" : "Close"}
        </Button>
      </div>
    </div>
  );
}

/** What came of the card, with a link to the resume and an Undo on rewrites (RI-REQ-029a). */
export function ResumeChangesResult({ reviewId, output }: { reviewId: string; output: ResumeChangesOutput }) {
  const [view, setView] = useState<ResumeChangesView | null>(null);
  const [undone, setUndone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { targetResumeId, status } = output;

  useEffect(() => {
    if (status !== "applied") return;
    let cancelled = false;
    loadResumeChangesAction(reviewId)
      .then((result) => !cancelled && result.ok && setView(result))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reviewId, status]);

  if (status === "discarded") return <p className="text-xs text-muted-foreground">Nothing was changed.</p>;

  const appliedIds = new Set(output.applied);
  const resume = view && (view.copy.resumeId === targetResumeId ? view.copy : view.original);
  // The saved tool output can't know about an undo: the records can, after a reload too.
  const stillApplied = output.applied.filter((id) => !undone.has(id) && (!resume || resume.applied[id]));
  const rewrites = (view?.changes ?? []).flatMap((change) => {
    const record = resume?.applied[change.id];
    return change.kind === "rewrite" && record && appliedIds.has(change.id) && !undone.has(change.id)
      ? [{ id: change.id, ...record }]
      : [];
  });

  const undo = async (bulletId: string) => {
    if (!targetResumeId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await undoReviewSuggestionAction({ reviewId, bulletId, targetResumeId }, "agent");
      if (result.ok) setUndone((current) => new Set([...current, bulletId]));
      else setError(result.error);
    } catch {
      setError("We couldn't undo that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-xs">
      {view && <TailoredFor view={view} />}
      <p className="text-foreground">
        Applied {count(stillApplied.length, "change")}.{" "}
        {targetResumeId && (
          <Link href={`/resume/${targetResumeId}`} target="_blank" className="underline underline-offset-2">
            Open the resume
          </Link>
        )}
      </p>
      {output.changed.length > 0 && (
        <p className="text-muted-foreground">
          {count(output.changed.length, "change")} left out, because the resume changed since the review.
        </p>
      )}
      {output.skipped.length > 0 && (
        <p className="text-muted-foreground">
          {count(output.skipped.length, "change")} not applied. Ask the assistant to reopen them.
        </p>
      )}
      {rewrites.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {rewrites.map((change) => (
            <li key={change.id} className="flex items-start justify-between gap-2 border-t pt-1.5">
              <div className="flex min-w-0 flex-col gap-0.5 break-words">
                <del className="whitespace-pre-line text-muted-foreground">{change.previous}</del>
                <ins className="whitespace-pre-line text-foreground no-underline">{change.text}</ins>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-1.5 text-xs"
                aria-label={`Undo: ${change.text}`}
                disabled={busy}
                onClick={() => undo(change.id)}
              >
                Undo
              </Button>
            </li>
          ))}
        </ul>
      )}
      {view && <GapQuestions gaps={view.gaps} />}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

/**
 * The agent's `reviewResumeChanges` client tool (RI-REQ-020). The click on Apply
 * is the approval: the write happens in the server action, as the session user.
 * It loads by id, so it survives a reload. `onComplete` is left out on an older
 * message, because only the latest reply can take a tool output: the user can
 * still apply there, and the chat just isn't told.
 */
export default function ResumeChangesCard({
  reviewId,
  onComplete,
  collapsed = false,
}: {
  reviewId: string;
  onComplete?: (output: ResumeChangesOutput) => void;
  /** The user moved on without answering: show one line until they open it. */
  collapsed?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<ResumeChangesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<ResumeChangesOutput | null>(null);
  const [loads, setLoads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadResumeChangesAction(reviewId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setView(result);
        else setError(result.error);
      })
      .catch(() => !cancelled && setError(LOAD_FAILED));
    return () => {
      cancelled = true;
    };
  }, [reviewId, loads]);

  if (finished) return <ResumeChangesResult reviewId={reviewId} output={finished} />;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!view) return <p className="text-xs text-muted-foreground">Loading the changes…</p>;

  if (collapsed && !expanded) {
    const left = view.changes.filter((change) => view.copy.states[change.id] === "pending").length;
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="break-words">
          Changes to <span className="font-medium text-foreground">{resumeLabel(view.resumeName)}</span> ·{" "}
          {left > 0 ? `${count(left, "suggestion")}, not applied` : "nothing left to apply"}
        </span>
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setExpanded(true)}>
          Show
        </Button>
      </div>
    );
  }

  return (
    <ChangesForm
      view={view}
      onReload={() => setLoads((current) => current + 1)}
      onDone={(output) => (onComplete ? onComplete(output) : setFinished(output))}
    />
  );
}
