import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { BOARD_JOB_ID, OTHER_JOB_ID, TRACKER_USER_ID, gethiredApplication, trackedRow } from "@/test/utils/tracker";
import { GETHIRED_APPLICATION_COLUMNS, listMyApplications } from "./list-my-applications";

let mock: SupabaseMock;
const ctx = () => ({ supabase: mock.client, user: { id: TRACKER_USER_ID } });

function seed({
  applications = [] as unknown[],
  tracked = [] as unknown[],
  notes = [] as unknown[],
  screening = [] as unknown[],
  scheduled = [] as unknown[],
} = {}) {
  mock.queue("applications", { data: applications, error: null });
  mock.queue("tracked_applications", { data: tracked, error: null });
  mock.queue("applicant_application_notes", { data: notes, error: null });
  mock.queueRpc("my_screening_interviews", { data: screening, error: null });
  mock.queueRpc("my_scheduled_interviews", { data: scheduled, error: null });
}

beforeEach(() => {
  mock = createSupabaseMock();
});

describe("listMyApplications", () => {
  it("reads GetHired applications without any stage column, unmerged, as the ctx user", async () => {
    seed();
    await listMyApplications(ctx());

    expect(GETHIRED_APPLICATION_COLUMNS).not.toMatch(/stage|kind|pipeline/);
    const call = mock.callsFor("applications")[0];
    expect(call.chain).toContainEqual({ method: "select", args: [GETHIRED_APPLICATION_COLUMNS] });
    expect(call.chain).toContainEqual({ method: "eq", args: ["applicant_user_id", TRACKER_USER_ID] });
    expect(call.chain).toContainEqual({ method: "is", args: ["merged_into_application_id", null] });
    const tracked = mock.callsFor("tracked_applications")[0];
    expect(tracked.chain).toContainEqual({ method: "eq", args: ["user_id", TRACKER_USER_ID] });
    expect(tracked.chain).toContainEqual({ method: "neq", args: ["status", "saved"] });
  });

  it("places GetHired cards by status and interviews only", async () => {
    seed({
      applications: [
        gethiredApplication({ id: "g1", status: "reviewed" }),
        gethiredApplication({ id: "g2", status: "submitted" }),
        gethiredApplication({ id: "g3", status: "stand_by" }),
        gethiredApplication({ id: "g4", status: "submitted" }),
      ],
      screening: [{ id: "si1", application_id: "g2", status: "invited" }],
      scheduled: [{ id: "sc1", application_id: "g4", status: "scheduled" }],
    });
    const items = await listMyApplications(ctx());
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));

    expect(byId.g1).toMatchObject({ kind: "gethired", column: "in_review", statusLabel: "In review", status: null });
    expect(byId.g2).toMatchObject({ column: "interviewing", screeningInterviewId: "si1" });
    expect(byId.g3).toMatchObject({ column: "in_review", onHold: true, statusLabel: "On hold" });
    expect(byId.g4).toMatchObject({ column: "interviewing", screeningInterviewId: null });
  });

  it("flags a card whose board job is closed, without changing its status or column", async () => {
    const closedJob = { id: BOARD_JOB_ID, job_name: "Platform Engineer", company_name: "Initech", locations: ["Pune"], status: "inactive" };
    seed({
      applications: [gethiredApplication({ id: "g1", status: "reviewed" }), { ...gethiredApplication({ id: "g2" }), all_jobs: closedJob }],
      tracked: [
        { ...trackedRow({ id: "t1", all_jobs_id: OTHER_JOB_ID }), all_jobs: { status: "inactive" } },
        { ...trackedRow({ id: "t2" }), all_jobs: null },
      ],
    });
    const byId = Object.fromEntries((await listMyApplications(ctx())).map((item) => [item.id, item]));

    expect(byId.g1).toMatchObject({ jobClosed: false, column: "in_review" });
    expect(byId.g2).toMatchObject({ jobClosed: true, column: "applied", jobTitle: "Platform Engineer" });
    expect(byId.t1).toMatchObject({ jobClosed: true, status: "applied" });
    expect(byId.t2.jobClosed).toBe(false);
  });

  it("ignores a cancelled screening interview", async () => {
    seed({
      applications: [gethiredApplication({ id: "g1", status: "submitted" })],
      screening: [{ id: "si1", application_id: "g1", status: "cancelled" }],
    });
    expect((await listMyApplications(ctx()))[0]).toMatchObject({ column: "applied", screeningInterviewId: null });
  });

  it("adds the private note's follow-up date to a GetHired card", async () => {
    seed({
      applications: [gethiredApplication({ id: "g1" })],
      notes: [{ application_id: "g1", notes: "Ping", next_follow_up_at: "2026-11-30" }],
    });
    expect((await listMyApplications(ctx()))[0]).toMatchObject({ notes: "Ping", nextFollowUpAt: "2026-11-30" });
  });

  it("maps tracked rows and legacy rows, hiding a legacy row that has a tracked twin", async () => {
    seed({
      applications: [
        { ...gethiredApplication({ id: "l1", status: "stand_by", all_jobs_id: OTHER_JOB_ID }), job_post_id: null },
        { ...gethiredApplication({ id: "l2", status: "selected", all_jobs_id: BOARD_JOB_ID }), job_post_id: null },
      ],
      tracked: [trackedRow({ id: "t1", status: "ghosted", all_jobs_id: BOARD_JOB_ID, applied_at: "2026-11-01" })],
    });
    const items = await listMyApplications(ctx());

    expect(items.map((item) => item.id).sort()).toEqual(["l1", "t1"]);
    expect(items.find((item) => item.id === "l1")).toMatchObject({
      kind: "tracked",
      legacy: true,
      status: "in_review",
      column: "in_review",
    });
    expect(items.find((item) => item.id === "t1")).toMatchObject({ legacy: false, column: "closed", statusLabel: "Ghosted" });
  });

  it.each([
    ["submitted", "applied"],
    ["reviewed", "in_review"],
    ["stand_by", "in_review"],
    ["selected", "offer"],
    ["rejected", "rejected"],
  ] as const)("maps a legacy %s row to %s", async (from, to) => {
    seed({ applications: [{ ...gethiredApplication({ id: "l1", status: from }), job_post_id: null }] });
    expect((await listMyApplications(ctx()))[0].status).toBe(to);
  });

  it("sorts by applied date and filters by keyword, status and column", async () => {
    seed({
      applications: [gethiredApplication({ id: "g1", created_at: "2026-11-10T00:00:00Z" })],
      tracked: [
        trackedRow({ id: "t1", applied_at: "2026-11-20", company_name: "Acme" }),
        trackedRow({ id: "t2", applied_at: "2026-11-05", company_name: "Hooli", status: "offer" }),
      ],
    });
    expect((await listMyApplications(ctx())).map((item) => item.id)).toEqual(["t1", "g1", "t2"]);

    seed({ tracked: [trackedRow({ id: "t1", company_name: "Acme" }), trackedRow({ id: "t2", company_name: "Hooli" })] });
    expect((await listMyApplications(ctx(), { q: "hooli" })).map((item) => item.id)).toEqual(["t2"]);

    seed({
      applications: [gethiredApplication({ id: "g1", status: "selected" })],
      tracked: [trackedRow({ id: "t1", status: "offer" }), trackedRow({ id: "t2" })],
    });
    expect((await listMyApplications(ctx(), { column: "offer" })).map((item) => item.id).sort()).toEqual(["g1", "t1"]);

    seed({ applications: [gethiredApplication({ id: "g1" })], tracked: [trackedRow({ id: "t1", status: "offer" })] });
    expect((await listMyApplications(ctx(), { statuses: ["offer"] })).map((item) => item.id)).toEqual(["t1"]);
  });
});
