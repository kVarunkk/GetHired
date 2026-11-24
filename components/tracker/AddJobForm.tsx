"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import AgentHandoff from "@/components/agent/AgentHandoff";
import StickyActionBar from "@/components/StickyActionBar";
import { AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { addTrackedApplicationAction } from "@/app/actions/tracker/add-tracked-application";
import { readJobFromUrlAction } from "@/app/actions/tracker/read-job-from-url";
import {
  addResultView,
  type AddResultView,
} from "@/helpers/tracker/add-result-copy";
import { todayIso } from "@/helpers/tracker/card";
import { TRACKER_COPY } from "@/helpers/tracker/copy";
import { myJobsPath, trackedApplicationPath } from "@/helpers/tracker/paths";
import { TRACKER_LIMITS } from "@/helpers/tracker/schema";
import {
  APPLIED_STATUSES,
  trackedStatusLabel,
  type TrackedStatus,
} from "@/helpers/tracker/status";

export type ResumeOption = { id: string; name: string | null };

type BoardState = "open" | "easy_apply" | "applied_on_gethired";
type BoardJob = {
  allJobsId: string;
  state: BoardState;
  applicationId: string | null;
};

const NO_RESUME = "none";
const STATUS_OPTIONS: TrackedStatus[] = ["saved", ...APPLIED_STATUSES];

/**
 * Add job (AT-REQ-036): paste a link to prefill, or just fill the form in. A
 * link that is already a job on GetHired is linked, not copied: its title,
 * company and place come from the job and aren't editable here. The status
 * starts as Saved from the Saved tab and Applied from Applications.
 */
export default function AddJobForm({
  defaultStatus,
  resumes,
}: {
  defaultStatus: "saved" | "applied";
  resumes: ResumeOption[];
}) {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AddResultView | null>(null);
  const [fromUrl, setFromUrl] = useState(false);
  const [board, setBoard] = useState<BoardJob | null>(null);

  const [jobTitle, setJobTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TrackedStatus>(defaultStatus);
  const [appliedAt, setAppliedAt] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [resumeId, setResumeId] = useState(NO_RESUME);

  // The link last read, so the same one is never read twice, and whether the
  // fields were filled by a read (then a new read may replace them).
  const lastRead = useRef<string | null>(null);
  const filledByRead = useRef(false);

  const backHref = myJobsPath({
    tab: defaultStatus === "saved" ? "saved" : "applications",
  });

  const changeLink = (value: string) => {
    setLink(value);
    // A different link is a different job: forget what the last one gave.
    if (board) {
      setBoard(null);
      setFromUrl(false);
    }
    if (board || filledByRead.current) {
      setJobTitle("");
      setCompanyName("");
      setLocation("");
      setDescription("");
      filledByRead.current = false;
    }
    lastRead.current = null;
    setNotice(null);
  };

  const readLink = () => {
    const url = link.trim();
    if (!url || url === lastRead.current || !/^https:\/\/\S+\.\S+/.test(url))
      return;
    lastRead.current = url;
    setNotice(null);
    startReading(async () => {
      const result = await readJobFromUrlAction(url);
      if (result.ok) {
        const { job } = result;
        // Never write over what the user typed themselves.
        const mayFill =
          filledByRead.current ||
          (!jobTitle && !companyName && !location && !description);
        if (mayFill || job.allJobsId) {
          setJobTitle(job.jobTitle);
          setCompanyName(job.companyName);
          setLocation(job.location ?? "");
          setDescription(job.description ?? "");
          filledByRead.current = true;
        }
        lastRead.current = job.jobUrl;
        setLink(job.jobUrl);
        setFromUrl(true);
        setBoard(
          job.allJobsId
            ? {
                allJobsId: job.allJobsId,
                state: job.boardState ?? "open",
                applicationId: job.applicationId,
              }
            : null,
        );
      } else {
        setLink(result.jobUrl ?? url);
        setNotice(result.error || TRACKER_COPY.urlUnreadable);
      }
    });
  };

  const submit = () => {
    startSaving(async () => {
      const common = {
        status,
        appliedAt: status === "saved" ? null : appliedAt || null,
        nextFollowUpAt: followUp || null,
        notes: notes || null,
        resumeId: resumeId === NO_RESUME ? null : resumeId,
      };
      const result = await addTrackedApplicationAction(
        board
          ? { allJobsId: board.allJobsId, ...common }
          : {
              jobTitle,
              companyName,
              jobUrl: link.trim() || null,
              location: location || null,
              jobDescription: description || null,
              ...common,
            },
        fromUrl ? "url" : "manual",
      );
      const view = addResultView(result);
      if (view.tone === "error") {
        toast.error(view.message);
        return;
      }
      setOutcome(view);
      router.refresh();
    });
  };

  // A job that was applied to through GetHired is already on the board, and an
  // Easy Apply job is applied to on GetHired (it can still be saved).
  const appliedThere = board?.state === "applied_on_gethired";
  const blocked =
    appliedThere || (board?.state === "easy_apply" && status !== "saved");
  const canSubmit =
    !blocked &&
    (board
      ? true
      : jobTitle.trim().length > 0 && companyName.trim().length > 0);

  if (outcome) {
    return (
      <div className="flex max-w-xl flex-col gap-3" role="status">
        <p className="text-sm font-medium">{outcome.message}</p>
        <div className="flex flex-wrap gap-2">
          {outcome.href && (
            <Button asChild variant="outline" size="sm">
              <Link href={outcome.href}>View</Link>
            </Button>
          )}
          <Button asChild size="sm" variant="ghost">
            <Link href={backHref}>Done</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit && !saving) submit();
      }}
    >
      <AgentHandoff
        label="Or tell the agent"
        placeholder="I applied to a designer role at Acme yesterday…"
        basePath={AGENT_PATH}
        toPrompt={(text) => `Track this job for me: ${text.trim()}`}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-job-link">Link to the job (optional)</Label>
        <div className="flex gap-2">
          <Input
            id="add-job-link"
            type="url"
            inputMode="url"
            placeholder="https://boards.greenhouse.io/…"
            value={link}
            onChange={(event) => changeLink(event.target.value)}
            onBlur={readLink}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                readLink();
              }
            }}
          />
          {reading && (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin self-center text-muted-foreground"
              aria-label="Reading the link"
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          We read the title and company from the page when you leave this field.
          You can change them after.
        </p>
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      </div>

      {/* Locked while the link is read, so nothing typed is overwritten. */}
      <fieldset disabled={reading} className="contents">
        {board ? (
          <BoardJobCard
            board={board}
            jobTitle={jobTitle}
            companyName={companyName}
            location={location}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="add-job-title" label="Job title">
              <Input
                id="add-job-title"
                value={jobTitle}
                maxLength={TRACKER_LIMITS.title}
                onChange={(e) => setJobTitle(e.target.value)}
              />
            </Field>
            <Field id="add-job-company" label="Company">
              <Input
                id="add-job-company"
                value={companyName}
                maxLength={TRACKER_LIMITS.company}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </Field>
            <Field id="add-job-location" label="Location (optional)">
              <Input
                id="add-job-location"
                value={location}
                maxLength={TRACKER_LIMITS.location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field id="add-job-description" label="Job description (optional)">
                <Textarea
                  id="add-job-description"
                  value={description}
                  maxLength={TRACKER_LIMITS.description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  placeholder="Paste it here, or leave the link above to fill it in."
                />
              </Field>
            </div>
          </div>
        )}

        {!appliedThere && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="add-job-status" label="Status">
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value as TrackedStatus)}
                >
                  <SelectTrigger id="add-job-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {trackedStatusLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {status !== "saved" && (
                <Field id="add-job-applied" label="Applied on">
                  <Input
                    id="add-job-applied"
                    type="date"
                    value={appliedAt}
                    onChange={(e) => setAppliedAt(e.target.value)}
                  />
                </Field>
              )}
              <Field id="add-job-followup" label="Follow up on (optional)">
                <Input
                  id="add-job-followup"
                  type="date"
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                />
              </Field>
              {resumes.length > 0 && (
                <Field id="add-job-resume" label="Resume used (optional)">
                  <Select value={resumeId} onValueChange={setResumeId}>
                    <SelectTrigger id="add-job-resume">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_RESUME}>None</SelectItem>
                      {resumes.map((resume) => (
                        <SelectItem key={resume.id} value={resume.id}>
                          {resume.name?.trim() || "Untitled resume"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
            <Field id="add-job-notes" label="Notes (optional)">
              <Textarea
                id="add-job-notes"
                value={notes}
                maxLength={TRACKER_LIMITS.notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
              />
            </Field>
          </>
        )}
      </fieldset>

      <StickyActionBar>
        <Button
          type="submit"
          variant="brand"
          disabled={saving || reading || !canSubmit}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {status === "saved" ? "Save job" : "Add application"}
        </Button>
        <Button asChild variant="ghost">
          <Link href={backHref}>Cancel</Link>
        </Button>
      </StickyActionBar>
    </form>
  );
}

/** A job that's already on GetHired: shown as it is, with what can be done with it. */
function BoardJobCard({
  board,
  jobTitle,
  companyName,
  location,
}: {
  board: BoardJob;
  jobTitle: string;
  companyName: string;
  location: string;
}) {
  return (
    <section
      aria-label="Job on GetHired"
      className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-4"
    >
      <p className="text-xs font-medium text-muted-foreground">
        This job is on GetHired, so we&apos;ll link it.
      </p>
      <p className="font-semibold">{jobTitle}</p>
      <p className="text-sm text-muted-foreground">
        {[companyName, location].filter(Boolean).join(" · ")}
      </p>
      {board.state === "applied_on_gethired" && board.applicationId && (
        <p className="pt-2 text-sm">
          You already applied through GetHired.{" "}
          <Link
            className="font-medium underline"
            href={trackedApplicationPath(board.applicationId)}
          >
            View your application
          </Link>
        </p>
      )}
      {board.state === "easy_apply" && (
        <p className="pt-2 text-sm">
          You apply to this one on GetHired and it lands on your board by
          itself.{" "}
          <Link
            className="font-medium underline"
            href={`/jobs/${board.allJobsId}`}
          >
            Open the job
          </Link>
          . You can still save it.
        </p>
      )}
    </section>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
