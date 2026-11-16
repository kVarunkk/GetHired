"use client";

import { useMemo, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp, Copy, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import StickyActionBar from "@/components/StickyActionBar";
import MemberPicker, { type MemberOption } from "@/components/interviews/MemberPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { copyInterviewPlanAction } from "@/app/actions/interviews/copy-interview-plan";
import { draftInterviewPlanAction } from "@/app/actions/interviews/draft-interview-plan";
import { saveInterviewPlanAction } from "@/app/actions/interviews/save-interview-plan";
import { labelFor } from "@/helpers/billing/keys";
import { PLAN_DRAFT_COST, PLAN_LIMITS } from "@/helpers/interviews/config";
import { useEntitlementError } from "@/hooks/useEntitlementError";
import { planInputSchema } from "@/helpers/interviews/plan-schema";
import {
  initialPlanState,
  isPlanDirty,
  orderedItems,
  planEditorReducer,
  toPlanInput,
  type DraftItem,
  type PlanEditorEvent,
  type PlanEditorState,
  type SavedPlanItem,
} from "./interview-plan-machine";

export type PlanStage = { id: string; name: string };
export type CopySource = { jobId: string; title: string };

type FieldError = { key: string; message: string };

/**
 * The schema's error path ("1.competencies.0.name") as the editor's field key
 * ("<item key>.competencies.<competency key>.name"), so the field can be marked.
 */
function fieldKeyOf(path: string, state: PlanEditorState, stageOrder: string[]): string {
  const parts = path.split(".");
  const ordered = orderedItems(state, stageOrder);
  const item = ordered[Number(parts[0])];
  if (!item) return path;
  if (parts[1] === "competencies" && parts[2] !== undefined) {
    const comp = item.competencies[Number(parts[2])];
    return [item.key, "competencies", comp?.key ?? parts[2], ...parts.slice(3)].join(".");
  }
  return [item.key, ...parts.slice(1)].join(".");
}

/**
 * A job's interview plan (IVT-013, IV-REQ-001–004): the interviews each stage
 * runs, with their length, instructions, default interviewers and the
 * competencies interviewers rate. Editable with `interview_plans.manage`,
 * read-only otherwise. Interviews already scheduled keep their own copy.
 */
export default function InterviewPlanEditor({
  jobPostId,
  stages,
  plan,
  members,
  canEdit,
  copySources,
}: {
  jobPostId: string;
  stages: PlanStage[];
  plan: SavedPlanItem[];
  members: MemberOption[];
  canEdit: boolean;
  copySources: CopySource[];
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(planEditorReducer, plan, initialPlanState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftNotes, setDraftNotes] = useState<string[]>([]);
  const { handle: handleEntitlement, dialog: entitlementDialog } = useEntitlementError();
  const stageOrder = useMemo(() => stages.map((s) => s.id), [stages]);
  const dirty = isPlanDirty(state);

  const act = (event: PlanEditorEvent) => {
    setError(null);
    dispatch(event);
  };

  const save = async () => {
    const input = toPlanInput(state, stageOrder);
    const parsed = planInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError({ key: fieldKeyOf(issue.path.join("."), state, stageOrder), message: issue.message });
      return;
    }
    setSaving(true);
    try {
      const result = await saveInterviewPlanAction({ jobPostId, items: input });
      if (!result.ok) {
        setError({
          key: result.field ? fieldKeyOf(result.field, state, stageOrder) : "",
          message: result.error,
        });
        return;
      }
      dispatch({ type: "reset", plan: result.plan });
      toast.success("Interview plan saved.");
      router.refresh();
    } catch {
      setError({ key: "", message: "Couldn't save the interview plan. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  /** Returns an error message, or null when the draft filled the editor (or the upgrade dialog took over). */
  const draftWithAi = async (): Promise<string | null> => {
    const result = await draftInterviewPlanAction({ jobPostId });
    if (await handleEntitlement(result)) return null;
    if (!("ok" in result)) return "Couldn't draft an interview plan. Please try again.";
    if (!result.ok) return result.error;
    setError(null);
    dispatch({ type: "applyDraft", items: result.items });
    setDraftNotes(result.notes);
    toast.success("Draft ready. Review it, then save.");
    return null;
  };

  const errorFor = (key: string) => (error && error.key === key ? error.message : null);

  return (
    <div className="flex flex-col gap-6">
      {stages.length === 0 && (
        <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
          This company has no open pipeline stages to plan interviews for.
        </p>
      )}

      {draftNotes.length > 0 && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm">
          <div className="flex flex-col gap-1">
            <p className="font-medium">Some of the AI draft was left out</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {draftNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Dismiss" onClick={() => setDraftNotes([])}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {stages.map((stage) => {
        const items = state.items.filter((i) => i.stage_id === stage.id);
        return (
          <section key={stage.id} aria-label={stage.name} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{stage.name}</h3>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => act({ type: "addItem", stageId: stage.id })}
                  disabled={state.items.length >= PLAN_LIMITS.items}
                  aria-label={`Add interview to ${stage.name}`}
                >
                  <Plus className="h-4 w-4" /> Add interview
                </Button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                No interviews in this stage.
              </p>
            ) : (
              items.map((item, i) => (
                <PlanItemCard
                  key={item.key}
                  item={item}
                  first={i === 0}
                  last={i === items.length - 1}
                  members={members}
                  canEdit={canEdit}
                  act={act}
                  errorFor={errorFor}
                />
              ))
            )}
          </section>
        );
      })}

      {canEdit && (
        <StickyActionBar>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {error && (
              <p role="alert" className="mr-auto text-sm text-destructive">
                {error.message}
              </p>
            )}
            {stages.length > 0 && (
              <Button type="button" variant="outline" onClick={() => setDraftOpen(true)} disabled={saving}>
                <Sparkles className="h-4 w-4" /> Draft with AI
              </Button>
            )}
            {copySources.length > 0 && (
              <Button type="button" variant="outline" onClick={() => setCopyOpen(true)} disabled={saving}>
                <Copy className="h-4 w-4" /> Copy from another job
              </Button>
            )}
            <Button type="button" variant="brand" onClick={save} disabled={saving || !dirty}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save plan
            </Button>
          </div>
        </StickyActionBar>
      )}

      {canEdit && (
        <DraftPlanDialog open={draftOpen} onOpenChange={setDraftOpen} hasPlan={state.items.length > 0} onDraft={draftWithAi} />
      )}
      {canEdit && entitlementDialog}

      {canEdit && (
        <CopyPlanDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          sources={copySources}
          onCopy={async (fromJobId) => {
            const result = await copyInterviewPlanAction({ fromJobId, toJobId: jobPostId });
            if (!result.ok) return result.error;
            dispatch({ type: "reset", plan: result.plan });
            setError(null);
            const dropped = result.droppedInterviewerIds.length;
            toast.success(
              dropped > 0
                ? `Plan copied. ${dropped} default interviewer${dropped === 1 ? "" : "s"} can't see this job and ${dropped === 1 ? "was" : "were"} left out.`
                : "Plan copied.",
            );
            router.refresh();
            return null;
          }}
        />
      )}
    </div>
  );
}

function PlanItemCard({
  item,
  first,
  last,
  members,
  canEdit,
  act,
  errorFor,
}: {
  item: DraftItem;
  first: boolean;
  last: boolean;
  members: MemberOption[];
  canEdit: boolean;
  act: (event: PlanEditorEvent) => void;
  errorFor: (key: string) => string | null;
}) {
  const id = (field: string) => `plan-${item.key}-${field}`;
  const nameError = errorFor(`${item.key}.name`);
  const durationError = errorFor(`${item.key}.duration_minutes`);
  const competenciesError = errorFor(`${item.key}.competencies`);
  const label = item.name.trim() || "New interview";

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4" aria-label={label} role="group">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor={id("name")}>Interview name</Label>
          <Input
            id={id("name")}
            value={item.name}
            maxLength={PLAN_LIMITS.name}
            placeholder="e.g. System design"
            disabled={!canEdit}
            aria-invalid={!!nameError}
            onChange={(e) => act({ type: "updateItem", key: item.key, patch: { name: e.target.value } })}
          />
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
        </div>
        <div className="flex w-32 flex-col gap-1.5">
          <Label htmlFor={id("duration")}>Minutes</Label>
          <Input
            id={id("duration")}
            type="number"
            inputMode="numeric"
            min={PLAN_LIMITS.durationMin}
            max={PLAN_LIMITS.durationMax}
            step={5}
            value={Number.isFinite(item.duration_minutes) ? item.duration_minutes : ""}
            disabled={!canEdit}
            aria-invalid={!!durationError}
            onChange={(e) =>
              act({ type: "updateItem", key: item.key, patch: { duration_minutes: e.target.valueAsNumber } })
            }
          />
          {durationError && <p className="text-xs text-destructive">{durationError}</p>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Move ${label} up`}
              disabled={first}
              onClick={() => act({ type: "moveItem", key: item.key, direction: -1 })}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Move ${label} down`}
              disabled={last}
              onClick={() => act({ type: "moveItem", key: item.key, direction: 1 })}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="destructive-ghost"
              size="icon"
              aria-label={`Remove ${label}`}
              onClick={() => act({ type: "removeItem", key: item.key })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("interviewers")}>Default interviewers</Label>
        <MemberPicker
          id={id("interviewers")}
          members={members}
          value={item.default_interviewer_ids}
          disabled={!canEdit}
          placeholder="None: pick when scheduling"
          onChange={(ids) => act({ type: "updateItem", key: item.key, patch: { default_interviewer_ids: ids } })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("instructions")}>Instructions for interviewers</Label>
        <Textarea
          id={id("instructions")}
          value={item.instructions}
          maxLength={PLAN_LIMITS.instructions}
          rows={3}
          disabled={!canEdit}
          placeholder="What this interview is for and how to run it."
          onChange={(e) => act({ type: "updateItem", key: item.key, patch: { instructions: e.target.value } })}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Competencies</p>
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={item.competencies.length >= PLAN_LIMITS.competenciesMax}
              onClick={() => act({ type: "addCompetency", itemKey: item.key })}
            >
              <Plus className="h-4 w-4" /> Add competency
            </Button>
          )}
        </div>
        {competenciesError && <p className="text-xs text-destructive">{competenciesError}</p>}
        <div className="divide-y rounded-lg border">
          {item.competencies.map((comp, c) => {
            const base = `${item.key}.competencies.${comp.key}`;
            const compName = comp.name.trim() || `Competency ${c + 1}`;
            const compNameError = errorFor(`${base}.name`);
            return (
              <div key={comp.key} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                    <Label htmlFor={id(`${comp.key}-name`)}>Competency</Label>
                    <Input
                      id={id(`${comp.key}-name`)}
                      value={comp.name}
                      maxLength={PLAN_LIMITS.competencyName}
                      placeholder="e.g. Problem solving"
                      disabled={!canEdit}
                      aria-invalid={!!compNameError}
                      onChange={(e) =>
                        act({
                          type: "updateCompetency",
                          itemKey: item.key,
                          key: comp.key,
                          patch: { name: e.target.value },
                        })
                      }
                    />
                    {compNameError && <p className="text-xs text-destructive">{compNameError}</p>}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${compName} up`}
                        disabled={c === 0}
                        onClick={() =>
                          act({ type: "moveCompetency", itemKey: item.key, key: comp.key, direction: -1 })
                        }
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${compName} down`}
                        disabled={c === item.competencies.length - 1}
                        onClick={() =>
                          act({ type: "moveCompetency", itemKey: item.key, key: comp.key, direction: 1 })
                        }
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        size="icon"
                        aria-label={`Remove ${compName}`}
                        onClick={() => act({ type: "removeCompetency", itemKey: item.key, key: comp.key })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
                <Textarea
                  aria-label={`${compName} description`}
                  value={comp.description}
                  maxLength={PLAN_LIMITS.competencyDescription}
                  rows={2}
                  disabled={!canEdit}
                  placeholder="What a strong answer shows."
                  onChange={(e) =>
                    act({
                      type: "updateCompetency",
                      itemKey: item.key,
                      key: comp.key,
                      patch: { description: e.target.value },
                    })
                  }
                />
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Suggested questions</p>
                  {comp.questions.map((q, qi) => {
                    const qError = errorFor(`${base}.questions.${qi}`);
                    return (
                      <div key={qi} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Input
                            aria-label={`${compName} question ${qi + 1}`}
                            value={q}
                            maxLength={PLAN_LIMITS.question}
                            disabled={!canEdit}
                            aria-invalid={!!qError}
                            onChange={(e) =>
                              act({
                                type: "updateQuestion",
                                itemKey: item.key,
                                competencyKey: comp.key,
                                index: qi,
                                text: e.target.value,
                              })
                            }
                          />
                          {canEdit && (
                            <Button
                              type="button"
                              variant="destructive-ghost"
                              size="icon"
                              aria-label={`Remove ${compName} question ${qi + 1}`}
                              onClick={() =>
                                act({ type: "removeQuestion", itemKey: item.key, competencyKey: comp.key, index: qi })
                              }
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        {qError && <p className="text-xs text-destructive">{qError}</p>}
                      </div>
                    );
                  })}
                  {canEdit && comp.questions.length < PLAN_LIMITS.questions && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={() => act({ type: "addQuestion", itemKey: item.key, competencyKey: comp.key })}
                    >
                      <Plus className="h-4 w-4" /> Add question
                    </Button>
                  )}
                  {!canEdit && comp.questions.length === 0 && (
                    <p className="text-sm text-muted-foreground">None.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CopyPlanDialog({
  open,
  onOpenChange,
  sources,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: CopySource[];
  /** Returns an error message, or null when it copied. */
  onCopy: (fromJobId: string) => Promise<string | null>;
}) {
  const [from, setFrom] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!from) return;
    setBusy(true);
    setError(null);
    try {
      const failure = await onCopy(from);
      if (failure) setError(failure);
      else {
        setFrom("");
        onOpenChange(false);
      }
    } catch {
      setError("Couldn't copy the plan. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy an interview plan</DialogTitle>
          <DialogDescription>
            This replaces this job&apos;s plan, including unsaved changes. Interviews are matched to stages by their
            kind. Interviews already scheduled keep their own copy.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="copy-plan-from">Copy from</Label>
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger id="copy-plan-from" aria-label="Copy from">
              <SelectValue placeholder="Pick a job" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.jobId} value={s.jobId}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="brand" onClick={submit} disabled={!from || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Replace plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraftPlanDialog({
  open,
  onOpenChange,
  hasPlan,
  onDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasPlan: boolean;
  /** Returns an error message, or null when it's done. */
  onDraft: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const failure = await onDraft();
      if (failure) setError(failure);
      else onOpenChange(false);
    } catch {
      setError("Couldn't draft an interview plan. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Draft an interview plan with AI</DialogTitle>
          <DialogDescription>
            AI suggests interviews for your stages, with competencies and questions, from this job&apos;s post.
            {hasPlan && " The draft replaces this job's plan in the editor, including unsaved changes."} Nothing is
            saved until you save. Uses {PLAN_DRAFT_COST} {labelFor("agent_messages", PLAN_DRAFT_COST)}.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="brand" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Draft plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
