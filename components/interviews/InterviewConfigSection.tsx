"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Power, Sparkles, X } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveInterviewConfigAction } from "@/app/actions/interviews/save-interview-config";
import { suggestInterviewConfigAction } from "@/app/actions/interviews/suggest-interview-config";
import { useEntitlementError } from "@/hooks/useEntitlementError";
import StickyActionBar from "@/components/StickyActionBar";
import {
  DEFAULT_DEADLINE_DAYS,
  DEFAULT_DURATION_MINUTES,
  DEFAULT_FIT_THRESHOLD,
  INTERVIEW_DURATIONS,
  MAX_COMPETENCIES,
  MAX_COMPETENCY_DESCRIPTION_CHARS,
  MAX_COMPETENCY_NAME_CHARS,
  MAX_DEADLINE_DAYS,
  MAX_INTERVIEW_QUESTIONS,
  MAX_QUESTION_CHARS,
  MIN_DEADLINE_DAYS,
  type InterviewConfig,
  type InviteRule,
} from "@/helpers/interview/screening/schemas";

const DEFAULT_CONFIG: InterviewConfig = {
  enabled: false,
  invite_rule: "fit_threshold",
  fit_threshold: DEFAULT_FIT_THRESHOLD,
  questions: [],
  competencies: [],
  duration_minutes: DEFAULT_DURATION_MINUTES,
  deadline_days: DEFAULT_DEADLINE_DAYS,
  language: "en",
};

const DEADLINE_OPTIONS = Array.from(
  { length: MAX_DEADLINE_DAYS - MIN_DEADLINE_DAYS + 1 },
  (_, i) => MIN_DEADLINE_DAYS + i,
);

/**
 * A job's AI interview setup (SI-REQ-001/002, SIT-060): on/off, who gets
 * invited, competencies and must-ask questions (with Suggest), length and
 * deadline. The sticky bar saves the draft, and "Save and turn on" saves it
 * with the interview on in one go. "Turn off" saves only the off state (the
 * last saved setup), so a half-edited draft can't block it. Read-only
 * without interviews.manage and jobs.edit on the job. Put it on a page with
 * `p-4`: the save bar bleeds into that padding.
 */
export default function InterviewConfigSection({
  jobPostId,
  initialConfig,
  canEdit,
}: {
  jobPostId: string;
  initialConfig: InterviewConfig | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { handle: handleEntitlement, dialog: upgradeDialog } = useEntitlementError();
  const [draft, setDraft] = useState<InterviewConfig>(initialConfig ?? DEFAULT_CONFIG);
  const [saved, setSaved] = useState<InterviewConfig>(initialConfig ?? DEFAULT_CONFIG);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [unscreened, setUnscreened] = useState<number | null>(null);
  const [queueing, setQueueing] = useState(false);
  const disabled = !canEdit || saving || suggesting || toggling;

  const update = (patch: Partial<InterviewConfig>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };
  const fieldError = (field: string) => (error?.field === field ? error.message : undefined);

  async function suggest() {
    setSuggesting(true);
    const result = await suggestInterviewConfigAction({ jobPostId }).catch(() => null);
    setSuggesting(false);
    if (!result?.ok) {
      toast.error(result?.error ?? "Couldn't draft a setup. Try again.");
      return;
    }
    update({
      competencies: result.draft.competencies.slice(0, MAX_COMPETENCIES),
      questions: result.draft.questions.slice(0, MAX_INTERVIEW_QUESTIONS),
    });
    setNotes(result.notes);
  }

  /** Saves the draft with the interview on or off, so turning it on needs no separate save. */
  async function save(enabled: boolean) {
    setSaving(true);
    const result = await saveInterviewConfigAction({ jobPostId, config: { ...draft, enabled } }).catch(() => null);
    setSaving(false);
    if (!result) {
      toast.error("Couldn't save the interview. Try again.");
      return;
    }
    if (!result.ok) {
      // The save bar can be far from the field, so say it here too.
      setError({ message: result.error, field: result.field });
      toast.error(result.error);
      return;
    }
    setDraft(result.config);
    setSaved(result.config);
    setUnscreened(result.unscreened && result.unscreened > 0 ? result.unscreened : null);
    toast.success(result.config.enabled && !saved.enabled ? "AI interview saved and turned on." : "AI interview saved.");
    router.refresh();
  }

  /** Turns the interview off now, keeping the rest of the draft unsaved. */
  async function turnOff() {
    setToggling(true);
    const result = await saveInterviewConfigAction({ jobPostId, config: { ...saved, enabled: false } }).catch(
      () => null,
    );
    setToggling(false);
    if (!result?.ok) {
      toast.error(result?.error ?? "Couldn't turn the interview off. Try again.");
      return;
    }
    setSaved(result.config);
    setDraft((current) => ({ ...current, enabled: false }));
    setUnscreened(null);
    toast.success("AI interview turned off.");
    router.refresh();
  }

  async function screenUnscreened() {
    setQueueing(true);
    try {
      const res = await fetch(`/api/company/job-posts/${jobPostId}/screen`, { method: "POST" });
      if (await handleEntitlement(res)) return;
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Couldn't queue the screenings. Please try again.");
        return;
      }
      const queued: number = body?.queued ?? 0;
      toast.success(`Queued ${queued} screening${queued === 1 ? "" : "s"}.`);
      setUnscreened(null);
    } catch {
      toast.error("Couldn't queue the screenings. Please try again.");
    } finally {
      setQueueing(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      {upgradeDialog}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="interview-invite-rule">Who gets invited</Label>
          <Select
            value={draft.invite_rule}
            disabled={disabled}
            onValueChange={(value) =>
              update({
                invite_rule: value as InviteRule,
                fit_threshold: draft.fit_threshold ?? DEFAULT_FIT_THRESHOLD,
              })
            }
          >
            <SelectTrigger id="interview-invite-rule" aria-label="Who gets invited">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fit_threshold">Applicants above a fit score</SelectItem>
              <SelectItem value="manual">Only people I invite</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {draft.invite_rule === "fit_threshold" && (
          <div className="space-y-2">
            <Label htmlFor="interview-threshold">Minimum fit score</Label>
            <Input
              id="interview-threshold"
              type="number"
              min={0}
              max={100}
              value={draft.fit_threshold ?? ""}
              disabled={disabled}
              aria-invalid={!!fieldError("fit_threshold")}
              onChange={(e) => update({ fit_threshold: e.target.value === "" ? null : Number(e.target.value) })}
            />
            <FieldError message={fieldError("fit_threshold")} />
          </div>
        )}
      </div>
      {draft.invite_rule === "fit_threshold" ? (
        <p className="text-sm text-muted-foreground">
          Applicants scoring at least {draft.fit_threshold ?? DEFAULT_FIT_THRESHOLD} are invited. Each new applicant
          is screened automatically; uses your AI screening allowance. You can still invite anyone by hand.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Invite applicants from the applicants list or their page.</p>
      )}

      {unscreened !== null && canEdit && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">Applicants who applied before aren&apos;t screened yet.</p>
          <Button type="button" variant="outline" size="sm" disabled={queueing} onClick={() => void screenUnscreened()}>
            {queueing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Screen the {unscreened} unscreened applicant{unscreened === 1 ? "" : "s"}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold">Competencies</h4>
            <p className="text-xs text-muted-foreground">
              What the interviewer assesses and the report scores, 1 to {MAX_COMPETENCIES}.
            </p>
          </div>
          {canEdit && (
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void suggest()}>
              {suggesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Suggest from job description
            </Button>
          )}
        </div>
        {notes.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        {draft.competencies.map((competency, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-1">
                <Input
                  aria-label={`Competency ${i + 1} name`}
                  placeholder="Communication"
                  value={competency.name}
                  maxLength={MAX_COMPETENCY_NAME_CHARS}
                  disabled={disabled}
                  aria-invalid={!!fieldError(`competencies.${i}.name`)}
                  onChange={(e) =>
                    update({
                      competencies: draft.competencies.map((c, j) => (j === i ? { ...c, name: e.target.value } : c)),
                    })
                  }
                />
                <FieldError message={fieldError(`competencies.${i}.name`)} />
              </div>
              {canEdit && (
                <Button
                  type="button"
                  variant="destructive-ghost"
                  size="icon"
                  aria-label={`Remove competency ${i + 1}`}
                  disabled={disabled}
                  onClick={() => update({ competencies: draft.competencies.filter((_, j) => j !== i) })}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <Textarea
              aria-label={`Competency ${i + 1} description`}
              placeholder="Explains trade-offs clearly"
              rows={2}
              value={competency.description}
              maxLength={MAX_COMPETENCY_DESCRIPTION_CHARS}
              disabled={disabled}
              aria-invalid={!!fieldError(`competencies.${i}.description`)}
              onChange={(e) =>
                update({
                  competencies: draft.competencies.map((c, j) =>
                    j === i ? { ...c, description: e.target.value } : c,
                  ),
                })
              }
            />
            <FieldError message={fieldError(`competencies.${i}.description`)} />
          </div>
        ))}
        <FieldError message={fieldError("competencies")} />
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || draft.competencies.length >= MAX_COMPETENCIES}
            onClick={() => update({ competencies: [...draft.competencies, { name: "", description: "" }] })}
          >
            <Plus className="mr-2 h-4 w-4" /> Add competency
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold">Must-ask questions</h4>
          <p className="text-xs text-muted-foreground">
            Optional, up to {MAX_INTERVIEW_QUESTIONS}. The interviewer asks each one.
          </p>
        </div>
        {draft.questions.map((question, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1 space-y-1">
              <Input
                aria-label={`Question ${i + 1}`}
                value={question.text}
                maxLength={MAX_QUESTION_CHARS}
                disabled={disabled}
                aria-invalid={!!fieldError(`questions.${i}.text`)}
                onChange={(e) =>
                  update({ questions: draft.questions.map((q, j) => (j === i ? { text: e.target.value } : q)) })
                }
              />
              <FieldError message={fieldError(`questions.${i}.text`)} />
            </div>
            {canEdit && (
              <Button
                type="button"
                variant="destructive-ghost"
                size="icon"
                aria-label={`Remove question ${i + 1}`}
                disabled={disabled}
                onClick={() => update({ questions: draft.questions.filter((_, j) => j !== i) })}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || draft.questions.length >= MAX_INTERVIEW_QUESTIONS}
            onClick={() => update({ questions: [...draft.questions, { text: "" }] })}
          >
            <Plus className="mr-2 h-4 w-4" /> Add question
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="interview-duration">Length</Label>
          <Select
            value={String(draft.duration_minutes)}
            disabled={disabled}
            onValueChange={(value) => update({ duration_minutes: Number(value) as InterviewConfig["duration_minutes"] })}
          >
            <SelectTrigger id="interview-duration" aria-label="Interview length">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVIEW_DURATIONS.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes} minutes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="interview-deadline">Deadline after invite</Label>
          <Select
            value={String(draft.deadline_days)}
            disabled={disabled}
            onValueChange={(value) => update({ deadline_days: Number(value) })}
          >
            <SelectTrigger id="interview-deadline" aria-label="Deadline">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEADLINE_OPTIONS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {days} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && !error.field?.match(/^(competencies|questions|fit_threshold)/) && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      <StickyActionBar className="justify-between">
        <p className="text-sm text-muted-foreground">
          Cost: {draft.duration_minutes} interview minutes per invite, charged only when the interview is completed.
        </p>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {saved.enabled ? (
              <>
                <Button type="button" variant="outline" disabled={disabled} onClick={() => void turnOff()}>
                  {toggling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Turn off
                </Button>
                <Button type="button" variant="brand" disabled={disabled} onClick={() => void save(true)}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save interview
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={disabled} onClick={() => void save(false)}>
                  Save draft
                </Button>
                <Button type="button" variant="brand" disabled={disabled} onClick={() => void save(true)}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}
                  Save and turn on
                </Button>
              </>
            )}
          </div>
        )}
      </StickyActionBar>
    </section>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}
