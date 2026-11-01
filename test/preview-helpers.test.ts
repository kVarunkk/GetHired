import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { ADMIN_A, JOB_A1, JOB_A2, memberOf, memberWith, type MemberFixture } from "@/test/utils/team";
import type { CompanySessionContext } from "@/helpers/companies/company-session";
import { forbiddenMessage, type PermissionKey } from "@/helpers/companies/permissions";
import { previewAgentMove } from "@/helpers/pipeline/preview-agent-move";
import { previewAgentOutreach } from "@/helpers/outreach/preview-agent-outreach";
import { previewAgentJobDelete } from "@/helpers/jobs/preview-agent-job-delete";
import { previewAgentAddToJob } from "@/helpers/candidates/preview-agent-add-to-job";
import { previewAgentInterviewInvite } from "@/helpers/interview/screening/preview-agent-interview-invite";
import {
  previewAgentAddCandidate,
  previewAgentDeleteCandidates,
  previewAgentImport,
} from "@/helpers/candidates/preview-agent-import";
import { previewAgentRole } from "@/helpers/companies/preview-agent-role";

// RMT-023/024: the approval previews' cores, which MCP calls with the session
// it resolved itself. Each one re-checks its permission (MCP has no action
// wrapper), and none reads the request. The actions' own tests pin the
// previews' content.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));

const APP = "e0000000-0000-4000-8000-000000000001";
const STAGE = "90000000-0000-4000-8000-000000000002";
const BATCH = "cb000000-0000-4000-8000-000000000001";
const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
const ROLE = "70000000-0000-4000-8000-000000000001";

const HELPERS = {
  "pipeline/preview-agent-move": previewAgentMove,
  "outreach/preview-agent-outreach": previewAgentOutreach,
  "jobs/preview-agent-job-delete": previewAgentJobDelete,
  "candidates/preview-agent-add-to-job": previewAgentAddToJob,
  "interview/screening/preview-agent-interview-invite": previewAgentInterviewInvite,
  "candidates/preview-agent-import": previewAgentImport,
  "companies/preview-agent-role": previewAgentRole,
};

let rls: SupabaseMock;
const session = (member: MemberFixture): CompanySessionContext => {
  rls = createSupabaseMock({ user: member.user });
  return { supabase: rls.client, company: member.myCompany, user: member.user };
};

beforeEach(() => vi.clearAllMocks());

type Case = {
  name: string;
  run: (s: CompanySessionContext) => Promise<{ ok: boolean; error?: string }>;
  permission: PermissionKey;
  /** A member who lacks it for this input. */
  without: MemberFixture;
  forJob?: boolean;
};

const NOBODY = memberWith([]);
const ASSIGNED_MEMBER = memberOf(COMPANY_A, "member", { assignedJobIds: [JOB_A1] });

const CASES: Case[] = [
  {
    name: "previewAgentMove",
    run: (s) => previewAgentMove(s, { applicationIds: [APP], stageId: STAGE }),
    permission: "pipeline.move",
    without: NOBODY,
  },
  {
    name: "previewAgentOutreach",
    run: (s) => previewAgentOutreach(s, { candidateId: CANDIDATE, subject: "Hi", message: "Hello there" }),
    permission: "outreach.send",
    without: NOBODY,
  },
  {
    name: "previewAgentJobDelete (a job outside the member's scope)",
    run: (s) => previewAgentJobDelete(s, { jobPostId: JOB_A2 }),
    permission: "jobs.delete",
    without: memberWith([{ key: "jobs.delete", scope: "assigned" }], { assignedJobIds: [JOB_A1] }),
    forJob: true,
  },
  {
    name: "previewAgentAddToJob (a job outside the member's scope)",
    run: (s) => previewAgentAddToJob(s, { jobPostId: JOB_A2, candidateIds: [CANDIDATE] }),
    permission: "applicants.import",
    without: ASSIGNED_MEMBER,
    forJob: true,
  },
  {
    name: "previewAgentInterviewInvite",
    run: (s) => previewAgentInterviewInvite(s, { applicationIds: [APP] }),
    permission: "interviews.manage",
    without: NOBODY,
  },
  {
    name: "previewAgentImport",
    run: (s) => previewAgentImport(s, { batchId: BATCH }),
    permission: "applicants.import",
    without: NOBODY,
  },
  {
    name: "previewAgentAddCandidate",
    run: (s) => previewAgentAddCandidate(s, { full_name: "Asha", jobPostId: JOB_A1 }),
    permission: "applicants.import",
    without: NOBODY,
  },
  {
    name: "previewAgentDeleteCandidates (an import permission scoped to jobs)",
    run: (s) => previewAgentDeleteCandidates(s, { candidateIds: [CANDIDATE] }),
    permission: "applicants.import",
    without: ASSIGNED_MEMBER,
  },
  {
    name: "previewAgentRole (role changes)",
    run: (s) => previewAgentRole(s, { tool: "updateRole", input: { roleId: ROLE, name: "Lead" } }),
    permission: "roles.view",
    without: NOBODY,
  },
  {
    name: "previewAgentRole (invites)",
    run: (s) => previewAgentRole(s, { tool: "revokeInvite", input: { inviteId: ROLE } }),
    permission: "team.invite",
    without: memberWith(["roles.view"]),
  },
];

describe("preview helpers (RMT-023/024)", () => {
  it.each(CASES)("$name refuses without $permission and reads nothing", async ({ run, permission, without, forJob }) => {
    const result = await run(session(without));
    expect(result).toEqual({ ok: false, error: forbiddenMessage(permission, forJob ? { forJob: true } : undefined) });
    expect(rls.calls).toHaveLength(0);
  });

  it.each(CASES)("$name runs on the given session without reading the request", async ({ run }) => {
    await run(session(ADMIN_A)).catch(() => undefined);
    expect(rls.calls.length).toBeGreaterThan(0);
    expect(getUserFromRequest).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(Object.keys(HELPERS))("helpers/%s.ts imports nothing request-bound", (path) => {
    const source = readFileSync(`helpers/${path}.ts`, "utf8");
    expect(source).not.toContain("@/lib/supabase/server");
    expect(source).not.toContain("getUserFromRequest");
    expect(source).not.toMatch(/requireCompany(ForAction)?\(/);
    expect(source).not.toContain("next/headers");
    expect(source).not.toMatch(/^"use server"/m);
  });
});
