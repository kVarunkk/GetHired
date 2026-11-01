/**
 * RMT-030: the recruiter MCP catalog (RMCP spec §4.4). Every recruiter agent
 * tool is a row or excluded, the flags come from the recruiter approval
 * policy, and the hints, toolsets and descriptions match the spec.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { recruiterToolContext } from "@/test/utils/tools";
import { OWNER_A } from "@/test/utils/team";
import {
  createAllRecruiterTools,
  createRecruiterTools,
  type RecruiterToolContext,
  type RecruiterTools,
} from "@/helpers/agent/roles/recruiter/tools";
import { RECRUITER_TOOL_PERMISSIONS } from "@/helpers/agent/roles/recruiter/tools/permissions";
import { RECRUITER_APPROVAL_POLICY } from "@/helpers/agent/roles/recruiter/approval";
import { candidateImportPath, jobImportPath } from "@/helpers/candidates/paths";
import { toCallToolResult } from "./results";
import { toMcpSchema } from "./schema";
import { MCP_TOOLS, bindMcpTool, mcpToolFlags } from "./tools";
import { MCP_CORE_TOOLSET, MCP_TOOLSETS } from "./toolsets";
import { RECRUITER_MCP_EXCLUDED_TOOLS, RECRUITER_MCP_NAMES, RECRUITER_MCP_TOOLS } from "./recruiter-tools";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

let ctx: RecruiterToolContext;
let tools: RecruiterTools;

beforeEach(() => {
  ctx = recruiterToolContext(createSupabaseMock().client, {
    user: OWNER_A.user,
    company: OWNER_A.myCompany,
    sessionId: null,
    surface: "mcp",
  });
  tools = createRecruiterTools(ctx);
});

const def = (name: string) => RECRUITER_MCP_TOOLS.find((tool) => tool.name === name)!;
const bind = (name: string) =>
  bindMcpTool(def(name), ctx, tools, RECRUITER_APPROVAL_POLICY, { mcpNames: RECRUITER_MCP_NAMES });
const flags = (name: string) => mcpToolFlags(def(name), RECRUITER_APPROVAL_POLICY);
const named = (predicate: (name: string) => boolean) =>
  RECRUITER_MCP_TOOLS.map((tool) => tool.name)
    .filter(predicate)
    .sort();
const snake = (camel: string) => camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** RMCP spec §4.4's tables: the toolset and the hint code of every row. */
const SPEC: Record<string, [string, "R" | "D I" | "D ¬I" | "¬D I" | "¬D ¬I" | "D I O" | "D ¬I O" | "¬D ¬I O"]> = {
  get_my_company: ["core", "R"],
  list_my_jobs: ["jobs", "R"],
  get_job_post: ["jobs", "R"],
  list_question_sets: ["jobs", "R"],
  create_job_post: ["jobs", "¬D ¬I"],
  update_job_post: ["jobs", "D I"],
  set_job_post_status: ["jobs", "D I O"],
  delete_job_post: ["jobs", "D ¬I"],
  apply_question_set: ["jobs", "D I"],
  save_question_set: ["jobs", "¬D ¬I"],
  delete_question_set: ["jobs", "D I"],
  search_candidates: ["talent", "R"],
  find_matches_for_job: ["talent", "R"],
  get_candidate_profile: ["talent", "R"],
  compare_candidates: ["talent", "R"],
  explain_match: ["talent", "R"],
  run_matching_for_job: ["talent", "¬D ¬I"],
  save_candidate: ["talent", "¬D I"],
  unsave_candidate: ["talent", "¬D I"],
  list_applicants: ["applicants", "R"],
  get_application: ["applicants", "R"],
  get_hiring_funnel: ["applicants", "R"],
  screen_applicants: ["applicants", "¬D ¬I"],
  list_stages: ["pipeline", "R"],
  list_notes: ["pipeline", "R"],
  create_stage: ["pipeline", "¬D ¬I"],
  rename_stage: ["pipeline", "¬D I"],
  reorder_stages: ["pipeline", "¬D I"],
  archive_stage: ["pipeline", "D I"],
  move_applications: ["pipeline", "D ¬I O"],
  add_note: ["pipeline", "¬D ¬I"],
  update_note: ["pipeline", "D I"],
  delete_note: ["pipeline", "D I"],
  list_talent_lists: ["lists", "R"],
  add_to_talent_list: ["lists", "¬D I"],
  rename_talent_list: ["lists", "¬D I"],
  remove_from_talent_list: ["lists", "¬D I"],
  delete_talent_list: ["lists", "D I"],
  find_pool_candidates: ["candidates", "R"],
  list_imports: ["candidates", "R"],
  get_import: ["candidates", "R"],
  list_my_candidates: ["candidates", "R"],
  get_my_candidate: ["candidates", "R"],
  find_jobs_for_my_candidate: ["candidates", "R"],
  add_candidates_to_job: ["candidates", "¬D ¬I"],
  update_import_rows: ["candidates", "¬D I"],
  remove_import_rows: ["candidates", "D I"],
  retry_import_rows: ["candidates", "¬D ¬I"],
  confirm_import: ["candidates", "¬D ¬I"],
  add_candidate: ["candidates", "¬D ¬I"],
  update_my_candidate: ["candidates", "D I"],
  delete_my_candidates: ["candidates", "D I"],
  add_my_candidates_to_list: ["candidates", "¬D I"],
  remove_my_candidate_from_list: ["candidates", "¬D I"],
  list_outreach: ["outreach", "R"],
  get_outreach: ["outreach", "R"],
  list_email_templates: ["outreach", "R"],
  send_outreach: ["outreach", "D ¬I O"],
  withdraw_outreach: ["outreach", "D I"],
  create_email_template: ["outreach", "¬D ¬I"],
  update_email_template: ["outreach", "D I"],
  delete_email_template: ["outreach", "D I"],
  get_interview_setup: ["interviews", "R"],
  get_interview_report: ["interviews", "R"],
  compare_interview_reports: ["interviews", "R"],
  configure_screening_interview: ["interviews", "D I"],
  invite_to_interview: ["interviews", "D ¬I O"],
  list_team: ["team", "R"],
  list_hiring_teams: ["team", "R"],
  get_audit_log: ["team", "R"],
  list_roles: ["team", "R"],
  get_role: ["team", "R"],
  list_invites: ["team", "R"],
  create_role: ["team", "¬D ¬I"],
  update_role: ["team", "D I"],
  delete_role: ["team", "D I"],
  assign_role: ["team", "D I"],
  remove_team_member: ["team", "D I"],
  unassign_from_job: ["team", "D I"],
  revoke_invite: ["team", "D I"],
  set_default_role: ["team", "¬D I"],
  assign_to_job: ["team", "¬D I"],
  invite_team_member: ["team", "¬D ¬I O"],
  resend_invite: ["team", "¬D ¬I O"],
  get_careers_page: ["careers", "R"],
  update_careers_page: ["careers", "D I O"],
  set_careers_published: ["careers", "D I O"],
  set_careers_address: ["careers", "D I"],
};

const hintCode = (name: string) => {
  const a = def(name).annotations;
  if (a.readOnlyHint) return "R";
  return [a.destructiveHint ? "D" : "¬D", a.idempotentHint ? "I" : "¬I", ...(a.openWorldHint ? ["O"] : [])].join(" ");
};

describe("RECRUITER_MCP_TOOLS", () => {
  it("covers every recruiter agent tool once, or excludes it with a reason", () => {
    const covered = RECRUITER_MCP_TOOLS.flatMap((tool) => tool.agentTools);
    expect(new Set(covered).size).toBe(covered.length);
    const all = Object.keys(createAllRecruiterTools(ctx)).sort();
    expect(Object.keys(RECRUITER_TOOL_PERMISSIONS).sort()).toEqual(all);
    for (const name of all) {
      const excluded = name in RECRUITER_MCP_EXCLUDED_TOOLS;
      expect(covered.includes(name as never) !== excluded, name).toBe(true);
    }
    expect(Object.keys(RECRUITER_MCP_EXCLUDED_TOOLS).sort()).toEqual([
      "deleteMemory",
      "requestCandidateResume",
      "requestResumeImport",
      "requestSpreadsheetImport",
      "saveMemory",
    ]);
    for (const reason of Object.values(RECRUITER_MCP_EXCLUDED_TOOLS)) expect(reason!.length).toBeGreaterThan(10);
    expect(RECRUITER_MCP_TOOLS).toHaveLength(88);
  });

  it("names each tool after its agent tool, in snake_case, without colliding with the applicant catalog", () => {
    const names = RECRUITER_MCP_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    const applicant = new Set(MCP_TOOLS.map((tool) => tool.name));
    for (const tool of RECRUITER_MCP_TOOLS) {
      expect(tool.agentTools).toHaveLength(1);
      expect(tool.name).toBe(snake(tool.agentTools[0]));
      expect(applicant.has(tool.name), tool.name).toBe(false);
    }
  });

  it("matches the spec's toolsets and hints for every row", () => {
    expect(named(() => true)).toEqual(Object.keys(SPEC).sort());
    for (const tool of RECRUITER_MCP_TOOLS) {
      expect([MCP_CORE_TOOLSET, ...MCP_TOOLSETS], tool.name).toContain(tool.toolset);
      expect([tool.toolset, hintCode(tool.name)], tool.name).toEqual(SPEC[tool.name]);
      expect(tool.title.length, tool.name).toBeGreaterThan(0);
    }
    expect(named((name) => def(name).toolset === MCP_CORE_TOOLSET)).toEqual(["get_my_company"]);
  });

  it("declares all five annotations on every row (RMCP-REQ-007)", () => {
    for (const tool of RECRUITER_MCP_TOOLS) {
      const a = tool.annotations;
      expect(typeof a.openWorldHint, tool.name).toBe("boolean");
      if (a.readOnlyHint) {
        expect(a.destructiveHint, tool.name).toBeUndefined();
      } else {
        expect(typeof a.destructiveHint, tool.name).toBe("boolean");
        expect(typeof a.idempotentHint, tool.name).toBe("boolean");
      }
    }
  });

  it("takes the confirm and credit flags from RECRUITER_APPROVAL_POLICY (RMCP-REQ-005)", () => {
    const confirm = named((name) => flags(name).confirm);
    expect(confirm).toHaveLength(41);
    expect(confirm).toEqual(
      expect.arrayContaining(["add_note", "update_note", "update_import_rows", "update_my_candidate"]),
    );
    expect(named((name) => flags(name).credit)).toEqual(
      ["explain_match", "invite_to_interview", "retry_import_rows", "run_matching_for_job", "screen_applicants"].sort(),
    );
  });

  it("never confirms a read-only row", () => {
    for (const tool of RECRUITER_MCP_TOOLS.filter((t) => t.annotations.readOnlyHint)) {
      expect(flags(tool.name).confirm, tool.name).toBe(false);
    }
  });

  it("gives every confirm row, and only those, a preview and a confirmation_token input", () => {
    for (const tool of RECRUITER_MCP_TOOLS) {
      const { confirm } = flags(tool.name);
      expect(Boolean(tool.preview), tool.name).toBe(confirm);
      const json = toMcpSchema(bind(tool.name).inputSchema, { confirmationToken: confirm })[
        "~standard"
      ].jsonSchema.input({ target: "draft-2020-12" }) as { properties?: Record<string, unknown> };
      expect(Boolean(json.properties?.confirmation_token), tool.name).toBe(confirm);
    }
  });

  it("sets the email flag on exactly the three email-limited rows (spec §4.7)", () => {
    expect(named((name) => Boolean(def(name).email))).toEqual(
      ["invite_to_interview", "move_applications", "send_outreach"].sort(),
    );
  });

  describe("descriptions", () => {
    const agentNames = Object.keys(RECRUITER_TOOL_PERMISSIONS);

    it("name no agent tool, widget or agent approval", () => {
      for (const tool of RECRUITER_MCP_TOOLS) {
        const { description } = bind(tool.name);
        expect(description.length, tool.name).toBeGreaterThan(20);
        for (const name of agentNames) {
          expect(description, `${tool.name} mentions ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
        }
        expect(description, tool.name).not.toMatch(/widget|must approve/i);
      }
    });

    it("end confirm rows with the confirm note and say what credit rows use", () => {
      for (const tool of RECRUITER_MCP_TOOLS) {
        const { confirm, credit } = flags(tool.name);
        const { description } = bind(tool.name);
        if (confirm) expect(description, tool.name).toMatch(/GetHired asks the user to confirm before it runs\.$/);
        if (credit) expect(description, tool.name).toMatch(/credit|allowance|uses|holds/i);
      }
    });

    it("rewrites agent tool names in the agent's text to MCP names", () => {
      expect(bind("find_pool_candidates").description).toMatch(/\badd_candidates_to_job\b/);
      expect(bind("list_team").description).toMatch(/assign_role, assign_to_job and unassign_from_job/);
    });

    it("point uploads to the import pages, not the widgets", () => {
      for (const name of ["list_imports", "get_import"]) {
        expect(bind(name).description, name).toContain(candidateImportPath("resumes"));
        expect(bind(name).description, name).toContain(jobImportPath("<jobPostId>"));
      }
      expect(bind("add_candidate").description).toMatch(/\/company\/candidates\//);
    });

  });

  describe("one implementation (RMT-035, RMCP-REQ-003)", () => {
    const rows = () => RECRUITER_MCP_TOOLS.map((tool) => [tool.name, tool.agentTools[0]] as const);

    it.each(rows())("%s returns what %s returns, with absolute links", async (name, agentName) => {
      const output = { from: agentName, url: "/company/job-posts/j1", nested: [{ candidateUrl: "/company/profiles/c1" }] };
      const execute = vi.fn().mockResolvedValue(output);
      (tools[agentName] as { execute: unknown }).execute = execute;
      const input = { probe: name };

      const result = toCallToolResult(await bind(name).run(input));

      expect(execute).toHaveBeenCalledWith(input, expect.objectContaining({ messages: [] }));
      expect(result.structuredContent).toEqual({
        from: agentName,
        url: "http://localhost:3000/company/job-posts/j1",
        nested: [{ candidateUrl: "http://localhost:3000/company/profiles/c1" }],
      });
    });
  });
});
