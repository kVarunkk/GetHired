import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { BOARD_JOB_ID, TRACKER_USER_ID, boardJob, trackedRow } from "@/test/utils/tracker";
import { EXTERNAL_JOB_NOT_FOUND, PLATFORM_JOB_REFUSED } from "@/helpers/applications/external-application";
import { TRACKER_COPY } from "@/helpers/tracker/copy";
import { removeExternalApplicationAction } from "./remove-external-application";
import { setExternalApplicationStatusAction } from "./set-external-application-status";
import { trackExternalApplicationAction } from "./track-external-application";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/tracker/board-match", () => ({ findBoardJobIdByUrl: vi.fn(async () => null) }));

const TRACKED_ID = "10000000-0000-4000-8000-000000000077";
const LEGACY_ID = "20000000-0000-4000-8000-000000000077";
let mock: SupabaseMock;

const writesTo = (table: string) =>
  mock.callsFor(table).filter((call) => call.chain.some((c) => ["insert", "update", "upsert", "delete"].includes(c.method)));
const methodOf = (table: string, method: string) =>
  mock
    .callsFor(table)
    .flatMap((call) => call.chain)
    .find((c) => c.method === method);

/** `loadExternalJob`'s read. */
const queueExternalJob = (overrides: { is_platform_job?: boolean } = {}) =>
  mock.queue("all_jobs", { data: { id: BOARD_JOB_ID, is_platform_job: false, ...overrides }, error: null });

beforeEach(async () => {
  mock = createSupabaseMock();
  await setRequestUser(mockUser({ id: TRACKER_USER_ID }), mock.client);
});

describe.each([
  ["trackExternalApplicationAction", () => trackExternalApplicationAction({ allJobsId: BOARD_JOB_ID })],
  ["setExternalApplicationStatusAction", () => setExternalApplicationStatusAction({ allJobsId: BOARD_JOB_ID, status: "rejected" })],
  ["removeExternalApplicationAction", () => removeExternalApplicationAction({ allJobsId: BOARD_JOB_ID })],
])("%s keeps its refusals", (_, call) => {
  it("signed out", async () => {
    await setRequestUser(null);
    expect(await call()).toEqual({ ok: false, error: "Sign in first." });
  });

  it("an unknown job", async () => {
    mock.queue("all_jobs", { data: null, error: null });
    expect(await call()).toEqual({ ok: false, error: EXTERNAL_JOB_NOT_FOUND });
  });

  it("a GetHired job", async () => {
    queueExternalJob({ is_platform_job: true });
    expect(await call()).toEqual({ ok: false, error: PLATFORM_JOB_REFUSED });
    expect(mock.callsFor("tracked_applications")).toHaveLength(0);
  });

  it("a company user", async () => {
    await setRequestUser(mockUser({ type: "company" }), mock.client);
    expect(await call()).toEqual({ ok: false, error: TRACKER_COPY.applicantsOnly });
  });
});

describe("trackExternalApplicationAction", () => {
  it("refuses input that isn't just a job id", async () => {
    expect(await trackExternalApplicationAction({ allJobsId: BOARD_JOB_ID, status: "x" } as never)).toEqual({
      ok: false,
      error: "Job not found.",
    });
  });

  it("adds a tracker card from the board prompt, never an applications row", async () => {
    queueExternalJob();
    mock.queue("all_jobs", { data: boardJob(), error: null });
    mock.queue("applications", { data: null, error: null }); // applied through GetHired?
    mock.queue("applications", { data: null, error: null }); // a legacy row?
    mock.queue("tracked_applications", { data: null, error: null }); // exists?
    mock.queue("tracked_applications", { data: { id: TRACKED_ID, status: "applied" }, error: null });

    expect(await trackExternalApplicationAction({ allJobsId: BOARD_JOB_ID })).toEqual({ ok: true });
    expect(methodOf("tracked_applications", "insert")?.args[0]).toMatchObject({
      user_id: TRACKER_USER_ID,
      all_jobs_id: BOARD_JOB_ID,
      status: "applied",
      source: "board_prompt",
      job_title: "Backend Engineer",
      company_name: "Globex",
    });
    expect(writesTo("applications")).toHaveLength(0);
  });

  it("is ok when the job is already tracked", async () => {
    queueExternalJob();
    mock.queue("all_jobs", { data: boardJob(), error: null });
    mock.queue("applications", { data: null, error: null });
    mock.queue("applications", { data: null, error: null });
    mock.queue("tracked_applications", { data: { id: TRACKED_ID, status: "in_review", all_jobs_id: BOARD_JOB_ID }, error: null });

    expect(await trackExternalApplicationAction({ allJobsId: BOARD_JOB_ID })).toEqual({ ok: true });
    expect(methodOf("tracked_applications", "insert")).toBeUndefined();
  });
});

describe("setExternalApplicationStatusAction", () => {
  it("moves the tracked card, mapping an old status", async () => {
    queueExternalJob();
    mock.queue("tracked_applications", { data: { id: TRACKED_ID }, error: null });
    mock.queue("tracked_applications", { data: trackedRow({ id: TRACKED_ID, status: "offer" }), error: null });

    expect(await setExternalApplicationStatusAction({ allJobsId: BOARD_JOB_ID, status: "selected" })).toEqual({ ok: true });
    expect(methodOf("tracked_applications", "update")?.args[0]).toEqual({ status: "offer" });
    expect(writesTo("applications")).toHaveLength(0);
  });

  it("takes a tracked status", async () => {
    queueExternalJob();
    mock.queue("tracked_applications", { data: { id: TRACKED_ID }, error: null });
    mock.queue("tracked_applications", { data: trackedRow({ id: TRACKED_ID, status: "ghosted" }), error: null });

    expect(await setExternalApplicationStatusAction({ allJobsId: BOARD_JOB_ID, status: "ghosted" })).toEqual({ ok: true });
    expect(methodOf("tracked_applications", "update")?.args[0]).toEqual({ status: "ghosted" });
  });

  it("refuses saved and unknown statuses", async () => {
    for (const status of ["saved", "hired"]) {
      expect(await setExternalApplicationStatusAction({ allJobsId: BOARD_JOB_ID, status: status as never })).toEqual({
        ok: false,
        error: "Invalid status.",
      });
    }
  });

  it("copies a legacy row into the tracker before changing it", async () => {
    queueExternalJob();
    mock.queue("tracked_applications", { data: null, error: null }); // no card
    mock.queue("applications", {
      data: { id: LEGACY_ID, status: "reviewed", created_at: "2026-10-01T09:00:00Z", all_jobs: boardJob() },
      error: null,
    });
    mock.queue("tracked_applications", { data: { id: TRACKED_ID }, error: null }); // the copy
    mock.queue("tracked_applications", { data: trackedRow({ id: TRACKED_ID, status: "rejected" }), error: null });

    expect(await setExternalApplicationStatusAction({ allJobsId: BOARD_JOB_ID, status: "rejected" })).toEqual({ ok: true });
    expect(methodOf("tracked_applications", "insert")?.args[0]).toMatchObject({
      status: "in_review",
      applied_at: "2026-10-01",
      source: "migrated",
    });
    expect(methodOf("tracked_applications", "update")?.args[0]).toEqual({ status: "rejected" });
    // The only change to applications is deleting the copied row.
    expect(writesTo("applications").map((call) => call.chain.find((c) => c.method === "delete"))).toHaveLength(1);
    expect(methodOf("applications", "update")).toBeUndefined();
  });

  it("is not found with neither", async () => {
    queueExternalJob();
    mock.queue("tracked_applications", { data: null, error: null });
    mock.queue("applications", { data: null, error: null });
    expect(await setExternalApplicationStatusAction({ allJobsId: BOARD_JOB_ID, status: "rejected" })).toEqual({
      ok: false,
      error: TRACKER_COPY.notFound,
    });
  });
});

describe("removeExternalApplicationAction", () => {
  it("deletes the tracked card for the session user", async () => {
    queueExternalJob();
    mock.queue("tracked_applications", { data: { id: TRACKED_ID }, error: null });
    mock.queue("tracked_applications", { data: [{ id: TRACKED_ID }], error: null });

    expect(await removeExternalApplicationAction({ allJobsId: BOARD_JOB_ID })).toEqual({ ok: true });
    const del = mock.callsFor("tracked_applications").at(-1)!.chain;
    expect(del).toContainEqual({ method: "delete", args: [] });
    expect(del).toContainEqual({ method: "eq", args: ["user_id", TRACKER_USER_ID] });
  });

  it("removes a legacy row through the tracker", async () => {
    queueExternalJob();
    mock.queue("tracked_applications", { data: null, error: null });
    mock.queue("applications", {
      data: { id: LEGACY_ID, status: "submitted", created_at: "2026-10-01T09:00:00Z", all_jobs: boardJob() },
      error: null,
    });
    mock.queue("tracked_applications", { data: { id: TRACKED_ID }, error: null });
    mock.queue("tracked_applications", { data: [{ id: TRACKED_ID }], error: null });

    expect(await removeExternalApplicationAction({ allJobsId: BOARD_JOB_ID })).toEqual({ ok: true });
  });

  it("is not found with neither", async () => {
    queueExternalJob();
    mock.queue("tracked_applications", { data: null, error: null });
    mock.queue("applications", { data: null, error: null });
    expect(await removeExternalApplicationAction({ allJobsId: BOARD_JOB_ID })).toEqual({ ok: false, error: TRACKER_COPY.notFound });
  });
});
