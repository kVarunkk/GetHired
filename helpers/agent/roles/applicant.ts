import { agentToolApproval } from "../approval";
import { AGENT_CONTENT_FILTER_MESSAGE, AGENT_DAILY_MESSAGE_CAP } from "../config";
import { loadPromptProfile } from "../persistence";
import { buildSystemPrompt } from "../system-prompt";
import { createAgentTools } from "../tools";
import type { AgentRole } from "./types";

/** The job seeker's agent, unchanged by the role layer (RA-CON-002). */
export const applicantRole: AgentRole = {
  id: "applicant",
  dailyCap: AGENT_DAILY_MESSAGE_CAP,
  telemetryPrefix: "agent",
  contentFilterMessage: AGENT_CONTENT_FILTER_MESSAGE,
  async loadPrompt({ supabase, user }) {
    const profile = await loadPromptProfile(supabase, user.id);
    return ({ memories, now, summary }) => buildSystemPrompt({ profile, memories, now, summary });
  },
  createTools: ({ supabase, user, sessionId }) => createAgentTools({ supabase, user, sessionId }),
  toolApproval: agentToolApproval,
};
