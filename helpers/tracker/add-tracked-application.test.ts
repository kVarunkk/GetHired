import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { BOARD_JOB_ID, TRACKER_USER_ID, boardJob, trackedRow } from "@/test/utils/tracker";
import { PLATFORM_JOB_REFUSED } from "@/helpers/applications/external-application";
import { findBoardJobIdByUrl } from "./board-match";
import { addTrackedApplication } from "./add-tracked-application";
import { trackedInputSchema, type TrackedInputRaw } from "./schema";
import { TRACKER_COPY } from "./copy";
import type { TrackerSource } from "./context";

vi.mock("./board-match", () => ({ findBoardJobIdByUrl: vi.fn() }));

let mock: SupabaseMock;
const ctx = () => ({ supabase: mock.client, user: { id: TRACKER_USER_ID } });
const add = (raw: TrackedInputRaw, source: TrackerSource = "manual") =>
  addTrackedApplication(ctx(), trackedInputSchema.parse(raw), source);

const free = { jobTitle: "Frontend Engineer", companyName: "Acme", jobUrl: "https://boards.greenhouse.io/acme/jobs/1?gh_src=x" };
const hasEq = (target: string, column: string, value: unknown, index = 0) =>
  expect(mock.callsFor(target)[index].chain).toContainEqual({ method: "eq", args: [column, value] });

beforeEach(() => {
  mock = createSupabaseMock();
  vi.mocked(findBoardJobIdByUrl).mockResolvedValue(null);
});

describe("addTrackedApplication: jobs from elsewhere", () => {
  it("inserts a card with the link's key and the source, as the ctx user", async () => {
    mock.queue("tracked_applications", { data: null, error: null }); // exists?
    mock.queue("tracked_applications", { data: { id: "t1", status: "applied" }, error: null });

    const result = await add({ ...free, user_id: "someone-else" } as TrackedInputRaw, "manual");

    expect(result).toEqual({ ok: true, kind: "tracked", created: true, moved: false, id: "t1", status: "applied" });
    const insert = mock.callsFor("tracked_applications")[1].chain.find((c) => c.method === "insert")!;
    expect(insert.args[0]).toMatchObject({
      user_id: TRACKER_USER_ID,
      all_jobs_id: null,
      job_title: "Frontend Engineer",
      company_name: "Acme",
      job_url: "https://boards.greenhouse.io/acme/jobs/1?gh_src=x",
      job_url_key: "boards.greenhouse.io/acme/jobs/1",
      status: "applied",
      source: "manual",
    });
    hasEq("tracked_applications", "user_id", TRACKER_USER_ID);
    expect(mock.callsFor("all_jobs")).toHaveLength(0);
  });

  it("keeps the description of a job from elsewhere", async () => {
    mock.queue("tracked_applications", { data: null, error: null });
    mock.queue("tracked_applications", { data: { id: "t1", status: "applied" }, error: null });
    await add({ ...free, jobDescription: "  Build things.  " } as TrackedInputRaw, "manual");
    const insert = mock.callsFor("tracked_applications")[1].chain.find((c) => c.method === "insert")!;
    expect(insert.args[0]).toMatchObject({ job_description: "Build things." });
  });

  it("returns the existing card for the same link", async () => {
    mock.queue("tracked_applications", { data: { id: "t9", status: "interviewing", all_jobs_id: null }, error: null });

    expect(await add(free)).toEqual({ ok: true, kind: "tracked", created: false, moved: false, id: "t9", status: "interviewing" });
    expect(mock.callsFor("tracked_applications")).toHaveLength(1);
    expect(mock.callsFor("tracked_applications")[0].chain).toContainEqual({
      method: "or",
      args: ['job_url_key.eq."boards.greenhouse.io/acme/jobs/1"'],
    });
  });

  it("moves a saved card when the job is added as applied", async () => {
    mock.queue("tracked_applications", { data: { id: "t2", status: "saved", all_jobs_id: null }, error: null });
    mock.queue("tracked_applications", { data: { id: "t2", status: "applied" }, error: null });

    expect(await add({ ...free, status: "applied", appliedAt: "2026-11-20" })).toEqual({
      ok: true,
      kind: "tracked",
      created: false,
      moved: true,
      id: "t2",
      status: "applied",
    });
    const update = mock.callsFor("tracked_applications")[1];
    expect(update.chain).toContainEqual({ method: "update", args: [{ status: "applied", applied_at: "2026-11-20" }] });
    hasEq("tracked_applications", "id", "t2", 1);
    hasEq("tracked_applications", "user_id", TRACKER_USER_ID, 1);
  });

  it("doesn't move an applied card back when it's saved again", async () => {
    mock.queue("tracked_applications", { data: { id: "t3", status: "applied", all_jobs_id: null }, error: null });

    expect(await add({ ...free, status: "saved" })).toMatchObject({ ok: true, created: false, moved: false, status: "applied" });
    expect(mock.callsFor("tracked_applications")).toHaveLength(1);
  });

  it("saves a job from elsewhere as a saved card with no applied date", async () => {
    mock.queue("tracked_applications", { data: null, error: null });
    mock.queue("tracked_applications", { data: { id: "t4", status: "saved" }, error: null });

    expect(await add({ ...free, status: "saved", appliedAt: "2026-11-20" })).toMatchObject({ ok: true, created: true, status: "saved" });
    const insert = mock.callsFor("tracked_applications")[1].chain.find((c) => c.method === "insert")!;
    expect(insert.args[0]).toMatchObject({ status: "saved", applied_at: null, all_jobs_id: null });
  });

  it("returns the card that won a unique-violation race", async () => {
    mock.queue("tracked_applications", { data: null, error: null });
    mock.queue("tracked_applications", { data: null, error: { code: "23505", message: "duplicate" } });
    mock.queue("tracked_applications", { data: { id: "t5", status: "applied", all_jobs_id: null }, error: null });

    expect(await add(free)).toMatchObject({ ok: true, created: false, id: "t5" });
  });

  it("maps the cap to copy", async () => {
    mock.queue("tracked_applications", { data: null, error: null });
    mock.queue("tracked_applications", { data: null, error: { code: "23514", message: "AT_MAX_TRACKED" } });

    expect(await add(free)).toEqual({ ok: false, reason: "limit", error: TRACKER_COPY.limit });
  });
});

describe("addTrackedApplication: board jobs", () => {
  it("takes the board job's own title and company for a matching link, whatever was typed", async () => {
    vi.mocked(findBoardJobIdByUrl).mockResolvedValue(BOARD_JOB_ID);
    mock.queue("all_jobs", { data: boardJob(), error: null });
    mock.queue("applications", { data: null, error: null }); // GetHired application?
    mock.queue("applications", { data: null, error: null }); // legacy row?
    mock.queue("tracked_applications", { data: null, error: null });
    mock.queue("tracked_applications", { data: { id: "t6", status: "applied" }, error: null });

    expect(await add(free)).toMatchObject({ ok: true, created: true, id: "t6" });
    const insert = mock.callsFor("tracked_applications")[1].chain.find((c) => c.method === "insert")!;
    expect(insert.args[0]).toMatchObject({ all_jobs_id: BOARD_JOB_ID, job_title: "Backend Engineer", company_name: "Globex" });
    expect(mock.callsFor("tracked_applications")[0].chain).toContainEqual({
      method: "or",
      args: [`all_jobs_id.eq.${BOARD_JOB_ID},job_url_key.eq."boards.greenhouse.io/acme/jobs/1"`],
    });
  });

  it("takes the title, company and first location from a board job by id", async () => {
    mock.queue("all_jobs", { data: boardJob(), error: null });
    mock.queue("applications", { data: null, error: null });
    mock.queue("applications", { data: null, error: null });
    mock.queue("tracked_applications", { data: null, error: null });
    mock.queue("tracked_applications", { data: { id: "t7", status: "applied" }, error: null });

    expect(await add({ allJobsId: BOARD_JOB_ID }, "board_prompt")).toMatchObject({ ok: true, created: true });
    const insert = mock.callsFor("tracked_applications")[1].chain.find((c) => c.method === "insert")!;
    expect(insert.args[0]).toMatchObject({
      all_jobs_id: BOARD_JOB_ID,
      job_title: "Backend Engineer",
      company_name: "Globex",
      location: "Bengaluru",
      source: "board_prompt",
    });
    // The order of checks (AT-REQ-031).
    expect(mock.calls.map((c) => c.target)).toEqual([
      "all_jobs",
      "applications",
      "applications",
      "tracked_applications",
      "tracked_applications",
    ]);
  });

  it("refuses a GetHired application and writes nothing", async () => {
    mock.queue("all_jobs", { data: boardJob({ is_platform_job: true }), error: null });
    mock.queue("applications", { data: { id: "app1" }, error: null });

    expect(await add({ allJobsId: BOARD_JOB_ID })).toEqual({
      ok: false,
      reason: "applied_on_gethired",
      applicationId: "app1",
      error: TRACKER_COPY.appliedOnGetHired,
    });
    expect(mock.callsFor("applications")[0].chain).toContainEqual({ method: "not", args: ["job_post_id", "is", null] });
    hasEq("applications", "applicant_user_id", TRACKER_USER_ID);
    expect(mock.callsFor("tracked_applications")).toHaveLength(0);
    expect(mock.callsFor("user_favorites")).toHaveLength(0);
  });

  it("saves a board job to favorites, with no tracked row (platform jobs too)", async () => {
    mock.queue("all_jobs", { data: boardJob({ is_platform_job: true }), error: null });
    mock.queue("applications", { data: null, error: null });
    mock.queue("user_favorites", { data: null, error: { code: "23505" } });

    expect(await add({ allJobsId: BOARD_JOB_ID, status: "saved" })).toEqual({ ok: true, kind: "favorite", allJobsId: BOARD_JOB_ID });
    expect(mock.callsFor("user_favorites")[0].chain).toContainEqual({
      method: "insert",
      args: [{ user_id: TRACKER_USER_ID, job_id: BOARD_JOB_ID }],
    });
    expect(mock.callsFor("tracked_applications")).toHaveLength(0);
  });

  it("refuses to track an Easy Apply job by hand, applied or not", async () => {
    mock.queue("all_jobs", { data: boardJob({ is_platform_job: true }), error: null });
    mock.queue("applications", { data: null, error: null });

    expect(await add({ allJobsId: BOARD_JOB_ID, status: "interviewing" })).toEqual({
      ok: false,
      reason: "platform_job",
      error: PLATFORM_JOB_REFUSED,
    });
    expect(mock.callsFor("tracked_applications")).toHaveLength(0);
  });

  it("says not found for an unknown board job", async () => {
    mock.queue("all_jobs", { data: null, error: null });
    expect(await add({ allJobsId: BOARD_JOB_ID })).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("adopts an old external applications row as the card", async () => {
    mock.queue("all_jobs", { data: boardJob(), error: null });
    mock.queue("applications", { data: null, error: null });
    mock.queue("applications", {
      data: { id: "legacy1", status: "reviewed", created_at: "2026-10-01T09:00:00Z", all_jobs: boardJob() },
      error: null,
    });
    mock.queue("tracked_applications", { data: { id: "t8" }, error: null }); // adopt insert
    mock.queue("applications", { data: null, error: null }); // legacy delete
    mock.queue("tracked_applications", {
      data: trackedRow({ id: "t8", status: "in_review", all_jobs_id: BOARD_JOB_ID }),
      error: null,
    });

    expect(await add({ allJobsId: BOARD_JOB_ID })).toMatchObject({ ok: true, created: false, id: "t8", status: "in_review" });
    const adopt = mock.callsFor("tracked_applications")[0].chain.find((c) => c.method === "insert")!;
    expect(adopt.args[0]).toMatchObject({ status: "in_review", applied_at: "2026-10-01", source: "migrated" });
    const del = mock.callsFor("applications")[2];
    expect(del.chain).toContainEqual({ method: "delete", args: [] });
    expect(del.chain).toContainEqual({ method: "eq", args: ["applicant_user_id", TRACKER_USER_ID] });
  });
});
