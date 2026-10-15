import { consumeEntitlement } from "@/helpers/billing/entitlements";
import type { AgentRole } from "../types";
import { recruiterToolApproval } from "./approval";
import { RA_CONTENT_FILTER_MESSAGE, RA_DAILY_MESSAGE_CAP } from "./config";
import { loadRecruiterPromptContext } from "./context";
import { buildRecruiterSystemPrompt } from "./system-prompt";
import { createRecruiterTools } from "./tools";

const NO_COMPANY = "The recruiter agent needs the session's company.";

/** The company user's hiring assistant (RA spec). */
export const recruiterRole: AgentRole = {
  id: "company",
  dailyCap: RA_DAILY_MESSAGE_CAP,
  telemetryPrefix: "recruiter-agent",
  contentFilterMessage: RA_CONTENT_FILTER_MESSAGE,
  async loadPrompt({ supabase, company }) {
    if (!company) throw new Error(NO_COMPANY);
    const context = await loadRecruiterPromptContext(supabase, company);
    return (input) => buildRecruiterSystemPrompt({ context, ...input });
  },
  createTools(ctx) {
    if (!ctx.company) throw new Error(NO_COMPANY);
    return createRecruiterTools({ ...ctx, company: ctx.company });
  },
  toolApproval: recruiterToolApproval,
  // One agent_messages unit per user message, charged before the model runs
  // (BL-TASK-035). The ref is the message id, so a regenerate is free.
  async chargeMessage({ company, userId, messageId }) {
    await consumeEntitlement(company.id, "agent_messages", 1, { type: "agent_message", id: messageId }, userId);
  },
};
