import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "./route";
import { buildRequest } from "@/test/utils/request";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { addTrackedApplication } from "@/helpers/tracker/add-tracked-application";
import { findBoardJobIdByUrl } from "@/helpers/tracker/board-match";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/tracker/add-tracked-application", () => ({ addTrackedApplication: vi.fn() }));
vi.mock("@/helpers/tracker/board-match", () => ({ findBoardJobIdByUrl: vi.fn() }));
vi.mock("@/helpers/tracker/session", () => ({ revalidateMyJobs: vi.fn() }));

const PATH = "/api/extension/track-application";
const JOB_URL = "https://boards.greenhouse.io/acme/jobs/1";
const ROW_ID = "10000000-0000-4000-8000-000000000001";
const BOARD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const body = { url: JOB_URL, title: "Engineer", company: "Acme", trigger: "submit" as const };

let supabase: SupabaseMock;

// The limiter is per user and lives in memory: each test gets its own user.
let userNumber = 0;
const newUser = (overrides: Parameters<typeof mockUser>[0] = {}) => {
  userNumber += 1;
  return mockUser({ id: `00000000-0000-4000-8000-${String(userNumber).padStart(12, "0")}`, ...overrides });
};

let user: ReturnType<typeof mockUser>;

beforeEach(async () => {
  vi.resetAllMocks();
  supabase = createSupabaseMock();
  user = newUser();
  await setRequestUser(user, supabase.client);
  vi.mocked(findBoardJobIdByUrl).mockResolvedValue(null);
  vi.mocked(addTrackedApplication).mockResolvedValue({ ok: true, kind: "tracked", created: true, moved: false, id: ROW_ID, status: "applied" });
});

const post = (payload: unknown = body) => POST(buildRequest(PATH, { method: "POST", body: payload }));

describe("POST /api/extension/track-application", () => {
  it("answers 401 without a session and 403 for a company", async () => {
    await setRequestUser(null);
    expect((await post()).status).toBe(401);

    await setRequestUser(newUser({ type: "company" }), supabase.client);
    expect((await post()).status).toBe(403);
    expect(addTrackedApplication).not.toHaveBeenCalled();
  });

  it("tracks with source extension, as the session user", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "created", id: ROW_ID });
    expect(addTrackedApplication).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: user.id } }),
      expect.objectContaining({ jobTitle: "Engineer", companyName: "Acme", jobUrl: JOB_URL, status: "applied" }),
      "extension",
    );
  });

  it("ignores status on a detected submit, and honours it on a manual track", async () => {
    await post({ ...body, status: "saved" });
    expect(vi.mocked(addTrackedApplication).mock.calls[0][1]).toMatchObject({ status: "applied" });

    await post({ ...body, trigger: "manual", status: "saved" });
    expect(vi.mocked(addTrackedApplication).mock.calls[1][1]).toMatchObject({ status: "saved" });
  });

  it("fills missing details from a board job, else answers missing_details", async () => {
    vi.mocked(findBoardJobIdByUrl).mockResolvedValueOnce(BOARD_ID);
    await post({ url: JOB_URL, trigger: "submit" });
    expect(vi.mocked(addTrackedApplication).mock.calls[0][1]).toMatchObject({ allJobsId: BOARD_ID });

    const response = await post({ url: JOB_URL, trigger: "submit" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "missing_details" });
  });

  it("maps each way adding can end", async () => {
    vi.mocked(addTrackedApplication).mockResolvedValueOnce({ ok: true, kind: "tracked", created: false, moved: true, id: ROW_ID, status: "applied" });
    expect((await (await post()).json()).status).toBe("moved");

    vi.mocked(addTrackedApplication).mockResolvedValueOnce({ ok: true, kind: "tracked", created: false, moved: false, id: ROW_ID, status: "applied" });
    expect((await (await post()).json()).status).toBe("exists");

    vi.mocked(addTrackedApplication).mockResolvedValueOnce({ ok: true, kind: "tracked", created: true, moved: false, id: ROW_ID, status: "saved" });
    expect((await (await post({ ...body, trigger: "manual", status: "saved" })).json()).status).toBe("saved");

    vi.mocked(addTrackedApplication).mockResolvedValueOnce({ ok: false, reason: "applied_on_gethired", applicationId: "g1", error: "x" });
    expect(await (await post()).json()).toMatchObject({ status: "applied_on_gethired", id: "g1" });
  });

  it("rejects a bad body and reads only url, title, company and location", async () => {
    expect((await post({ url: JOB_URL })).status).toBe(400);

    await post({ ...body, location: "Pune", answers: { q: "secret-answer" }, resume: "resume-text" });
    const input = JSON.stringify(vi.mocked(addTrackedApplication).mock.calls[0][1]);
    expect(input).not.toContain("secret-answer");
    expect(input).not.toContain("resume-text");
  });

  it("limits a user to 60 tracks an hour", async () => {
    for (let i = 0; i < 60; i += 1) expect((await post()).status).toBe(200);
    const response = await post();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("DELETE /api/extension/track-application", () => {
  const del = (id: string | null = ROW_ID) =>
    DELETE(buildRequest(PATH, { method: "DELETE", searchParams: id ? { id } : {} }));
  const row = (overrides = {}) => ({ id: ROW_ID, source: "extension", created_at: new Date().toISOString(), ...overrides });

  it("removes the user's own extension card from the last 10 minutes", async () => {
    supabase.queue("tracked_applications", { data: row(), error: null });
    supabase.queue("tracked_applications", { data: null, error: null });

    const response = await del();

    expect(await response.json()).toEqual({ removed: true, id: ROW_ID });
    expect(supabase.callsFor("tracked_applications")[0].chain).toContainEqual({ method: "eq", args: ["user_id", user.id] });
    expect(supabase.callsFor("tracked_applications")[1].chain).toContainEqual({ method: "eq", args: ["source", "extension"] });
  });

  it("refuses a card older than 11 minutes, or from another source", async () => {
    supabase.queue("tracked_applications", { data: row({ created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() }), error: null });
    expect((await del()).status).toBe(409);

    supabase.queue("tracked_applications", { data: row({ source: "manual" }), error: null });
    expect((await del()).status).toBe(409);
    expect(supabase.callsFor("tracked_applications")).toHaveLength(2);
  });

  it("answers 404 for another user's id, 400 for a bad id and 401 signed out", async () => {
    supabase.queue("tracked_applications", { data: null, error: null });
    expect((await del()).status).toBe(404);
    expect((await del("nope")).status).toBe(400);

    await setRequestUser(null);
    expect((await del()).status).toBe(401);
  });
});
