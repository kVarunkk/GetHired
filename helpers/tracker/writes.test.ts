import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { BOARD_JOB_ID, TRACKER_USER_ID, trackedRow } from "@/test/utils/tracker";
import { listMySavedJobs } from "./list-my-saved";
import {
  markAsApplied,
  removeTrackedApplication,
  saveApplicationNote,
  setTrackedStatus,
  updateTrackedApplication,
} from "./writes";
import { TRACKER_COPY } from "./copy";

let mock: SupabaseMock;
const ctx = () => ({ supabase: mock.client, user: { id: TRACKER_USER_ID } });
const ID = "10000000-0000-4000-8000-000000000099";
const APP_ID = "20000000-0000-4000-8000-000000000001";

const expectOwnerFilter = (target: string, id: string, column = "user_id") => {
  const chain = mock.callsFor(target).at(-1)!.chain;
  expect(chain).toContainEqual({ method: "eq", args: ["id", id] });
  expect(chain).toContainEqual({ method: "eq", args: [column, TRACKER_USER_ID] });
};

beforeEach(() => {
  mock = createSupabaseMock();
});

describe("updateTrackedApplication", () => {
  it("writes only the given fields, recomputing the link's key, for the ctx user", async () => {
    mock.queue("tracked_applications", { data: { all_jobs_id: null }, error: null });
    mock.queue("tracked_applications", { data: trackedRow({ id: ID }), error: null });
    const result = await updateTrackedApplication(ctx(), ID, { notes: "Called", jobUrl: "https://www.lever.co/a/1/?utm_x=1" });

    expect(result.ok).toBe(true);
    expect(mock.callsFor("tracked_applications")[1].chain).toContainEqual({
      method: "update",
      args: [{ notes: "Called", job_url: "https://www.lever.co/a/1/?utm_x=1", job_url_key: "lever.co/a/1" }],
    });
    expectOwnerFilter("tracked_applications", ID);
  });

  it("keeps a GetHired job's title, company, link and place as the job has them", async () => {
    mock.queue("tracked_applications", { data: { all_jobs_id: BOARD_JOB_ID }, error: null });
    mock.queue("tracked_applications", { data: trackedRow({ id: ID }), error: null });
    await updateTrackedApplication(ctx(), ID, { jobTitle: "Renamed", companyName: "Other", location: "Mars", notes: "Called" });
    expect(mock.callsFor("tracked_applications")[1].chain).toContainEqual({ method: "update", args: [{ notes: "Called" }] });
  });

  it("is not found for someone else's id", async () => {
    mock.queue("tracked_applications", { data: null, error: null });
    expect(await updateTrackedApplication(ctx(), ID, { notes: "x" })).toEqual({
      ok: false,
      reason: "not_found",
      error: TRACKER_COPY.notFound,
    });
  });

  it("says it's already tracked when the new link is another card's", async () => {
    mock.queue("tracked_applications", { data: { all_jobs_id: null }, error: null });
    mock.queue("tracked_applications", { data: null, error: { code: "23505" } });
    expect(await updateTrackedApplication(ctx(), ID, { jobUrl: "https://a.com/1" })).toMatchObject({ reason: "conflict" });
  });
});

describe("setTrackedStatus and markAsApplied", () => {
  it("moves a card with its position", async () => {
    mock.queue("tracked_applications", { data: trackedRow({ id: ID, status: "offer" }), error: null });
    const result = await setTrackedStatus(ctx(), ID, "offer", { position: 12.5 });

    expect(result).toMatchObject({ ok: true, item: { status: "offer", column: "offer" } });
    expect(mock.callsFor("tracked_applications")[0].chain).toContainEqual({
      method: "update",
      args: [{ status: "offer", position: 12.5 }],
    });
    expectOwnerFilter("tracked_applications", ID);
  });

  it("marks a saved card as applied on a chosen date", async () => {
    mock.queue("tracked_applications", { data: trackedRow({ id: ID }), error: null });
    await markAsApplied(ctx(), ID, "2026-11-20");
    expect(mock.callsFor("tracked_applications")[0].chain).toContainEqual({
      method: "update",
      args: [{ status: "applied", applied_at: "2026-11-20" }],
    });
  });

  it("is not found for someone else's id", async () => {
    mock.queue("tracked_applications", { data: null, error: null });
    expect(await setTrackedStatus(ctx(), ID, "rejected")).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("removeTrackedApplication", () => {
  it("deletes the user's own card", async () => {
    mock.queue("tracked_applications", { data: [{ id: ID }], error: null });
    expect(await removeTrackedApplication(ctx(), ID)).toEqual({ ok: true, id: ID });
    expectOwnerFilter("tracked_applications", ID);
  });

  it("is not found when nothing was deleted", async () => {
    mock.queue("tracked_applications", { data: [], error: null });
    expect(await removeTrackedApplication(ctx(), ID)).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("saveApplicationNote", () => {
  it("checks the GetHired application is the user's, then upserts the note", async () => {
    mock.queue("applications", { data: { id: APP_ID }, error: null });
    expect(await saveApplicationNote(ctx(), { applicationId: APP_ID, notes: "Ping", nextFollowUpAt: "2026-12-01" })).toEqual({ ok: true });
    expectOwnerFilter("applications", APP_ID, "applicant_user_id");
    expect(mock.callsFor("applications")[0].chain).toContainEqual({ method: "not", args: ["job_post_id", "is", null] });
    expect(mock.callsFor("applicant_application_notes")[0].chain[0]).toEqual({
      method: "upsert",
      args: [
        { application_id: APP_ID, user_id: TRACKER_USER_ID, notes: "Ping", next_follow_up_at: "2026-12-01" },
        { onConflict: "application_id" },
      ],
    });
  });

  it("writes nothing for an application that isn't the user's", async () => {
    mock.queue("applications", { data: null, error: null });
    expect(await saveApplicationNote(ctx(), { applicationId: APP_ID, notes: "x", nextFollowUpAt: null })).toMatchObject({
      reason: "not_found",
    });
    expect(mock.callsFor("applicant_application_notes")).toHaveLength(0);
  });
});

describe("listMySavedJobs", () => {
  const seed = () => {
    mock.queue("user_favorites", {
      data: [
        { created_at: "2026-11-22T00:00:00Z", all_jobs: { id: BOARD_JOB_ID, job_name: "Backend", company_name: "Globex", locations: ["Pune"] } },
        { created_at: "2026-11-10T00:00:00Z", all_jobs: null },
      ],
      error: null,
    });
    mock.queue("tracked_applications", {
      data: [
        { id: "t1", job_title: "Designer", company_name: "Acme", location: null, job_url: "https://a.com/1", notes: "n", created_at: "2026-11-23T00:00:00Z" },
        { id: "t2", job_title: "PM", company_name: "Hooli", location: null, job_url: null, notes: null, created_at: "2026-11-01T00:00:00Z" },
      ],
      error: null,
    });
  };

  it("merges favorites and saved cards by saved date, reading saved rows only", async () => {
    seed();
    const items = await listMySavedJobs(ctx());
    expect(items.map((item) => [item.kind, item.id])).toEqual([
      ["tracked", "t1"],
      ["favorite", BOARD_JOB_ID],
      ["tracked", "t2"],
    ]);
    expect(mock.callsFor("tracked_applications")[0].chain).toContainEqual({ method: "eq", args: ["status", "saved"] });
    expect(mock.callsFor("user_favorites")[0].chain).toContainEqual({ method: "eq", args: ["user_id", TRACKER_USER_ID] });
  });

  it("searches both kinds", async () => {
    seed();
    expect((await listMySavedJobs(ctx(), { q: "globex" })).map((item) => item.id)).toEqual([BOARD_JOB_ID]);
    seed();
    expect((await listMySavedJobs(ctx(), { q: "hooli" })).map((item) => item.id)).toEqual(["t2"]);
  });
});
