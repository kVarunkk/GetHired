import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { ToolSet } from "ai";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import type { ToolApprovalFn } from "../approval";
import type { AgentPromptMemory } from "../system-prompt";

export type AgentRoleId = "applicant" | "company";

/** Server-side context a role's tools close over (SEC-002, RA-SEC-002). */
export type AgentRoleToolContext = {
  supabase: SupabaseClient<Database>;
  user: User;
  sessionId: string;
  /** The company a company user acts for; null for applicants. */
  company: MyCompany | null;
};

export type PromptInput = {
  memories: AgentPromptMemory[];
  now: Date;
  summary: string | null;
  /** The tools enabled this turn, for prompts that list their capabilities. */
  toolNames: string[];
};

/**
 * What a role brings to the shared agent core (RA spec §4.1): its prompt,
 * tools, approval policy, limits and copy. The route, page and tables are
 * shared.
 */
export type AgentRole = {
  id: AgentRoleId;
  /** User messages per user per UTC day. */
  dailyCap: number;
  /** Prefix for trace function ids, e.g. `agent-chat`. */
  telemetryPrefix: "agent" | "recruiter-agent";
  contentFilterMessage: string;
  /** Loads what the prompt needs for this turn and returns its builder. */
  loadPrompt(args: {
    supabase: SupabaseClient<Database>;
    user: User;
    company: MyCompany | null;
  }): Promise<(input: PromptInput) => string>;
  createTools(ctx: AgentRoleToolContext): ToolSet;
  toolApproval: ToolApprovalFn;
  /**
   * Charges one user message before the model runs; throws EntitlementError
   * when the plan's allowance is used up. Roles without it don't charge.
   */
  chargeMessage?(args: { company: MyCompany; userId: string; messageId: string }): Promise<void>;
};
