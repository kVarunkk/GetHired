import { createToolApproval } from "../../approval";
import { RA_MAX_EMAIL_ACTIONS_PER_TURN } from "./config";

/**
 * The recruiter agent's approval policy (RA spec §4.4). Every action that
 * changes a job post, starts matching or screening, moves applications
 * (which can email candidates) or messages a candidate asks first (RA-REQ-005). Memory and note
 * writes ask after the turn read candidate text (RA-SEC-003). Email actions
 * and credit-spending calls are capped per turn (RA-SEC-006, RA-SEC-007).
 */
export const recruiterToolApproval = createToolApproval({
  alwaysAsk: [
    "createJobPost",
    "updateJobPost",
    "setJobPostStatus",
    // Deleting takes the job's applications with it.
    "deleteJobPost",
    "applyQuestionSet",
    "saveQuestionSet",
    "deleteQuestionSet",
    "runMatchingForJob",
    "screenApplicants",
    "moveApplications",
    "sendOutreach",
    // The candidate can no longer answer, and it can't be undone.
    "withdrawOutreach",
    // Archived stages leave the board and the app has no way to bring them back.
    "archiveStage",
    // A template can't be brought back.
    "deleteEmailTemplate",
    // A note can't be brought back.
    "deleteNote",
    // A list can't be brought back (its candidates stay in the pool).
    "deleteTalentList",
    // RP-REQ-032: every role and hiring-team change asks; the card shows the diff.
    "createRole",
    "updateRole",
    "deleteRole",
    "assignRole",
    "setDefaultRole",
    "assignToJob",
    "unassignFromJob",
    // Invites email someone outside the company; revoking breaks a link they may be using.
    "inviteTeamMember",
    "resendInvite",
    "revokeInvite",
    // The member loses access at once, and only a new invite brings them back.
    "removeTeamMember",
    // The careers page is public.
    "updateCareersPage",
    "setCareersAddress",
    "setCareersPublished",
    // SIT-071: the card shows the exact setup; invites email applicants and hold minutes.
    "configureScreeningInterview",
    "inviteToInterview",
  ],
  untrustedContentTools: [
    "getCandidateProfile",
    "compareCandidates",
    "getApplication",
    "findMatchesForJob",
    "listApplicants",
    "explainMatch",
    "searchCandidates",
    "getJobPost",
    "listNotes",
    "getHiringFunnel",
    // Candidate names and answer notes are candidate-written.
    "listOutreach",
    "getOutreach",
    // Interview quotes and applicant names are candidate words.
    "getInterviewReport",
    "compareInterviewReports",
  ],
  gatedWriteTools: ["saveMemory", "deleteMemory", "addNote", "updateNote"],
  untrustedReason:
    "The assistant read candidate profiles or applications in this reply, so memory and note changes need your OK.",
  creditTools: ["screenApplicants", "runMatchingForJob", "explainMatch", "inviteToInterview"],
  perTurnCaps: [
    {
      tools: ["moveApplications", "sendOutreach"],
      max: RA_MAX_EMAIL_ACTIONS_PER_TURN,
      reason: `Only ${RA_MAX_EMAIL_ACTIONS_PER_TURN} actions that move applications or email candidates can run per message. Ask the user before trying again.`,
    },
  ],
});
