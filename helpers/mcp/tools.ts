/**
 * The MCP tool catalog (MCP spec §4.4): one row per tool, each running through
 * the applicant agent's tools or the helpers behind them, so MCP and the agent
 * share one implementation and one set of guardrails (MCP-REQ-005).
 *
 * A new applicant agent tool gets a row here or an entry in
 * MCP_EXCLUDED_AGENT_TOOLS; tools.test.ts checks it.
 */
import { z } from "zod";
import type { Tool } from "ai";
import type { AgentTools } from "@/helpers/agent/tools";
import type { ToolApprovalPolicy } from "@/helpers/agent/approval";
import { listJobsInTab } from "@/helpers/agent/tools/jobs";
import {
  limitInput,
  uuidInput,
  withToolErrors,
  type AgentToolContext,
} from "@/helpers/agent/tools/shared";
import { getResumeDetails } from "@/helpers/resumes/get-resume-details";
import { TAICredits } from "@/utils/types";
import {
  RESUME_REVIEWS_DEFAULT_LIMIT,
  RESUME_REVIEWS_MAX_LIMIT,
  listResumeReviews,
} from "@/helpers/resume-review/list-resume-reviews";
import {
  previewApplySuggestions,
  previewCompleteOnboarding,
  previewCreateResume,
  previewDeleteResume,
  previewSubmitApplication,
  previewUpdatePreferences,
  previewUpdateResume,
  type McpPreviewBuilder,
} from "./previews";
import type { McpToolset } from "./toolsets";

export type AgentToolName = keyof AgentTools;

/**
 * MCP tool annotations (MCP-REQ-008). Read-only tools leave out the
 * destructive and idempotent hints, which only mean something for writes.
 */
export type McpToolAnnotations =
  | { readOnlyHint: true; openWorldHint: boolean; destructiveHint?: never; idempotentHint?: never }
  | { readOnlyHint: false; openWorldHint: boolean; destructiveHint: boolean; idempotentHint: boolean };

/** A role's agent tools. The recruiter's are partial, since the role filters them. */
type ToolsLike = { [name: string]: Tool | undefined };

type CustomTool<TCtx, TTools> = {
  inputSchema: z.ZodTypeAny;
  // The input has been validated against inputSchema by the SDK.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (input: any, ctx: TCtx, tools: TTools) => Promise<unknown>;
};

/**
 * A catalog row. The defaults are the applicant catalog's; the recruiter
 * catalog (recruiter-tools.ts) uses the same shape over the recruiter tools.
 */
export type McpToolDef<
  TName extends string = AgentToolName,
  TCtx extends AgentToolContext = AgentToolContext,
  TTools extends ToolsLike = AgentTools,
> = {
  name: string;
  title: string;
  /** The toolset a company caller can narrow the list to (RMCP spec §4.5). Applicant rows have none. */
  toolset?: McpToolset;
  annotations: McpToolAnnotations;
  /**
   * The agent tools this one runs through. The approval policy's credit and
   * confirm flags for them apply here too. Empty for tools backed directly by
   * a shared helper.
   */
  agentTools: readonly TName[];
  /** Replaces the agent tool's description, e.g. where it names other agent tools. */
  description?: string;
  /** Input and body, for a tool that isn't one agent tool taken as is. */
  custom?: CustomTool<TCtx, TTools>;
  /** What the user confirms before a confirm tool runs (§4.6). Required for those, and only those. */
  preview?: McpPreviewBuilder<TCtx>;
  /** Emails someone, so it counts toward the per-hour email limit (RMCP spec §4.7). */
  email?: boolean;
};

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const SAFE_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Makes something new each time it's called. */
const ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
/** Changes or removes what's there. */
const CHANGE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

export const MCP_TOOLS: readonly McpToolDef[] = [
  // --- Jobs ---
  { name: "search_jobs", title: "Search jobs", annotations: READ, agentTools: ["searchJobs"] },
  {
    name: "natural_language_job_search",
    title: "Search jobs from a description",
    annotations: { readOnlyHint: true, openWorldHint: true },
    agentTools: ["naturalLanguageJobSearch"],
    description:
      "Turn a plain-English job request into filters with AI, then search. Costs 5 AI credits per call; prefer search_jobs when you can build the filters yourself.",
  },
  { name: "get_relevant_jobs", title: "Jobs matched to me", annotations: READ, agentTools: ["findRelevantJobs"] },
  { name: "get_similar_jobs", title: "Similar jobs", annotations: READ, agentTools: ["findSimilarJobs"] },
  { name: "get_job_details", title: "Job details", annotations: READ, agentTools: ["getJobDetails"] },
  { name: "get_saved_jobs", title: "Saved jobs", annotations: READ, agentTools: ["listSavedJobs"] },
  {
    name: "get_applied_jobs",
    title: "Applied jobs",
    annotations: READ,
    agentTools: [],
    description:
      "List the jobs the user has applied to or is tracking, as the Applied tab on /jobs shows them. Use list_applications for each application's status.",
    custom: {
      inputSchema: z.object({ limit: limitInput }),
      run: ({ limit }: { limit?: number }, ctx) => listJobsInTab(ctx, "applied", limit),
    },
  },
  {
    name: "favorite_job",
    title: "Save or unsave a job",
    annotations: SAFE_WRITE,
    agentTools: ["saveJob", "unsaveJob"],
    description: "Save (bookmark) a job for the user, or remove it from their saved jobs with action: unsave.",
    custom: {
      inputSchema: z.object({
        jobId: uuidInput("job"),
        action: z
          .enum(["save", "unsave"])
          .default("save")
          .describe("save adds the job to the saved jobs; unsave removes it."),
      }),
      run: ({ jobId, action }: { jobId: string; action: "save" | "unsave" }, _ctx, tools) =>
        executeAgentTool(tools, action === "unsave" ? "unsaveJob" : "saveJob", { jobId }),
    },
  },

  // --- Applications ---
  { name: "list_applications", title: "My applications", annotations: READ, agentTools: ["listApplications"] },
  {
    name: "update_application_status",
    title: "Track an application",
    annotations: SAFE_WRITE,
    agentTools: ["updateApplicationStatus"],
  },
  {
    name: "get_application_form",
    title: "Read an application form",
    annotations: READ,
    agentTools: ["getApplicationForm"],
    description:
      "Read the application form of a job on GetHired (isPlatformJob), before applying with submit_application: each field's key, label, type, whether it's required and its options or limits, plus suggested answers from the user's profile and the resume that would be sent.",
  },
  {
    name: "submit_application",
    title: "Apply to a job",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    agentTools: ["submitApplication"],
    preview: previewSubmitApplication,
    description:
      "Apply to a job on GetHired for the user (Easy Apply) with their answers to its application form. Costs 1 AI credit. Read the form with get_application_form first. Only use answers the user gave or that come from their profile; ask them for anything else.",
  },

  // --- Profile ---
  { name: "get_my_profile", title: "My profile", annotations: READ, agentTools: ["getMyProfile"] },
  {
    name: "update_my_preferences",
    title: "Update job preferences",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    agentTools: ["updateMyPreferences"],
    preview: previewUpdatePreferences,
    description:
      "Update the user's job preferences on their profile (roles, locations, salary, job types, visa, skills, work style). Personalised matches are refreshed afterwards. Send only the fields that change.",
  },
  {
    name: "complete_onboarding",
    title: "Finish onboarding",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    agentTools: ["completeOnboarding"],
    preview: previewCompleteOnboarding,
    description:
      "Finish the user's GetHired onboarding with their profile and resume, the same as the /get-started form. Only for users whose profile (get_my_profile) shows onboarding isn't complete; gather the required fields first.",
  },

  // --- Resumes ---
  { name: "get_resumes", title: "My resumes", annotations: READ, agentTools: ["listResumes"] },
  {
    name: "get_resume_details",
    title: "Resume details",
    annotations: READ,
    agentTools: [],
    description:
      "Get one of the user's resumes: its contact details, every section, item and bullet with its id, and the revision that update_resume needs.",
    custom: {
      inputSchema: z.object({ resumeId: uuidInput("resume") }),
      run: async ({ resumeId }: { resumeId: string }, ctx) => {
        const resume = await getResumeDetails(ctx.supabase, ctx.user, resumeId, { forEditing: true });
        return resume ? { resume } : { error: "Resume not found." };
      },
    },
  },
  {
    name: "set_primary_resume",
    title: "Set primary resume",
    annotations: SAFE_WRITE,
    agentTools: ["setPrimaryResume"],
  },
  {
    name: "create_resume",
    title: "Create a resume",
    annotations: ADD,
    agentTools: ["createResume"],
    preview: previewCreateResume,
  },
  {
    name: "update_resume",
    title: "Edit a resume",
    annotations: CHANGE,
    agentTools: ["updateResume"],
    preview: previewUpdateResume,
    description:
      "Edit one of the user's resumes with a list of operations. Read it with get_resume_details first, and pass the revision and ids from there. An unknown id fails the whole call. Free.",
  },
  { name: "duplicate_resume", title: "Copy a resume", annotations: ADD, agentTools: ["duplicateResume"] },
  {
    name: "delete_resume",
    title: "Delete a resume",
    annotations: CHANGE,
    agentTools: ["deleteResume"],
    preview: previewDeleteResume,
    description:
      "Delete one of the user's resumes, with its reviews. It can't be undone. The last resume and the primary resume can't be deleted: to delete the primary, ask which resume should be primary instead and call set_primary_resume first.",
  },
  {
    name: "apply_review_suggestions",
    title: "Apply review suggestions",
    annotations: CHANGE,
    agentTools: ["applyReviewSuggestions"],
    preview: previewApplySuggestions,
    description:
      "Apply changes from a resume review, by each change's id from improve_resume or get_resume_review_details. They go to a copy by default, which later applies reuse; pass target 'original' only when the user asks to change the reviewed resume. Pass text to use the user's own wording. Text with a [placeholder] is refused: ask the user for the real value, then pass it as text.",
  },
  {
    name: "export_resume",
    title: "Download a resume",
    annotations: READ,
    agentTools: ["exportResume"],
    description:
      "Get a link that downloads one of the user's resumes as a PDF or Word file. Give it to the user to open in a browser where they're signed in to GetHired. Free.",
  },
  {
    name: "get_resume_reviews",
    title: "My resume reviews",
    annotations: READ,
    agentTools: [],
    description: "List the user's resume reviews, newest first, with each one's status and score.",
    custom: {
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(RESUME_REVIEWS_MAX_LIMIT)
          .optional()
          .describe(`How many reviews to return (default ${RESUME_REVIEWS_DEFAULT_LIMIT}).`),
      }),
      run: async ({ limit }: { limit?: number }, ctx) => ({
        reviews: await listResumeReviews(ctx.supabase, ctx.user, { limit }),
      }),
    },
  },
  {
    name: "get_resume_review_details",
    title: "Resume review details",
    annotations: READ,
    agentTools: ["getResumeReview"],
    description:
      "Get a resume review's status, score, overall feedback and its top changes of every kind (pending first, then highest priority), each with the id that apply_review_suggestions needs, any [placeholders] the user must fill in, and its state on the copy and on the original resume (pending, applied, or changed if the resume moved on since the review).",
  },
  {
    name: "pick_resume_for_job",
    title: "Pick a resume for a job",
    annotations: READ,
    agentTools: ["pickResumeForJob"],
  },
  {
    name: "improve_resume",
    title: "Improve a resume",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    agentTools: ["improveResume"],
    description: `Suggest how to improve or tailor one of the user's resumes: rewrites, new bullets, removals, moves, and gaps to ask the user about, each change with its id. Pass a jobId or a pasted jobDescription to tailor it to a job, or neither to judge it on its own. It changes nothing: apply the ones the user chooses with apply_review_suggestions. Costs ${TAICredits.RESUME_IMPROVE} AI credits once it succeeds.`,
  },

  // --- Interviews ---
  { name: "list_interviews", title: "My mock interviews", annotations: READ, agentTools: ["listInterviews"] },
  {
    name: "get_interview_analysis",
    title: "Interview feedback",
    annotations: READ,
    agentTools: ["getInterviewAnalysis"],
  },
  {
    name: "create_interview",
    title: "Set up a mock interview",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    agentTools: ["createInterview"],
  },
  {
    name: "list_screening_interviews",
    title: "My screening interviews",
    annotations: READ,
    agentTools: ["listScreeningInterviews"],
  },
];

/** Applicant agent tools MCP leaves out, and why (spec §4.4). */
export const MCP_EXCLUDED_AGENT_TOOLS: Partial<Record<AgentToolName, string>> = {
  requestResumeUpload: "A browser widget. MCP users upload resumes at /resume.",
  reviewResumeChanges: "A browser widget. MCP clients apply with `apply_review_suggestions`.",
  askUser: "A question card in the chat. MCP clients ask the user themselves.",
  getResumeContent: "`get_resume_details` covers it.",
  saveMemory: "Agent memory, which means nothing outside the chat.",
  deleteMemory: "Agent memory, which means nothing outside the chat.",
};

// Agent memory isn't served over MCP, so its gated writes never confirm there.
const MEMORY_TOOLS = ["saveMemory", "deleteMemory"];

/**
 * Whether a tool spends credits or needs the user's confirmation, from the
 * agent's policy. MCP has no turns, so a gated write always confirms
 * (RMCP spec §4.4).
 */
export function mcpToolFlags(def: { agentTools: readonly string[] }, policy: ToolApprovalPolicy) {
  const confirmTools = [
    ...policy.alwaysAsk,
    ...policy.gatedWriteTools.filter((name) => !MEMORY_TOOLS.includes(name)),
  ];
  return {
    credit: def.agentTools.some((name) => policy.creditTools.includes(name)),
    confirm: def.agentTools.some((name) => confirmTools.includes(name)),
  };
}

const CONFIRM_NOTE = " GetHired asks the user to confirm before it runs.";

function executeAgentTool(tools: ToolsLike, name: string, input: unknown) {
  const tool = tools[name];
  if (!tool?.execute) throw new Error(`Agent tool ${name} has no server-side execute.`);
  return Promise.resolve(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tool.execute as any)(input, { toolCallId: `mcp-${name}`, messages: [], context: undefined }),
  ) as Promise<unknown>;
}

export type BoundMcpTool = {
  inputSchema: z.ZodTypeAny;
  description: string;
  /** Runs the tool. Never throws: errors come back as `{ error }`, like the agent's. */
  run: (input: unknown) => Promise<unknown>;
};

/** Rewrites agent tool names in an agent description to their MCP names. */
function renameAgentTools(text: string, mcpNames: Readonly<Record<string, string>>) {
  return text.replace(/\b[a-z]+(?:[A-Z][a-z]*)+\b/g, (word) => mcpNames[word] ?? word);
}

/**
 * Binds a catalog row to the caller's agent tools, under the role's approval
 * policy. With `mcpNames`, agent tool names in the agent's own description
 * become MCP names (the recruiter catalog reuses most descriptions as is).
 */
export function bindMcpTool<TName extends string, TCtx extends AgentToolContext, TTools extends ToolsLike>(
  def: McpToolDef<TName, TCtx, TTools>,
  ctx: TCtx,
  tools: TTools,
  policy: ToolApprovalPolicy,
  { mcpNames }: { mcpNames?: Readonly<Record<string, string>> } = {},
): BoundMcpTool {
  const { confirm } = mcpToolFlags(def, policy);
  if (confirm !== Boolean(def.preview)) {
    throw new Error(`MCP tool ${def.name} needs a preview exactly when it asks for confirmation.`);
  }
  const [primary] = def.agentTools;
  const primaryTool = primary ? tools[primary] : undefined;
  if (primary && !primaryTool) throw new Error(`MCP tool ${def.name} needs the agent tool ${primary}.`);
  const agentDescription = typeof primaryTool?.description === "string" ? primaryTool.description : "";
  const description =
    (def.description ?? (mcpNames ? renameAgentTools(agentDescription, mcpNames) : agentDescription)) +
    (confirm ? CONFIRM_NOTE : "");

  if (def.custom) {
    const { inputSchema, run } = def.custom;
    return {
      inputSchema,
      description,
      run: (input) => withToolErrors(ctx, def.name, () => run(input, ctx, tools)),
    };
  }
  if (def.agentTools.length !== 1) {
    throw new Error(`MCP tool ${def.name} needs a custom body to run more than one agent tool.`);
  }
  return {
    inputSchema: primaryTool!.inputSchema as unknown as z.ZodTypeAny,
    description,
    // The agent tool already wraps its own errors with withToolErrors.
    run: (input) => executeAgentTool(tools, primary, input),
  };
}
