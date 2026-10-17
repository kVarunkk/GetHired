import { describe, expect, it } from "vitest";
import { auditActorLabel, auditDateBounds, describeAuditEntry, toAuditEntry, type AuditEntry } from "./audit";

const entry = (overrides: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  actorUserId: "a0000000-0000-4000-8000-000000000001",
  actorName: "Olive Owner",
  actorKind: "user",
  action: "role.created",
  targetType: "role",
  targetId: "r1",
  targetLabel: "Recruiter",
  before: null,
  after: null,
  createdAt: "2026-10-17T10:00:00.000Z",
  ...overrides,
});

describe("toAuditEntry", () => {
  it("maps the RPC row and defaults an unknown actor kind to user", () => {
    expect(
      toAuditEntry({
        id: "42",
        actor_user_id: null,
        actor_name: null,
        actor_kind: "weird",
        action: "member.left",
        target_type: "member",
        target_id: "u1",
        target_label: "Sam",
        before: null,
        after: null,
        created_at: "2026-10-17T10:00:00.000Z",
      }),
    ).toMatchObject({ id: 42, actorKind: "user", action: "member.left", targetLabel: "Sam" });
  });
});

describe("auditActorLabel", () => {
  it("keeps the name of an actor who left, and names the system", () => {
    expect(auditActorLabel(entry({ actorUserId: null }))).toBe("Olive Owner");
    expect(auditActorLabel(entry({ actorName: null }))).toBe("A former member");
    expect(auditActorLabel(entry({ actorKind: "system" }))).toBe("GetHired");
  });
});

describe("describeAuditEntry (RP-REQ-015)", () => {
  it("shows a grant and limit diff for role edits", () => {
    const { text, details } = describeAuditEntry(
      entry({
        action: "role.updated",
        before: { name: "Recruiter", grants: { "jobs.view": "all", "notes.view": "all" }, limits: {} },
        after: {
          name: "Senior recruiter",
          grants: { "jobs.view": "assigned", "notes.view": "all", "notes.write": "all" },
          limits: { outreach: 50 },
        },
      }),
    );
    expect(text).toBe("edited the role Recruiter");
    expect(details).toEqual([
      "Renamed from Recruiter to Senior recruiter",
      expect.stringMatching(/^.+: all jobs → assigned jobs$/),
      expect.stringMatching(/^\+ .+ \(all jobs\)$/),
      "outreach: no limit → 50 a month",
    ]);
  });

  it("names the replacement when a deleted role's holders moved", () => {
    expect(
      describeAuditEntry(
        entry({ action: "role.deleted", after: { replacement: { id: "r2", name: "Member" }, moved: 3 } }),
      ),
    ).toEqual({ text: "deleted the role Recruiter", details: ["3 moved to Member"] });
  });

  it("describes role changes, owners, invites and hiring teams", () => {
    const cases: [Partial<AuditEntry>, string][] = [
      [
        {
          action: "member.role_changed",
          targetLabel: "Sam",
          before: { role: { name: "Member" } },
          after: { role: { name: "Recruiter" } },
        },
        "changed Sam's role from Member to Recruiter",
      ],
      [{ action: "member.removed", targetLabel: "Sam" }, "removed Sam from the team"],
      [{ action: "member.left", targetLabel: "Sam" }, "left the team"],
      [{ action: "owner.added", targetLabel: "Sam" }, "made Sam an owner"],
      [{ action: "owner.primary_changed", targetLabel: "Sam" }, "made Sam the primary owner"],
      [
        { action: "invite.created", targetLabel: "priya@gmail.com", after: { role: { name: "Member" } } },
        "invited priya@gmail.com as Member",
      ],
      [{ action: "invite.revoked", targetLabel: "priya@gmail.com" }, "revoked the invite for priya@gmail.com"],
      [
        { action: "job.assigned", targetLabel: "Backend Engineer", after: { name: "Sam" } },
        "added Sam to the hiring team for Backend Engineer",
      ],
      [
        { action: "job.unassigned", targetLabel: "Backend Engineer", before: { name: "Sam" } },
        "removed Sam from the hiring team for Backend Engineer",
      ],
      [{ action: "role.default_changed" }, "made Recruiter the default role for invites"],
    ];
    for (const [overrides, text] of cases) expect(describeAuditEntry(entry(overrides)).text).toBe(text);
  });

  it("says when the agent made the change", () => {
    expect(describeAuditEntry(entry({ actorKind: "agent" })).text).toBe(
      "created the role Recruiter with the recruiter agent",
    );
  });
});

describe("auditDateBounds", () => {
  it("makes both days inclusive and ignores malformed ones", () => {
    expect(auditDateBounds({ since: "2026-10-01", until: "2026-10-31" })).toEqual({
      since: "2026-10-01T00:00:00.000Z",
      until: "2026-11-01T00:00:00.000Z",
    });
    expect(auditDateBounds({ since: "yesterday", until: null })).toEqual({ since: null, until: null });
  });
});
