"use client";

/**
 * The cards and upload widgets a chat shows only for some tool calls. Each
 * one's code loads when a chat first shows it, so opening the agent doesn't
 * download them all. MessageParts must not import their files directly, except
 * for types.
 */
import dynamic from "next/dynamic";

const CardLoading = () => <p className="text-xs text-muted-foreground">Loading…</p>;

// Next reads each call's options at build time, so they must be written inline
// as an object literal, not shared through a variable.
export const ResumeUploadWidget = dynamic(() => import("./ResumeUploadWidget"), { loading: CardLoading });
export const AskUserCard = dynamic(() => import("./AskUserCard"), { loading: CardLoading });
export const AskUserResult = dynamic(() => import("./AskUserCard").then((m) => m.AskUserResult), { loading: CardLoading });
export const ResumeChangesCard = dynamic(() => import("./ResumeChangesCard"), { loading: CardLoading });
export const ResumeChangesResult = dynamic(
  () => import("./ResumeChangesCard").then((m) => m.ResumeChangesResult),
  { loading: CardLoading },
);
export const ResumeEditApprovalDetails = dynamic(
  () => import("./ResumeEditApprovalCard").then((m) => m.ResumeEditApprovalDetails),
  { loading: CardLoading },
);
export const ApplicationApprovalDetails = dynamic(
  () => import("./ApplicationApprovalCard").then((m) => m.ApplicationApprovalDetails),
  { loading: CardLoading },
);
export const JobAlertApprovalDetails = dynamic(
  () => import("./JobAlertApprovalCard").then((m) => m.JobAlertApprovalDetails),
  { loading: CardLoading },
);
export const SalaryApprovalWarning = dynamic(() =>
  import("./SalaryApprovalWarning").then((m) => m.SalaryApprovalWarning),
);

// Recruiter cards and widgets.
export const ResumeImportWidget = dynamic(() => import("./recruiter/ResumeImportWidget"), { loading: CardLoading });
export const SpreadsheetImportWidget = dynamic(() => import("./recruiter/SpreadsheetImportWidget"), { loading: CardLoading });
export const CandidateResumeWidget = dynamic(() => import("./recruiter/CandidateResumeWidget"), { loading: CardLoading });
export const JobDeleteApprovalDetails = dynamic(
  () => import("./recruiter/JobDeleteApprovalCard").then((m) => m.JobDeleteApprovalDetails),
  { loading: CardLoading },
);
export const MoveApprovalDetails = dynamic(
  () => import("./recruiter/MoveApprovalCard").then((m) => m.MoveApprovalDetails),
  { loading: CardLoading },
);
export const OutreachApprovalDetails = dynamic(
  () => import("./recruiter/OutreachApprovalCard").then((m) => m.OutreachApprovalDetails),
  { loading: CardLoading },
);
export const InterviewConfigApprovalDetails = dynamic(
  () => import("./recruiter/InterviewApprovalCard").then((m) => m.InterviewConfigApprovalDetails),
  { loading: CardLoading },
);
export const InterviewInviteApprovalDetails = dynamic(
  () => import("./recruiter/InterviewApprovalCard").then((m) => m.InterviewInviteApprovalDetails),
  { loading: CardLoading },
);
export const SchedulingApprovalDetails = dynamic(
  () => import("./recruiter/SchedulingApprovalCard").then((m) => m.SchedulingApprovalDetails),
  { loading: CardLoading },
);
export const AddToJobApprovalDetails = dynamic(
  () => import("./recruiter/AddToJobApprovalDetails").then((m) => m.AddToJobApprovalDetails),
  { loading: CardLoading },
);
export const ApplicationFormApprovalDetails = dynamic(
  () => import("./recruiter/ApplicationFormApprovalDetails").then((m) => m.ApplicationFormApprovalDetails),
  { loading: CardLoading },
);
export const ImportApprovalDetails = dynamic(
  () => import("./recruiter/ImportApprovalDetails").then((m) => m.ImportApprovalDetails),
  { loading: CardLoading },
);
export const AddCandidateApprovalDetails = dynamic(
  () => import("./recruiter/ImportApprovalDetails").then((m) => m.AddCandidateApprovalDetails),
  { loading: CardLoading },
);
export const DeleteCandidatesApprovalDetails = dynamic(
  () => import("./recruiter/ImportApprovalDetails").then((m) => m.DeleteCandidatesApprovalDetails),
  { loading: CardLoading },
);
export const RoleApprovalDetails = dynamic(
  () => import("./recruiter/RoleApprovalCard").then((m) => m.RoleApprovalDetails),
  { loading: CardLoading },
);
export const PipelineApprovalDetails = dynamic(
  () => import("./recruiter/PipelineApprovalDetails").then((m) => m.PipelineApprovalDetails),
  { loading: CardLoading },
);
