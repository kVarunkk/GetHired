"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import StickyActionBar from "@/components/StickyActionBar";
import { AGENT_PATH, agentPromptHref } from "@/helpers/agent/prompt-draft";
import { removeTrackedApplicationAction } from "@/app/actions/tracker/remove-tracked-application";
import { setTrackedStatusAction } from "@/app/actions/tracker/set-tracked-status";
import { updateTrackedApplicationAction } from "@/app/actions/tracker/update-tracked-application";
import type { TimelineEvent } from "@/helpers/tracker/detail";
import { canPracticeInterview, practiceInterviewPrompt, tailorResumePrompt } from "@/helpers/tracker/agent-prompts";
import { myJobsPath } from "@/helpers/tracker/paths";
import { TRACKER_LIMITS } from "@/helpers/tracker/schema";
import { TRACKED_STATUSES, trackedStatusLabel, type TrackedStatus } from "@/helpers/tracker/status";
import type { ResumeOption } from "./AddJobForm";

export type TrackedDetailRow = {
  id: string;
  /** Set when the card is a GetHired job: its title, company, link and place come from the job. */
  allJobsId: string | null;
  jobTitle: string;
  companyName: string;
  jobUrl: string | null;
  location: string | null;
  jobDescription: string | null;
  status: TrackedStatus;
  appliedAt: string | null;
  nextFollowUpAt: string | null;
  notes: string | null;
  contactName: string | null;
  resumeId: string | null;
  /** The linked board job is no longer open. */
  jobClosed?: boolean;
  salaryAmount: number | null;
  salaryCurrency: string | null;
};

const NO_RESUME = "none";
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** A tracked card's page (AT-REQ-023): the editable fields, the timeline and its actions. */
export default function TrackedDetail({
  row,
  events,
  resumes,
}: {
  row: TrackedDetailRow;
  events: TimelineEvent[];
  resumes: ResumeOption[];
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [removing, setRemoving] = useState(false);
  const [jobTitle, setJobTitle] = useState(row.jobTitle);
  const [companyName, setCompanyName] = useState(row.companyName);
  const [jobUrl, setJobUrl] = useState(row.jobUrl ?? "");
  const [location, setLocation] = useState(row.location ?? "");
  const [jobDescription, setJobDescription] = useState(row.jobDescription ?? "");
  const [status, setStatus] = useState<TrackedStatus>(row.status);
  const [appliedAt, setAppliedAt] = useState(row.appliedAt ?? "");
  const [followUp, setFollowUp] = useState(row.nextFollowUpAt ?? "");
  const [contactName, setContactName] = useState(row.contactName ?? "");
  const [resumeId, setResumeId] = useState(row.resumeId ?? NO_RESUME);
  const [notes, setNotes] = useState(row.notes ?? "");

  const linked = row.allJobsId !== null;

  const save = () =>
    startSaving(async () => {
      const update = await updateTrackedApplicationAction(row.id, {
        ...(linked ? {} : { jobTitle, companyName, jobUrl: jobUrl || null, location: location || null, jobDescription: jobDescription || null }),
        appliedAt: appliedAt || null,
        nextFollowUpAt: followUp || null,
        contactName: contactName || null,
        resumeId: resumeId === NO_RESUME ? null : resumeId,
        notes: notes || null,
      });
      if (!update.ok) {
        toast.error(update.error);
        return;
      }
      if (status !== row.status && status !== "saved") {
        const moved = await setTrackedStatusAction({ id: row.id, status });
        if (!moved.ok) {
          toast.error(moved.error);
          return;
        }
      }
      toast.success("Saved");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {row.jobUrl && (
          <Button asChild variant="outline" size="sm">
            <a href={row.jobUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1 h-4 w-4" />
              Open posting
            </a>
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href={agentPromptHref(tailorResumePrompt(row), AGENT_PATH)}>Tailor resume</Link>
        </Button>
        {canPracticeInterview(row) && (
          <Button asChild variant="outline" size="sm">
            <Link href={agentPromptHref(practiceInterviewPrompt(row), AGENT_PATH)}>Practice interview</Link>
          </Button>
        )}
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setRemoving(true)}>
          Remove
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {linked ? (
              <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground sm:col-span-2">
                This is a job on GetHired, so its title, company and location come from the job.
                {row.jobClosed && " The company has closed this posting."}{" "}
                <Link className="font-medium text-foreground underline" href={`/jobs/${row.allJobsId}`}>
                  Open the job
                </Link>
              </p>
            ) : (
              <>
                <Field id="td-title" label="Job title">
                  <Input id="td-title" value={jobTitle} maxLength={TRACKER_LIMITS.title} onChange={(e) => setJobTitle(e.target.value)} />
                </Field>
                <Field id="td-company" label="Company">
                  <Input id="td-company" value={companyName} maxLength={TRACKER_LIMITS.company} onChange={(e) => setCompanyName(e.target.value)} />
                </Field>
                <Field id="td-url" label="Link">
                  <Input id="td-url" type="url" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} />
                </Field>
                <Field id="td-location" label="Location">
                  <Input id="td-location" value={location} maxLength={TRACKER_LIMITS.location} onChange={(e) => setLocation(e.target.value)} />
                </Field>
              </>
            )}
            <Field id="td-status" label="Status">
              <Select value={status} onValueChange={(value) => setStatus(value as TrackedStatus)}>
                <SelectTrigger id="td-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* A card can leave Saved but never go back to it. */}
                  {TRACKED_STATUSES.filter((option) => option !== "saved" || row.status === "saved").map((option) => (
                    <SelectItem key={option} value={option}>
                      {trackedStatusLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {status !== "saved" && (
              <Field id="td-applied" label="Applied on">
                <Input id="td-applied" type="date" value={appliedAt} onChange={(e) => setAppliedAt(e.target.value)} />
              </Field>
            )}
            <Field id="td-followup" label="Follow up on">
              <Input id="td-followup" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            </Field>
            <Field id="td-contact" label="Contact">
              <Input id="td-contact" value={contactName} maxLength={TRACKER_LIMITS.contact} onChange={(e) => setContactName(e.target.value)} />
            </Field>
            {resumes.length > 0 && (
              <Field id="td-resume" label="Resume used">
                <Select value={resumeId} onValueChange={setResumeId}>
                  <SelectTrigger id="td-resume">
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
            {row.salaryAmount != null && (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                Salary: {row.salaryAmount.toLocaleString()} {row.salaryCurrency ?? ""} a year
              </p>
            )}
          </div>
          {!linked && (
            <Field id="td-description" label="Job description">
              <Textarea
                id="td-description"
                rows={8}
                value={jobDescription}
                maxLength={TRACKER_LIMITS.description}
                onChange={(e) => setJobDescription(e.target.value)}
              />
            </Field>
          )}
          <Field id="td-notes" label="Notes">
            <Textarea id="td-notes" rows={6} value={notes} maxLength={TRACKER_LIMITS.notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <StickyActionBar>
            <Button type="submit" variant="brand" disabled={saving || (!linked && (!jobTitle.trim() || !companyName.trim()))}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </StickyActionBar>
        </form>

        <section aria-label="Timeline" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Timeline</h2>
          <ol className="flex flex-col gap-2 border-l pl-4 text-sm">
            {events.map((event) => (
              <li key={event.id}>
                <span className="font-medium">
                  {event.kind === "created" ? `Added as ${trackedStatusLabel(event.toStatus)}` : `Moved to ${trackedStatusLabel(event.toStatus)}`}
                </span>
                <span className="block text-xs text-muted-foreground">{when(event.createdAt)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove this application?"
        description="It is removed from My Jobs along with its notes and timeline."
        confirmLabel="Remove"
        onConfirm={async () => {
          const result = await removeTrackedApplicationAction(row.id);
          if (!result.ok) {
            toast.error(result.error);
            return false;
          }
          router.push(myJobsPath({ tab: row.status === "saved" ? "saved" : "applications" }));
        }}
      />
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
