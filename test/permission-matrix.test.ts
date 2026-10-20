import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { ADMIN_A, MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { PERMISSION_MATRIX, PastAuth, pastAuthClient, runEntry } from "@/test/utils/permission-matrix";
import { ADMIN_KEYS, MEMBER_KEYS } from "@/helpers/companies/role-templates";
import type { PermissionKey } from "@/helpers/companies/permissions";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createPublicClient } from "@/lib/supabase/public";

// RP-TEST-004 / RPT-001: who gets past the permission check, per company
// action, route and recruiter tool. `true` = allowed. Recorded against the
// teams-era code (owner/admin/member) and kept green through the roles
// migration, where Admin and Member are roles built from RP-REQ-004.
const EXPECTED: Record<string, [owner: boolean, admin: boolean, member: boolean]> = {
  "action:cancelCompanyPlan": [true, false, false],
  "action:changeCompanyPlan": [true, false, false],
  "action:resumeCompanyPlan": [true, false, false],
  "action:openBillingPortal": [true, false, false],
  "route:POST /api/company/billing/checkout": [true, false, false],
  "route:GET /api/company/billing": [true, true, true],
  "action:upsertJobPosting (create)": [true, true, false],
  "action:upsertJobPosting (edit)": [true, true, false],
  "action:setJobPostingStatus": [true, true, false],
  "action:deleteJobPosting": [true, true, false],
  "route:GET /api/company/applications/[id]/screening": [true, true, true],
  "route:GET /api/company/job-posts/[job_id]/pipeline": [true, true, true],
  "route:POST /api/company/job-posts/[job_id]/screen": [true, true, true],
  "action:moveApplications": [true, true, true],
  "action:previewAgentMove": [true, true, true],
  "action:previewEmail": [true, true, true],
  "action:updateApplicationStatus": [true, true, true],
  "action:addNote": [true, true, true],
  "action:updateNote": [true, true, true],
  "action:deleteNote": [true, true, true],
  "action:listTalentLists": [true, true, true],
  "action:saveTalentList": [true, true, true],
  "action:triggerJobPostingRelevanceUpdate": [true, true, true],
  "route:POST /api/company/matches/explain": [true, true, true],
  "route:GET /api/company/outreach": [true, true, true],
  "route:POST /api/company/outreach": [true, true, true],
  "action:draftOutreach": [true, true, true],
  "action:loadOutreachComposer": [true, true, true],
  "action:previewAgentOutreach": [true, true, true],
  "action:sendOutreach": [true, true, true],
  "action:withdrawOutreach": [true, true, true],
  "action:saveStages": [true, true, false],
  "action:createTemplate": [true, true, false],
  "action:saveTemplate": [true, true, false],
  "action:deleteTemplate": [true, true, false],
  "action:saveSchedulingLink": [true, true, false],
  "action:saveNotificationSettings": [true, true, false],
  "action:inviteMember": [true, true, false],
  "action:resendInvite": [true, true, false],
  "action:revokeInvite": [true, true, false],
  "action:changeRole": [true, true, false],
  "action:removeMember (someone else)": [true, true, false],
  "action:removeMember (leave)": [true, true, true],
  // Owners (RP-REQ-006) replace transferOwnership: owners only, as before.
  "action:setOwner": [true, false, false],
  "action:makePrimaryOwner": [true, false, false],
  // New with roles: roles.manage and jobs.assign (Admin has both, Member neither).
  "action:createRole": [true, true, false],
  "action:updateRole": [true, true, false],
  "action:deleteRole": [true, true, false],
  "action:setDefaultRole": [true, true, false],
  "action:listAudit": [true, true, false],
  "action:assignJob": [true, true, false],
  "action:unassignJob": [true, true, false],
  "action:updateDisplayName": [true, true, true],
  "tool:getMyCompany": [true, true, true],
  "tool:listMyJobs": [true, true, true],
  "tool:getJobPost": [true, true, true],
  "tool:createJobPost": [true, true, false],
  "tool:updateJobPost": [true, true, false],
  "tool:setJobPostStatus": [true, true, false],
  "tool:deleteJobPost": [true, true, false],
  "tool:searchCandidates": [true, true, true],
  "tool:findMatchesForJob": [true, true, true],
  "tool:runMatchingForJob": [true, true, true],
  "tool:getCandidateProfile": [true, true, true],
  "tool:compareCandidates": [true, true, true],
  "tool:saveCandidate": [true, true, true],
  "tool:unsaveCandidate": [true, true, true],
  "tool:listApplicants": [true, true, true],
  "tool:getApplication": [true, true, true],
  "tool:getHiringFunnel": [true, true, true],
  "tool:listStages": [true, true, true],
  "tool:createStage": [true, true, false],
  "tool:renameStage": [true, true, false],
  "tool:reorderStages": [true, true, false],
  "tool:archiveStage": [true, true, false],
  "tool:listEmailTemplates": [true, true, false],
  "tool:createEmailTemplate": [true, true, false],
  "tool:updateEmailTemplate": [true, true, false],
  "tool:deleteEmailTemplate": [true, true, false],
  "tool:moveApplications": [true, true, true],
  "tool:addNote": [true, true, true],
  "tool:listNotes": [true, true, true],
  "tool:updateNote": [true, true, true],
  "tool:deleteNote": [true, true, true],
  "tool:addToTalentList": [true, true, true],
  "tool:listTalentLists": [true, true, true],
  "tool:renameTalentList": [true, true, true],
  "tool:removeFromTalentList": [true, true, true],
  "tool:deleteTalentList": [true, true, true],
  "tool:explainMatch": [true, true, true],
  "tool:screenApplicants": [true, true, true],
  "tool:sendOutreach": [true, true, true],
  "tool:listOutreach": [true, true, true],
  "tool:getOutreach": [true, true, true],
  "tool:withdrawOutreach": [true, true, true],
  "tool:setDefaultRole": [true, true, false],
  "tool:removeTeamMember": [true, true, false],
  "tool:saveMemory": [true, true, true],
  "tool:deleteMemory": [true, true, true],
};

const MEMBERS: [string, MemberFixture, number][] = [
  ["owner", OWNER_A, 0],
  ["admin", ADMIN_A, 1],
  ["member", MEMBER_A, 2],
];

describe("the permission matrix (RP-TEST-004)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new PastAuth("fetch");
      }),
    );
  });

  it("covers every entry exactly once", () => {
    const names = PERMISSION_MATRIX.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  describe.each(MEMBERS)("as the %s", (_label, member, column) => {
    beforeEach(async () => {
      const client = pastAuthClient(member);
      await setRequestUser(member.user, client);
      vi.mocked(createServiceRoleClient).mockReturnValue(client);
      vi.mocked(createPublicClient).mockReturnValue(client as never);
    });

    it.each(PERMISSION_MATRIX.map((e) => [e.name, e] as const))("%s", async (name, entry) => {
      const outcome = await runEntry(entry, member);
      expect(outcome).toBe(EXPECTED[name][column] ? "allowed" : "forbidden");
    }, 30_000);
  });

  // RPT-001: each row's result for Admin and Member must match what spec
  // RP-REQ-004 gives the key it maps to. A mismatch is a difference to
  // resolve before the migration (tasks file, "Differences from the spec").
  it("agrees with the spec's Admin and Member lists (RP-REQ-004)", () => {
    const has = (keys: PermissionKey[], p: PermissionKey | "owner" | null) =>
      p === null ? true : p === "owner" ? false : keys.includes(p);
    const mismatches = PERMISSION_MATRIX.filter((e) => {
      const [, admin, member] = EXPECTED[e.name];
      return admin !== has(ADMIN_KEYS, e.permission) || member !== has(MEMBER_KEYS, e.permission);
    }).map((e) => e.name);
    expect(mismatches).toEqual([]);
  });
});
