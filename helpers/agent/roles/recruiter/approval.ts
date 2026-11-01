import { createToolApproval, type ToolApprovalPolicy } from "../../approval";
import { RA_MAX_EMAIL_ACTIONS_PER_TURN } from "./config";

/**
 * The recruiter agent's approval policy (RA spec §4.4). Every action that
 * changes a job post, starts matching or screening, moves applications
 * (which can email candidates) or messages a candidate asks first (RA-REQ-005). Memory and note
 * writes ask after the turn read candidate text (RA-SEC-003). Email actions
 * and credit-spending calls are capped per turn (RA-SEC-006, RA-SEC-007).
 * Exported as data for the MCP catalog's confirm and credit flags (RMCP spec §4.4).
 */
export const RECRUITER_APPROVAL_POLICY: ToolApprovalPolicy = {
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
    // CP-REQ-063: adds the company's own candidates to a job; the card names the job and who.
    "addCandidatesToJob",
    // BI-REQ-060: approving an import or a hand-added person records the
    // lawful-basis attestation (BI-REQ-016); the card names who goes where.
    "confirmImport",
    "addCandidate",
    // Deleting takes the candidates' applications and files with it.
    "deleteMyCandidates",
    // A removed resume's file is deleted.
    "removeImportRows",
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
    // Company candidates' names, titles and skills come from their resumes (CP-SEC-003).
    "findPoolCandidates",
    // Imported rows and the company's own candidates are their resumes' and sheets' words.
    "getImport",
    "listImports",
    "listMyCandidates",
    "getMyCandidate",
  ],
  // An import row or candidate edit after reading their text could be the text's idea (RA-SEC-003).
  gatedWriteTools: ["saveMemory", "deleteMemory", "addNote", "updateNote", "updateImportRows", "updateMyCandidate"],
  untrustedReason:
    "The assistant read candidate profiles, applications or imports in this reply, so memory, note and candidate changes need your OK.",
  creditTools: ["screenApplicants", "runMatchingForJob", "explainMatch", "inviteToInterview", "retryImportRows"],
  perTurnCaps: [
    {
      tools: ["moveApplications", "sendOutreach"],
      max: RA_MAX_EMAIL_ACTIONS_PER_TURN,
      reason: `Only ${RA_MAX_EMAIL_ACTIONS_PER_TURN} actions that move applications or email candidates can run per message. Ask the user before trying again.`,
    },
  ],
};

/** The recruiter agent's tool approval policy, passed to `streamText` as `toolApproval`. */
export const recruiterToolApproval = createToolApproval(RECRUITER_APPROVAL_POLICY);
