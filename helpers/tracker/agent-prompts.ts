import { trackedApplicationPath } from "./paths";

// The prompts a tracked card's page sends to the agent (AT-REQ-023). Each names
// the job with a link the agent can act on. A GetHired job carries /jobs/<id>,
// which its job tools take as jobId. A job the user added by hand carries its
// My Jobs link: the agent reads it with getTrackedApplication and passes the
// description to improveResume as jobDescription. The text stays out of the URL.

type PromptJob = { id: string; allJobsId: string | null; jobTitle: string; companyName: string };

const jobRef = (job: PromptJob) =>
  `the ${job.jobTitle} role at ${job.companyName} (${job.allJobsId ? `/jobs/${job.allJobsId}` : trackedApplicationPath(job.id)})`;

export const tailorResumePrompt = (job: PromptJob) => `Tailor my resume for ${jobRef(job)}.`;

/** Practice interview needs a GetHired job (createInterview reads all_jobs); see the pending item in the spec's §9. */
export const canPracticeInterview = (job: Pick<PromptJob, "allJobsId">) => job.allJobsId !== null;

export const practiceInterviewPrompt = (job: PromptJob) => `Set up a mock interview for ${jobRef(job)}.`;

/** The dashboard's "Draft a follow-up" for an application that's due one or has had no reply. */
export const followUpPrompt = (job: PromptJob & { appliedAt: string }) =>
  `Draft a short, polite follow-up message about my application for ${jobRef(job)}. I applied on ${job.appliedAt.slice(0, 10)}.`;

/** The dashboard's prep prompt for an upcoming interview with a company. */
export const interviewPrepPrompt = (interview: { interviewName: string; jobTitle: string; companyName: string }) =>
  `Help me prepare for my upcoming "${interview.interviewName}" interview for the ${interview.jobTitle} role at ${interview.companyName}.`;
