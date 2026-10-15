import { tool } from "ai";
import { createMemoryTools } from "@/helpers/agent/tools/memory";
import { fairnessError, type RecruiterToolContext } from "./shared";

/**
 * The applicant agent's memory tools, described for hiring, with the fairness
 * screen in front of saves (RA-REQ-007, RA-SEC-004). Same table, cap and
 * short ids.
 */
export function createRecruiterMemoryTools(ctx: RecruiterToolContext) {
  const { saveMemory, deleteMemory } = createMemoryTools(ctx);

  return {
    saveMemory: tool({
      inputSchema: saveMemory.inputSchema,
      description:
        "Remember durable hiring context for this recruiter: the hiring bar, interview process, compensation bands, team context, or a decision and its reason. Never a candidate's personal data. Pass memoryId to update an existing memory instead of adding a duplicate.",
      execute: async (input, options) => {
        const unfair = fairnessError([input.content], "memory");
        if (unfair) return unfair;
        return saveMemory.execute!(input, options);
      },
    }),
    deleteMemory,
  };
}
