"use client";

import { AlertTriangle } from "lucide-react";
import StageMapper from "@/components/candidates/StageMapper";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ImportPage } from "@/helpers/candidates/import-page";
import {
  DUPLICATE_ACTION_LABELS,
  DUPLICATE_ACTIONS,
  screeningWarning,
  type DuplicateAction,
  type JobPreview,
} from "@/helpers/candidates/preview-rows";
import type { StageChoices } from "@/helpers/candidates/stage-map";

/** Radix SelectItem can't have an empty value. */
const NONE = "none";
const NEW_LIST = "new";
const FIRST_STAGE = "first";

/** Where an import goes (CP-REQ-001): the pool only, a talent list, or a job (with an optional list). */
export type DestinationKind = "pool" | "list" | "job";

export type Destination = {
  kind: DestinationKind;
  /** An existing list's id, `"new"` for a new list, or null. */
  list: string | null;
  newListName: string;
  /** Null unless `kind` is "job". */
  jobId: string | null;
  /** Null: the first stage. Null without a job. */
  stageId: string | null;
  duplicateAction: DuplicateAction;
  /** False without a job. */
  autoInvite: boolean;
};

export type DestinationPage = Pick<ImportPage, "jobs" | "stages" | "lists" | "allowNoJob" | "screeningsRemaining" | "fixedJob">;

/** What the import actions take, from a destination (the same shape for every method). */
export type ImportDestinationValue = {
  jobPostId: string | null;
  talentListId?: string;
  newListName?: string;
  stageId: string | null;
  autoInvite: boolean;
};

const KIND_LABELS: Record<DestinationKind, string> = {
  pool: "Your candidates only",
  list: "A talent list",
  job: "A job",
};

/** The destinations the member can pick (CP-REQ-004): a job page's import always goes to its job. */
export function destinationKinds(page: DestinationPage): DestinationKind[] {
  if (page.fixedJob) return ["job"];
  return [
    ...(page.allowNoJob ? (["pool"] as const) : []),
    ...(page.allowNoJob && page.lists ? (["list"] as const) : []),
    ...(page.jobs.length > 0 ? (["job"] as const) : []),
  ];
}

/** Where an import starts: the job page's job, else the pool, else the member's first job. */
export function initialDestination(page: DestinationPage): Destination {
  const kind = destinationKinds(page)[0] ?? "pool";
  return {
    kind,
    list: null,
    newListName: "",
    jobId: kind === "job" ? (page.fixedJob?.id ?? page.jobs[0]?.id ?? null) : null,
    stageId: null,
    duplicateAction: "skip",
    autoInvite: false,
  };
}

/** The destination with a new kind: anything that only applies to a job is cleared without one. */
export function withKind(page: DestinationPage, value: Destination, kind: DestinationKind): Destination {
  if (kind === value.kind) return value;
  return {
    ...value,
    kind,
    list: null,
    newListName: "",
    jobId: kind === "job" ? (page.fixedJob?.id ?? page.jobs[0]?.id ?? null) : null,
    stageId: null,
    autoInvite: false,
  };
}

/** Whether the destination is complete: a list destination needs a list, a new list a name. */
export function destinationReady(value: Destination): boolean {
  if (value.kind === "list" && !value.list) return false;
  if (value.kind === "job" && !value.jobId) return false;
  return value.list !== NEW_LIST || value.newListName.trim().length > 0;
}

/** The job of the destination, with its interview rule, or null. */
export function destinationJob(page: DestinationPage, value: Destination) {
  if (value.kind !== "job" || !value.jobId) return null;
  if (page.fixedJob?.id === value.jobId) return page.fixedJob;
  return page.jobs.find((j) => j.id === value.jobId) ?? null;
}

/** What to send for `value`. */
export function destinationValue(page: DestinationPage, value: Destination): ImportDestinationValue {
  const job = destinationJob(page, value);
  return {
    jobPostId: job?.id ?? null,
    ...(value.list === NEW_LIST
      ? { newListName: value.newListName.trim() }
      : value.list
        ? { talentListId: value.list }
        : {}),
    stageId: job ? value.stageId : null,
    autoInvite: !!job?.interview && value.autoInvite,
  };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * The destination step every import method shares (CP-REQ-001/003/010,
 * BI-REQ-014/015/015a/015b/015c/018): your candidates only, a talent list
 * (optionally a new one) or a job and stage (with an optional list), what
 * to do with existing candidates, the Stage column's values, the
 * auto-invite switch for a job whose AI interview invites by fit score (off
 * by default), and how many screenings a job import uses. On a job page
 * (`page.fixedJob`) the job isn't a choice.
 */
export default function ImportDestination({
  page,
  value,
  onChange,
  stageValues = [],
  stageChoices = {},
  onStageChoicesChange = () => {},
  jobPreview = null,
  showDuplicateAction = true,
  idPrefix = "import",
  disabled = false,
}: {
  page: DestinationPage;
  value: Destination;
  onChange: (value: Destination) => void;
  /** The Stage column's values; empty when no column maps to Stage. */
  stageValues?: string[];
  stageChoices?: StageChoices;
  onStageChoicesChange?: (choices: StageChoices) => void;
  jobPreview?: JobPreview | null;
  showDuplicateAction?: boolean;
  idPrefix?: string;
  disabled?: boolean;
}) {
  const set = (patch: Partial<Destination>) => onChange({ ...value, ...patch });
  const kinds = destinationKinds(page);
  const job = destinationJob(page, value);
  const stageName = page.stages.find((s) => s.id === value.stageId)?.name ?? page.stages[0]?.name ?? "the first stage";
  const warning = job && jobPreview && screeningWarning(jobPreview.scored, page.screeningsRemaining);
  const id = (name: string) => `${idPrefix}-${name}`;
  const showList = !!page.lists && (value.kind === "list" || value.kind === "job");

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {page.fixedJob ? (
          <p className="text-sm sm:col-span-2">
            Importing into <span className="font-semibold">{page.fixedJob.title}</span>
          </p>
        ) : (
          kinds.length > 1 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={id("destination")}>Add them to</Label>
              <Select
                value={value.kind}
                onValueChange={(next) => onChange(withKind(page, value, next as DestinationKind))}
                disabled={disabled}
              >
                <SelectTrigger id={id("destination")} aria-label="Add them to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        )}

        {value.kind === "job" && !page.fixedJob && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={id("job")}>Job</Label>
            <Select
              value={value.jobId ?? ""}
              onValueChange={(next) => set({ jobId: next, autoInvite: false })}
              disabled={disabled}
            >
              <SelectTrigger id={id("job")} aria-label="Job">
                <SelectValue placeholder="Pick a job" />
              </SelectTrigger>
              <SelectContent>
                {page.jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {job && page.stages.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={id("stage")}>Stage</Label>
            <Select
              value={value.stageId ?? FIRST_STAGE}
              onValueChange={(next) => set({ stageId: next === FIRST_STAGE ? null : next })}
              disabled={disabled}
            >
              <SelectTrigger id={id("stage")} aria-label="Stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FIRST_STAGE}>First stage ({page.stages[0].name})</SelectItem>
                {page.stages.slice(1).map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {showList && page.lists && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={id("list")}>
              {value.kind === "list" ? "Talent list" : "Also add them to a talent list (optional)"}
            </Label>
            <Select
              value={value.list ?? (value.kind === "list" ? "" : NONE)}
              onValueChange={(next) => set({ list: next === NONE ? null : next })}
              disabled={disabled}
            >
              <SelectTrigger id={id("list")} aria-label="Talent list">
                <SelectValue placeholder="Pick a list" />
              </SelectTrigger>
              <SelectContent>
                {value.kind === "job" && <SelectItem value={NONE}>No list</SelectItem>}
                <SelectItem value={NEW_LIST}>New list…</SelectItem>
                {page.lists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {value.list === NEW_LIST && (
              <Input
                aria-label="New list name"
                placeholder="List name"
                value={value.newListName}
                maxLength={200}
                onChange={(e) => set({ newListName: e.target.value })}
                disabled={disabled}
              />
            )}
          </div>
        )}

        {showDuplicateAction && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={id("duplicates")}>If someone is already a candidate</Label>
            <Select
              value={value.duplicateAction}
              onValueChange={(next) => set({ duplicateAction: next as DuplicateAction })}
              disabled={disabled}
            >
              <SelectTrigger id={id("duplicates")} aria-label="If someone is already a candidate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DUPLICATE_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {DUPLICATE_ACTION_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">You can change it for each row below.</p>
          </div>
        )}
      </div>

      {job && (
        <StageMapper
          values={stageValues}
          stages={page.stages}
          choices={stageChoices}
          destinationName={stageName}
          onChange={onStageChoicesChange}
          disabled={disabled}
        />
      )}

      {job?.interview && (
        <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor={id("auto-invite")}>Auto-invite to AI interview</Label>
            <p className="text-sm text-muted-foreground">
              Invite people who score {job.interview.fitThreshold} or more; each invite holds{" "}
              {plural(job.interview.durationMinutes, "interview minute", "interview minutes")}. Off: they&apos;re scored,
              and you invite them yourself.
            </p>
          </div>
          <Switch
            id={id("auto-invite")}
            checked={value.autoInvite}
            onCheckedChange={(checked) => set({ autoInvite: checked })}
            disabled={disabled}
          />
        </div>
      )}

      {job && jobPreview && (
        <div className="flex flex-col gap-1 text-sm" role="status">
          <p>
            {plural(jobPreview.scored, "person has", "people have")} enough detail to be scored, using{" "}
            {plural(jobPreview.scored, "screening", "screenings")}.
          </p>
          {jobPreview.unscored > 0 && (
            <p className="text-muted-foreground">
              {plural(jobPreview.unscored, "of these has", "of these have")} no resume and won&apos;t be scored until you
              add one.
            </p>
          )}
          {jobPreview.noEmail > 0 && (
            <p className="text-muted-foreground">
              {plural(jobPreview.noEmail, "row has", "rows have")} no email: imported as candidates, but not added to the
              job.
            </p>
          )}
          {jobPreview.known > 0 && (
            <p className="text-muted-foreground">
              {plural(jobPreview.known, "person is", "people are")} already in your pipeline on GetHired: no new
              application is made for them.
            </p>
          )}
          {warning && (
            <p className="mt-1 flex items-start gap-1.5 text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {warning}
            </p>
          )}
        </div>
      )}

      <p className="text-sm text-muted-foreground">No one will be emailed by this import.</p>
    </div>
  );
}
