import { createToolApproval } from "../../approval";
import { RA_MAX_EMAIL_ACTIONS_PER_TURN } from "./config";

/**
 * The recruiter agent's approval policy (RA spec §4.4). Every action that
 * changes a job post, starts matching or screening, or moves applications
 * (which can email candidates) asks first (RA-REQ-005). Memory and note
 * writes ask after the turn read candidate text (RA-SEC-003). Email actions
 * and credit-spending calls are capped per turn (RA-SEC-006, RA-SEC-007).
 */
export const recruiterToolApproval = createToolApproval({
  alwaysAsk: [
    "createJobPost",
    "updateJobPost",
    "setJobPostStatus",
    "runMatchingForJob",
    "screenApplicants",
    "moveApplications",
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
  ],
  gatedWriteTools: ["saveMemory", "deleteMemory", "addNote"],
  untrustedReason:
    "The assistant read candidate profiles or applications in this reply, so memory and note changes need your OK.",
  creditTools: ["screenApplicants", "runMatchingForJob", "explainMatch"],
  perTurnCaps: [
    {
      tools: ["moveApplications"],
      max: RA_MAX_EMAIL_ACTIONS_PER_TURN,
      reason: `Only ${RA_MAX_EMAIL_ACTIONS_PER_TURN} actions that move applications or email candidates can run per message. Ask the user before trying again.`,
    },
  ],
});
