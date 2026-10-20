"use client";

import { describeApplicationForm } from "@/helpers/jobs/describe-application-form";
import { memo, useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { ChevronDown, Coins, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/utils";
import ResumeUploadWidget, { type ResumeUploadOutput } from "./ResumeUploadWidget";
import { rehypeAnimateWords } from "./animate-words";
import { inlineLink, isInAppHref, NEW_TAB } from "./links";
import {
  ApplicantResults,
  type ApplicantRowData,
  CandidateResults,
  type CandidateRowData,
} from "./recruiter/RecruiterResults";
import { FunnelResult, type FunnelResultData } from "./recruiter/FunnelResult";
import { JobDeleteApprovalDetails } from "./recruiter/JobDeleteApprovalCard";
import { MoveApprovalDetails } from "./recruiter/MoveApprovalCard";
import { OutreachApprovalDetails } from "./recruiter/OutreachApprovalCard";
import { InterviewConfigApprovalDetails, InterviewInviteApprovalDetails } from "./recruiter/InterviewApprovalCard";
import { isRoleApprovalTool, RoleApprovalDetails } from "./recruiter/RoleApprovalCard";

export { isInAppHref };

type MessagePart = UIMessage["parts"][number];
type ToolPart = Extract<MessagePart, { toolCallId: string }>;
type ApprovalHandler = (response: { id: string; approved: boolean }) => void;
type ToolOutputHandler = (toolCallId: string, output: ResumeUploadOutput) => void;

/** Present-tense and past-tense labels for each tool. */
const TOOL_LABELS: Record<string, { running: string; done: string; action: string }> = {
  getMyProfile: { running: "Reading your profile…", done: "Read your profile", action: "read your profile" },
  updateMyPreferences: { running: "Updating your preferences…", done: "Updated your job preferences", action: "update your job preferences" },
  searchJobs: { running: "Searching jobs…", done: "Searched jobs", action: "search jobs" },
  naturalLanguageJobSearch: { running: "Searching jobs with AI…", done: "Searched jobs with AI", action: "search jobs" },
  findRelevantJobs: { running: "Finding jobs that match you…", done: "Found matching jobs", action: "find matching jobs" },
  findSimilarJobs: { running: "Finding similar jobs…", done: "Found similar jobs", action: "find similar jobs" },
  getJobDetails: { running: "Reading the job…", done: "Read the job details", action: "read the job" },
  saveJob: { running: "Saving the job…", done: "Saved the job", action: "save the job" },
  unsaveJob: { running: "Removing the saved job…", done: "Removed the saved job", action: "remove the saved job" },
  listSavedJobs: { running: "Loading saved jobs…", done: "Loaded saved jobs", action: "load saved jobs" },
  listApplications: { running: "Loading applications…", done: "Loaded applications", action: "load applications" },
  updateApplicationStatus: { running: "Updating the application…", done: "Updated the application", action: "update the application" },
  listResumes: { running: "Loading resumes…", done: "Loaded resumes", action: "load resumes" },
  setPrimaryResume: { running: "Setting the primary resume…", done: "Set the primary resume", action: "set the primary resume" },
  requestResumeUpload: { running: "Waiting for your upload…", done: "Resume upload finished", action: "upload a resume" },
  startResumeReview: { running: "Starting the review…", done: "Started the resume review", action: "start a resume review" },
  getResumeReview: { running: "Loading the review…", done: "Loaded the review", action: "load the review" },
  listInterviews: { running: "Loading interviews…", done: "Loaded interviews", action: "load interviews" },
  getInterviewAnalysis: { running: "Reading the interview feedback…", done: "Read the interview feedback", action: "read the interview feedback" },
  createInterview: { running: "Setting up the interview…", done: "Set up the interview", action: "set up the interview" },
  completeOnboarding: { running: "Setting up your profile…", done: "Profile set up", action: "set up your profile" },
  saveMemory: { running: "Remembering…", done: "Saved to memory", action: "save a memory" },
  deleteMemory: { running: "Forgetting…", done: "Removed from memory", action: "remove a memory" },
  // Recruiter tools (RA spec §4.7).
  getMyCompany: { running: "Checking your plan…", done: "Checked your plan", action: "check your plan" },
  listMyJobs: { running: "Loading your job posts…", done: "Loaded your job posts", action: "load your job posts" },
  getJobPost: { running: "Reading the job post…", done: "Read the job post", action: "read the job post" },
  createJobPost: { running: "Saving the job post…", done: "Saved the job post", action: "create the job post" },
  updateJobPost: { running: "Updating the job post…", done: "Updated the job post", action: "update the job post" },
  setJobPostStatus: { running: "Updating the job post…", done: "Updated the job post", action: "change the job post's status" },
  deleteJobPost: { running: "Deleting the job post…", done: "Deleted the job post", action: "delete the job post" },
  listQuestionSets: { running: "Loading question sets…", done: "Loaded question sets", action: "load question sets" },
  applyQuestionSet: { running: "Applying the question set…", done: "Applied the question set", action: "apply the question set" },
  saveQuestionSet: { running: "Saving the question set…", done: "Saved the question set", action: "save the question set" },
  deleteQuestionSet: { running: "Deleting the question set…", done: "Deleted the question set", action: "delete the question set" },
  searchCandidates: { running: "Searching candidates…", done: "Searched candidates", action: "search candidates" },
  findMatchesForJob: { running: "Finding matched candidates…", done: "Found matched candidates", action: "find matched candidates" },
  runMatchingForJob: { running: "Starting matching…", done: "Started matching", action: "start matching" },
  getCandidateProfile: { running: "Reading the profile…", done: "Read the profile", action: "read the profile" },
  compareCandidates: { running: "Comparing candidates…", done: "Compared candidates", action: "compare candidates" },
  explainMatch: { running: "Explaining the match…", done: "Explained the match", action: "explain the match" },
  saveCandidate: { running: "Saving the candidate…", done: "Saved the candidate", action: "save the candidate" },
  unsaveCandidate: { running: "Removing the candidate…", done: "Removed the saved candidate", action: "remove the saved candidate" },
  listApplicants: { running: "Loading applicants…", done: "Loaded applicants", action: "load applicants" },
  getApplication: { running: "Reading the application…", done: "Read the application", action: "read the application" },
  screenApplicants: { running: "Queueing screenings…", done: "Queued screenings", action: "screen applicants" },
  listStages: { running: "Loading your pipeline…", done: "Loaded your pipeline", action: "load your pipeline" },
  createStage: { running: "Adding the stage…", done: "Added the stage", action: "add a pipeline stage" },
  renameStage: { running: "Renaming the stage…", done: "Renamed the stage", action: "rename the stage" },
  reorderStages: { running: "Reordering your stages…", done: "Reordered your stages", action: "reorder your stages" },
  archiveStage: { running: "Archiving the stage…", done: "Archived the stage", action: "archive the stage" },
  listEmailTemplates: { running: "Loading email templates…", done: "Loaded email templates", action: "load your email templates" },
  createEmailTemplate: { running: "Saving the template…", done: "Saved the template", action: "add an email template" },
  updateEmailTemplate: { running: "Updating the template…", done: "Updated the template", action: "edit the email template" },
  deleteEmailTemplate: { running: "Deleting the template…", done: "Deleted the template", action: "delete the email template" },
  moveApplications: { running: "Moving applications…", done: "Moved applications", action: "move applications" },
  addNote: { running: "Saving the note…", done: "Saved the note", action: "add a note" },
  listNotes: { running: "Reading notes…", done: "Read the notes", action: "read the notes" },
  updateNote: { running: "Updating the note…", done: "Updated the note", action: "edit the note" },
  deleteNote: { running: "Deleting the note…", done: "Deleted the note", action: "delete the note" },
  addToTalentList: { running: "Adding to the list…", done: "Added to the list", action: "add the candidate to a list" },
  listTalentLists: { running: "Checking your talent lists…", done: "Checked your talent lists", action: "read your talent lists" },
  renameTalentList: { running: "Renaming the list…", done: "Renamed the list", action: "rename the list" },
  removeFromTalentList: { running: "Removing from the list…", done: "Removed from the list", action: "take the candidate off the list" },
  deleteTalentList: { running: "Deleting the list…", done: "Deleted the list", action: "delete the list" },
  getHiringFunnel: { running: "Loading the funnel…", done: "Loaded the hiring funnel", action: "load the hiring funnel" },
  sendOutreach: { running: "Sending the message…", done: "Sent the message", action: "message the candidate" },
  listOutreach: { running: "Loading your outreach…", done: "Loaded your outreach", action: "load your outreach" },
  getOutreach: { running: "Reading the message…", done: "Read the message", action: "read the message" },
  withdrawOutreach: { running: "Withdrawing the message…", done: "Withdrew the message", action: "withdraw the message" },
  // Team and roles (RP-REQ-032).
  listTeam: { running: "Loading your team…", done: "Loaded your team", action: "load your team" },
  listRoles: { running: "Loading roles…", done: "Loaded roles", action: "load roles" },
  getRole: { running: "Reading the role…", done: "Read the role", action: "read the role" },
  createRole: { running: "Creating the role…", done: "Created the role", action: "create the role" },
  updateRole: { running: "Updating the role…", done: "Updated the role", action: "update the role" },
  deleteRole: { running: "Deleting the role…", done: "Deleted the role", action: "delete the role" },
  assignRole: { running: "Changing the role…", done: "Changed the member's role", action: "change the member's role" },
  setDefaultRole: { running: "Changing the default role…", done: "Changed the default role", action: "change the default role" },
  removeTeamMember: { running: "Removing the member…", done: "Removed them from the team", action: "remove them from the team" },
  assignToJob: { running: "Updating the hiring team…", done: "Added to the hiring team", action: "add them to the hiring team" },
  unassignFromJob: { running: "Updating the hiring team…", done: "Removed from the hiring team", action: "remove them from the hiring team" },
  listInvites: { running: "Loading invites…", done: "Loaded invites", action: "load invites" },
  inviteTeamMember: { running: "Sending the invite…", done: "Sent the invite", action: "invite them to the team" },
  resendInvite: { running: "Resending the invite…", done: "Resent the invite", action: "resend the invite" },
  revokeInvite: { running: "Revoking the invite…", done: "Revoked the invite", action: "revoke the invite" },
  // Careers page.
  getCareersPage: { running: "Reading the careers page…", done: "Read the careers page", action: "read the careers page" },
  updateCareersPage: { running: "Updating the careers page…", done: "Updated the careers page", action: "update the careers page" },
  setCareersAddress: { running: "Changing the address…", done: "Changed the careers page address", action: "change the careers page address" },
  setCareersPublished: { running: "Updating the careers page…", done: "Updated the careers page", action: "publish the careers page" },
  // Screening interviews (SIT-071).
  getInterviewSetup: { running: "Reading the interview setup…", done: "Read the interview setup", action: "read the interview setup" },
  configureScreeningInterview: { running: "Saving the interview setup…", done: "Saved the interview setup", action: "set up the AI interview" },
  inviteToInterview: { running: "Sending interview invites…", done: "Sent interview invites", action: "invite applicants to the AI interview" },
  getInterviewReport: { running: "Reading the interview report…", done: "Read the interview report", action: "read the interview report" },
  compareInterviewReports: { running: "Comparing interviews…", done: "Compared interviews", action: "compare interview reports" },
};

const labelsFor = (name: string) =>
  TOOL_LABELS[name] ?? { running: `Running ${name}…`, done: `Done: ${name}`, action: name };

/**
 * One step in the agent's trail. The node encodes the step's state:
 * running (pulsing), done (filled), yours to answer (indigo), failed (red),
 * declined (hollow).
 */
type StepTone = "running" | "done" | "yours" | "failed" | "declined";

const NODE_STYLES: Record<StepTone, string> = {
  running: "border-muted-foreground/60 bg-background animate-pulse",
  done: "border-foreground/25 bg-foreground/25",
  yours: "border-brand bg-brand",
  failed: "border-destructive bg-destructive",
  declined: "border-muted-foreground/50 bg-background",
};

export function StepNode({ tone }: { tone: StepTone }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute left-0 top-[0.4rem] h-[11px] w-[11px] rounded-full border-2",
        NODE_STYLES[tone],
      )}
    />
  );
}

function Step({
  tone,
  label,
  children,
}: {
  tone: StepTone;
  label: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    // Each step draws the connector down to the next step's node (across the
    // gap-3 and the next node's top offset); the last step draws none.
    <li className="relative pl-6 before:absolute before:-bottom-[1.15rem] before:left-[5px] before:top-[1.1rem] before:w-px before:bg-border last:before:hidden">
      <StepNode tone={tone} />
      <div
        className={cn(
          "text-sm leading-6",
          tone === "failed" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {tone === "running" ? <span className="agent-shimmer">{label}</span> : label}
      </div>
      {children && <div className="mt-2">{children}</div>}
    </li>
  );
}

type CompactJob = {
  id: string;
  title: string | null;
  company: string | null;
  locations?: string[];
  salary?: string | null;
  postedAt?: string | null;
  url: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Longer job lists start collapsed to this many rows. */
const COLLAPSED_JOB_COUNT = 10;

function postedAgo(postedAt: string | null | undefined) {
  if (!postedAt) return null;
  const days = Math.floor((Date.now() - new Date(postedAt).getTime()) / DAY_MS);
  if (Number.isNaN(days) || days < 0) return null;
  if (days === 0) return "Today";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * A job row's layout. On phones the salary drops to its own line next to the
 * date, so it can't squeeze the title and company down to nothing.
 */
const JOB_ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 [grid-template-areas:'title_title'_'meta_meta'_'salary_posted'] sm:[grid-template-areas:'title_salary'_'meta_posted']";

/** Jobs as scannable rows, like the job board, not a grid of cards. */
function JobResults({ jobs, totalCount }: { jobs: CompactJob[]; totalCount?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (jobs.length === 0) {
    return <p className="text-sm text-muted-foreground">No jobs found.</p>;
  }

  const hidden = jobs.length - COLLAPSED_JOB_COUNT;
  const visible = expanded ? jobs : jobs.slice(0, COLLAPSED_JOB_COUNT);

  return (
    <div className="overflow-hidden rounded-lg border">
      <ul className="divide-y">
        {visible.map((job) => {
          const posted = postedAgo(job.postedAt);
          return (
            <li key={job.id}>
              <Link
                {...NEW_TAB}
                href={job.url}
                className={cn(
                  JOB_ROW_GRID,
                  "px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                )}
              >
                <span className="truncate text-sm font-medium text-foreground [grid-area:title]">
                  {job.title ?? "Untitled role"}
                </span>
                <span className="min-w-0 truncate text-sm tabular-nums text-foreground [grid-area:salary] sm:text-right">
                  {job.salary}
                </span>
                <span className="flex min-w-0 items-center gap-3 text-[13px] text-muted-foreground [grid-area:meta]">
                  {job.company && <span className="min-w-0 truncate">{job.company}</span>}
                  {job.locations && job.locations.length > 0 && (
                    // Shrinks before the company does, so the company name stays readable.
                    <span className="flex min-w-0 shrink-[3] items-center gap-1">
                      <MapPin aria-hidden className="h-3 w-3 shrink-0" />
                      <span className="truncate">{job.locations.join(", ")}</span>
                    </span>
                  )}
                </span>
                <span
                  className="self-center text-right text-xs tabular-nums text-muted-foreground [grid-area:posted]"
                  suppressHydrationWarning
                >
                  {posted}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="flex w-full items-center justify-center gap-1.5 border-t px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:outline-none"
        >
          {expanded ? "Show fewer jobs" : `Show ${hidden} more ${hidden === 1 ? "job" : "jobs"}`}
          <ChevronDown
            aria-hidden
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
          />
        </button>
      )}
      {typeof totalCount === "number" && totalCount > jobs.length && (
        <p className="border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          Showing {jobs.length} of {totalCount.toLocaleString("en-US")} jobs. Ask for more to see the
          next page.
        </p>
      )}
    </div>
  );
}

/** Readable names for the fields shown on approval cards. */
const FIELD_LABELS: Record<string, string> = {
  fullName: "Name",
  desiredRoles: "Roles",
  jobTypes: "Job types",
  salaryCurrency: "Currency",
  minSalary: "Min salary",
  maxSalary: "Max salary",
  preferredLocations: "Locations",
  experienceYears: "Experience (years)",
  topSkills: "Skills",
  workStylePreferences: "Work style",
  companySizePreference: "Company size",
  linkedinUrl: "LinkedIn",
  githubUrl: "GitHub",
  industryPreferences: "Industries",
  careerGoalsShortTerm: "Short-term goal",
  careerGoalsLongTerm: "Long-term goal",
  visaSponsorshipRequired: "Needs visa sponsorship",
  jobDescription: "Job description",
  name: "Name",
  // Recruiter job posts.
  title: "Title",
  description: "Description",
  locations: "Locations",
  jobType: "Job type",
  minExperience: "Min experience (years)",
  maxExperience: "Max experience (years)",
  visaSponsorship: "Visa sponsorship",
  skills: "Skills",
  questions: "Screening questions",
  applicationForm: "Application form",
  status: "Status",
};

const formatValue = (value: unknown) =>
  Array.isArray(value)
    ? value.join(", ")
    : typeof value === "boolean"
      ? value
        ? "Yes"
        : "No"
      : String(value);

/** Label and value pairs for an approval card. Ids mean nothing to the user, so they're left out. */
const describeInput = (input: unknown) =>
  Object.entries((input ?? {}) as Record<string, unknown>)
    .filter(([key]) => !/Ids?$/.test(key))
    .map(
      ([key, value]) =>
        [FIELD_LABELS[key] ?? key, key === "applicationForm" ? describeApplicationForm(value) : formatValue(value)] as const,
    );

/** Indigo: the agent is waiting on the user. */
function ActionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brandSoft p-4">
      {children}
    </div>
  );
}

type ResumeSummary = { id: string; name: string | null; is_primary: boolean | null };
type ResumeLookup =
  | { state: "loading" }
  | { state: "found"; resume: ResumeSummary }
  | { state: "none" }
  | { state: "error" };

/**
 * The resume completeOnboarding will use, so the user can check it before
 * approving: the chosen one, or the primary one when none was chosen (the
 * tool's own default).
 */
function OnboardingResume({ resumeId }: { resumeId?: string }) {
  const [lookup, setLookup] = useState<ResumeLookup>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/resumes")
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load resumes");
        const { data } = (await response.json()) as { data?: ResumeSummary[] };
        const resumes = data ?? [];
        const resume = resumeId
          ? resumes.find((r) => r.id === resumeId)
          : resumes.find((r) => r.is_primary);
        if (cancelled) return;
        if (resume) setLookup({ state: "found", resume });
        else setLookup(resumeId ? { state: "error" } : { state: "none" });
      })
      .catch(() => {
        if (!cancelled) setLookup({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  switch (lookup.state) {
    case "loading":
      return <span className="text-muted-foreground">Loading…</span>;
    case "found":
      return (
        <Link {...NEW_TAB} href={`/resume/${lookup.resume.id}`} className={inlineLink}>
          {lookup.resume.name ?? "Your resume"}
        </Link>
      );
    case "none":
      return <span>None yet. The assistant will ask you to upload one.</span>;
    case "error":
      return <span className="text-muted-foreground">Couldn&apos;t load the resume.</span>;
  }
}

/** What the approval card asks: exactly what will happen (RA-REQ-005). */
function approvalTitle(name: string, input: unknown) {
  const values = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "startResumeReview":
      return "Start a resume review? This uses 5 AI credits once the analysis succeeds.";
    case "updateMyPreferences":
      return "Update your job preferences?";
    case "completeOnboarding":
      return "Set up your profile with these details?";
    case "createJobPost":
      return "Create this job post as a draft?";
    case "updateJobPost":
      return "Update this job post?";
    case "setJobPostStatus":
      return values.status === "active" ? "Publish this job post?" : "Unpublish this job post?";
    case "deleteJobPost":
      return "Delete this job post?";
    case "applyQuestionSet":
      return "Apply this question set to the job? It replaces the job's application form; answered questions stay, archived.";
    case "saveQuestionSet":
      return values.questionSetId ? "Overwrite this question set?" : "Save this question set?";
    case "deleteQuestionSet":
      return "Delete this question set? Jobs it was applied to keep their copy.";
    case "updateCareersPage":
      return "Update your public careers page?";
    case "setCareersAddress":
      return typeof values.slug === "string"
        ? `Change your careers page address to /careers/${values.slug}? The old address will redirect for 90 days.`
        : "Change your careers page address?";
    case "setCareersPublished":
      return values.published ? "Publish your careers page?" : "Unpublish your careers page?";
    case "runMatchingForJob":
      return "Start matching candidates to this job? It runs in the background, and you'll get an email when it's done.";
    case "screenApplicants":
      return "Screen this job's unscreened applicants? Each new screening uses one from your plan.";
    case "configureScreeningInterview":
      return "Set up this AI interview?";
    case "inviteToInterview":
      if (Array.isArray(values.applicationIds)) {
        const count = values.applicationIds.length;
        return `Invite ${count} ${count === 1 ? "applicant" : "applicants"} to the AI interview?`;
      }
      return `Allow the assistant to ${labelsFor(name).action}?`;
    case "moveApplications":
      if (Array.isArray(values.applicationIds)) {
        const count = values.applicationIds.length;
        const what = `${count} ${count === 1 ? "application" : "applications"}`;
        return values.email ? `Move ${what} and email the candidates?` : `Move ${what}?`;
      }
      return `Allow the assistant to ${labelsFor(name).action}?`;
    case "sendOutreach":
      return "Send this message on GetHired?";
    case "archiveStage":
      return "Archive this stage? It leaves your pipeline and can't be brought back.";
    case "deleteEmailTemplate":
      return "Delete this email template? This can't be undone.";
    case "deleteNote":
      return "Delete this note? This can't be undone.";
    case "deleteTalentList":
      return "Delete this talent list? Its candidates stay in the talent pool, but the list can't be brought back.";
    case "withdrawOutreach":
      return "Withdraw this message? The candidate won't be able to answer it, and this can't be undone.";
    case "createRole":
      return "Create this role?";
    case "updateRole":
      return "Change this role?";
    case "deleteRole":
      return "Delete this role?";
    case "assignRole":
      return "Change this team member's role?";
    case "setDefaultRole":
      return "Make this the default role for new invites?";
    case "removeTeamMember":
      return "Remove this person from your team? They lose access right away.";
    case "assignToJob":
      return "Add this team member to the job's hiring team?";
    case "unassignFromJob":
      return "Remove this team member from the job's hiring team?";
    case "inviteTeamMember":
      return "Invite this person to your team? They'll get an email with a link to join.";
    case "resendInvite":
      return "Resend this invite? The old link stops working.";
    case "revokeInvite":
      return "Revoke this invite? Its link stops working.";
    default:
      return `Allow the assistant to ${labelsFor(name).action}?`;
  }
}

function approvalDetails(name: string, input: unknown) {
  // Deletes, moves and outreach show a server preview (JobDeleteApprovalDetails, MoveApprovalDetails, OutreachApprovalDetails).
  if (["setJobPostStatus", "deleteJobPost", "moveApplications", "sendOutreach"].includes(name)) return [];
  // The interview setup and invites have their own details (InterviewApprovalCard).
  if (["configureScreeningInterview", "inviteToInterview"].includes(name)) return [];
  // Role changes show a server preview with the exact diff (RoleApprovalDetails).
  if (isRoleApprovalTool(name)) return [];
  return describeInput(input);
}

function ApprovalCard({
  name,
  part,
  onApprove,
}: {
  name: string;
  part: ToolPart & { approval: { id: string } };
  onApprove: ApprovalHandler;
}) {
  const title = approvalTitle(name, part.input);
  const details = approvalDetails(name, part.input);
  const isOnboarding = name === "completeOnboarding";
  const reason = (part.approval as { requestReason?: string }).requestReason;

  return (
    <ActionCard>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
      {name === "deleteJobPost" && <JobDeleteApprovalDetails input={part.input} />}
      {name === "moveApplications" && <MoveApprovalDetails input={part.input} />}
      {name === "sendOutreach" && <OutreachApprovalDetails input={part.input} />}
      {name === "configureScreeningInterview" && <InterviewConfigApprovalDetails input={part.input} />}
      {name === "inviteToInterview" && <InterviewInviteApprovalDetails input={part.input} />}
      {isRoleApprovalTool(name) && <RoleApprovalDetails tool={name} input={part.input} />}
      {(details.length > 0 || isOnboarding) && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {details.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="break-words text-foreground">{value}</dd>
            </div>
          ))}
          {isOnboarding && (
            <div className="contents">
              <dt className="text-muted-foreground">Resume</dt>
              <dd className="break-words text-foreground">
                <OnboardingResume
                  resumeId={(part.input as { resumeId?: string } | undefined)?.resumeId}
                />
              </dd>
            </div>
          )}
        </dl>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="brand"
          onClick={() => onApprove({ id: part.approval.id, approved: true })}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="bg-background"
          onClick={() => onApprove({ id: part.approval.id, approved: false })}
        >
          Deny
        </Button>
      </div>
    </ActionCard>
  );
}

/**
 * Markdown links get the same treatment as the app's own links. Replies only
 * link into the app, so a link planted in a job posting can't be clicked,
 * and images aren't loaded, so a reply can't send data to another site
 * (SEC-014).
 */
const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, title, className, children }) =>
    isInAppHref(href) ? (
      <a href={href} title={title} className={className} {...NEW_TAB}>
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
};

/** Plugins for a reply that is still streaming: new words fade in. */
const STREAMING_REHYPE_PLUGINS = [rehypeAnimateWords];


/** A finished tool call: its label, plus any results worth showing. */
function OutputStep({ name, output }: { name: string; output: unknown }) {
  const result = (output ?? {}) as Record<string, unknown>;

  if (result.error === "INSUFFICIENT_CREDITS") {
    return (
      <Step
        tone="yours"
        label={
          <span className="flex flex-wrap items-center gap-x-2">
            <Coins aria-hidden className="h-3.5 w-3.5" />
            <span>{String(result.message ?? "Not enough AI credits.")}</span>
            <Link
              {...NEW_TAB}
              href={String(result.rechargeUrl ?? "/dashboard/buy-credits")}
              className={inlineLink}
            >
              Buy credits
            </Link>
          </span>
        }
      />
    );
  }

  if (result.error === "PLAN_LIMIT") {
    return (
      <Step
        tone="yours"
        label={
          <span className="flex flex-wrap items-center gap-x-2">
            <span>{String(result.message ?? "Your plan's limit is reached.")}</span>
            {isInAppHref(String(result.upgradeUrl)) && (
              <Link {...NEW_TAB} href={String(result.upgradeUrl)} className={inlineLink}>
                See plans
              </Link>
            )}
          </span>
        }
      />
    );
  }

  if (typeof result.error === "string") {
    return (
      <Step
        tone="failed"
        label={typeof result.message === "string" ? result.message : result.error}
      />
    );
  }

  // Before the generic lists: the company funnel also has `jobs`.
  if (name === "getHiringFunnel" && Array.isArray(result.stages)) {
    return (
      <Step tone="done" label={labelsFor(name).done}>
        <FunnelResult funnel={result as unknown as FunnelResultData} />
      </Step>
    );
  }

  if (Array.isArray(result.jobs)) {
    return (
      <Step tone="done" label={labelsFor(name).done}>
        <JobResults
          jobs={result.jobs as CompactJob[]}
          totalCount={typeof result.totalCount === "number" ? result.totalCount : undefined}
        />
      </Step>
    );
  }

  if (Array.isArray(result.candidates)) {
    // A comparison can include candidates it couldn't load; they have no URL.
    const rows = (result.candidates as Partial<CandidateRowData>[]).filter(
      (c): c is CandidateRowData => typeof c.url === "string",
    );
    return (
      <Step tone="done" label={labelsFor(name).done}>
        <CandidateResults candidates={rows} />
      </Step>
    );
  }

  if (Array.isArray(result.applicants)) {
    return (
      <Step tone="done" label={labelsFor(name).done}>
        <ApplicantResults applicants={result.applicants as ApplicantRowData[]} />
      </Step>
    );
  }

  if (
    ["createJobPost", "updateJobPost", "setJobPostStatus"].includes(name) &&
    typeof result.url === "string" &&
    isInAppHref(result.url)
  ) {
    const what =
      name === "createJobPost"
        ? `Saved “${String(result.title ?? "the job post")}” as a draft.`
        : name === "setJobPostStatus"
          ? result.status === "active"
            ? "Published the job post."
            : "Unpublished the job post."
          : "Updated the job post.";
    return (
      <Step
        tone="done"
        label={
          <>
            {what}{" "}
            <Link {...NEW_TAB} href={result.url} className={inlineLink}>
              Open the job post
            </Link>
          </>
        }
      />
    );
  }

  if (name === "deleteJobPost" && result.deleted === true) {
    return <Step tone="done" label={`Deleted “${String(result.title ?? "the job post")}”.`} />;
  }

  if (name === "moveApplications" && typeof result.moved === "number") {
    const stage = (result.stage as { name?: string } | undefined)?.name ?? "the stage";
    const moved = result.moved;
    const emailed = typeof result.emailed === "number" ? result.emailed : 0;
    const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0;
    const parts = [
      moved === 0
        ? `No applications moved to ${stage}`
        : `Moved ${moved} ${moved === 1 ? "application" : "applications"} to ${stage}`,
      emailed > 0 && `emailing ${emailed}`,
      skipped > 0 && `${skipped} skipped`,
    ].filter(Boolean);
    return <Step tone="done" label={parts.join(", ")} />;
  }

  if (name === "sendOutreach" && result.sent === true) {
    const href = typeof result.outreachUrl === "string" && isInAppHref(result.outreachUrl) ? result.outreachUrl : null;
    return (
      <Step
        tone="done"
        label={
          <>
            {result.emailed ? "Message sent and emailed." : "Message sent. They'll see it on GetHired."}{" "}
            {href && (
              <Link {...NEW_TAB} href={href} className={inlineLink}>
                Open message
              </Link>
            )}
          </>
        }
      />
    );
  }

  if (name === "addToTalentList" && typeof result.url === "string" && isInAppHref(result.url)) {
    const list = (result.list as { name?: string } | undefined)?.name ?? "the list";
    return (
      <Step
        tone="done"
        label={
          <>
            {result.added ? `Added to “${list}”.` : `Already in “${list}”.`}{" "}
            <Link {...NEW_TAB} href={result.url} className={inlineLink}>
              Open the list
            </Link>
          </>
        }
      />
    );
  }

  if (name === "findMatchesForJob" && typeof result.status === "string") {
    const label =
      result.status === "processing"
        ? "Matching is still running for this job"
        : result.status === "failed"
          ? "Matching failed for this job"
          : "Matching hasn't run for this job yet";
    return <Step tone="declined" label={label} />;
  }

  if (name === "runMatchingForJob" && result.status === "processing") {
    return <Step tone="done" label="Matching started. You'll get an email when it's done." />;
  }

  if (name === "screenApplicants" && typeof result.queued === "number") {
    const count = result.queued;
    return (
      <Step
        tone="done"
        label={
          count === 0
            ? "Every application is already screened or in the queue"
            : `Queued ${count} ${count === 1 ? "screening" : "screenings"}`
        }
      />
    );
  }

  if (name === "startResumeReview" && typeof result.url === "string") {
    return (
      <Step
        tone="done"
        label={
          <>
            Review started.{" "}
            <Link {...NEW_TAB} href={result.url} className={inlineLink}>
              Open the review
            </Link>
          </>
        }
      />
    );
  }

  if (name === "createInterview" && typeof result.url === "string") {
    return (
      <Step
        tone="done"
        label={
          <>
            Interview ready.{" "}
            <Link {...NEW_TAB} href={result.url} className={inlineLink}>
              Start the interview
            </Link>
          </>
        }
      />
    );
  }

  if (
    name === "getInterviewAnalysis" &&
    result.status === "completed" &&
    typeof result.url === "string"
  ) {
    return (
      <Step
        tone="done"
        label={
          <>
            {labelsFor(name).done}.{" "}
            <Link {...NEW_TAB} href={result.url} className={inlineLink}>
              Open the full analysis
            </Link>
          </>
        }
      />
    );
  }

  if (name === "completeOnboarding" && result.resume) {
    const resume = result.resume as { id: string; name: string | null };
    return (
      <Step
        tone="done"
        label={
          <>
            Profile set up with{" "}
            <Link {...NEW_TAB} href={`/resume/${resume.id}`} className={inlineLink}>
              {resume.name ?? "your resume"}
            </Link>
            .
          </>
        }
      />
    );
  }

  if (name === "requestResumeUpload") {
    if (typeof result.resumeId === "string") {
      return (
        <Step
          tone="done"
          label={
            <>
              Resume uploaded.{" "}
              <Link {...NEW_TAB} href={`/resume/${result.resumeId}`} className={inlineLink}>
                Open the resume
              </Link>
            </>
          }
        />
      );
    }
    if (result.cancelled) {
      return <Step tone="declined" label="Resume upload cancelled" />;
    }
  }

  return <Step tone="done" label={labelsFor(name).done} />;
}

function ToolStep({
  part,
  onApprove,
  onToolOutput,
}: {
  part: ToolPart;
  onApprove: ApprovalHandler;
  onToolOutput: ToolOutputHandler;
}) {
  const name = getToolName(part as Parameters<typeof getToolName>[0]);
  const labels = labelsFor(name);

  switch (part.state) {
    case "approval-requested":
      return (
        <Step tone="yours" label="Needs your approval">
          <ApprovalCard
            name={name}
            part={part as ToolPart & { approval: { id: string } }}
            onApprove={onApprove}
          />
        </Step>
      );
    case "input-streaming":
    case "input-available":
      if (name === "requestResumeUpload" && part.state === "input-available") {
        const reason = (part.input as { reason?: string } | undefined)?.reason;
        return (
          <Step tone="yours" label={labels.running}>
            <ResumeUploadWidget
              reason={reason}
              onComplete={(output) => onToolOutput(part.toolCallId, output)}
            />
          </Step>
        );
      }
      return <Step tone="running" label={labels.running} />;
    case "approval-responded":
      return <Step tone="running" label={labels.running} />;
    case "output-available":
      return <OutputStep name={name} output={part.output} />;
    case "output-error":
      return <Step tone="failed" label={`Couldn't ${labels.action}.`} />;
    case "output-denied": {
      // Denied by the app's rules rather than by the user (SEC-013).
      const approval = (part as { approval?: { isAutomatic?: boolean; reason?: string } }).approval;
      if (approval?.isAutomatic) {
        return (
          <Step tone="declined" label={`Skipped: ${labels.action}`}>
            {approval.reason && (
              <p className="text-xs text-muted-foreground">{approval.reason}</p>
            )}
          </Step>
        );
      }
      return <Step tone="declined" label={`Declined: ${labels.action}`} />;
    }
    default:
      return null;
  }
}

const TRAIL_CLASS = "flex flex-col gap-3";

type Block =
  | { kind: "text"; key: string; text: string }
  | { kind: "tools"; key: string; parts: ToolPart[] };

/** Groups consecutive tool calls into one trail; text stays between them. */
function toBlocks(parts: MessagePart[]): Block[] {
  const blocks: Block[] = [];
  parts.forEach((part, index) => {
    if (part.type === "text") {
      if (part.text) blocks.push({ kind: "text", key: `text-${index}`, text: part.text });
      return;
    }
    if (!isToolUIPart(part)) return;
    const last = blocks.at(-1);
    if (last?.kind === "tools") last.parts.push(part as ToolPart);
    else blocks.push({ kind: "tools", key: (part as ToolPart).toolCallId, parts: [part as ToolPart] });
  });
  return blocks;
}

/**
 * True once a message has something to show. A reply starts with only
 * step markers, and rendering it then would push the loader down a gap.
 */
export const hasVisibleParts = (message: UIMessage) => toBlocks(message.parts).length > 0;

/**
 * Renders one chat message's parts: text, tool steps, approvals, uploads.
 * `streaming` fades in each new word of a reply as it arrives.
 */
function MessageParts({
  message,
  onApprove,
  onToolOutput,
  streaming = false,
}: {
  message: UIMessage;
  onApprove: ApprovalHandler;
  onToolOutput: ToolOutputHandler;
  streaming?: boolean;
}) {
  if (message.role === "user") {
    return (
      <>
        {message.parts.map((part, index) =>
          part.type === "text" ? (
            <p key={index} className="whitespace-pre-wrap break-words">
              {part.text}
            </p>
          ) : null,
        )}
      </>
    );
  }

  return (
    <>
      {toBlocks(message.parts).map((block) =>
        block.kind === "text" ? (
          <div
            key={block.key}
            className="prose prose-neutral min-w-0 max-w-none text-[15px] leading-7 [overflow-wrap:anywhere] dark:prose-invert prose-p:my-2 prose-a:font-medium prose-a:underline-offset-4 hover:prose-a:text-brand prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-strong:font-semibold prose-pre:max-w-full prose-pre:overflow-x-auto"
          >
            <ReactMarkdown
              components={MARKDOWN_COMPONENTS}
              rehypePlugins={streaming ? STREAMING_REHYPE_PLUGINS : undefined}
            >
              {block.text}
            </ReactMarkdown>
          </div>
        ) : (
          <ol key={block.key} className={TRAIL_CLASS}>
            {block.parts.map((part) => (
              <ToolStep
                key={part.toolCallId}
                part={part}
                onApprove={onApprove}
                onToolOutput={onToolOutput}
              />
            ))}
          </ol>
        ),
      )}
    </>
  );
}

/**
 * Memoised: during streaming only the message being written changes, so
 * earlier messages (and their markdown) aren't re-rendered.
 */
export default memo(MessageParts);
