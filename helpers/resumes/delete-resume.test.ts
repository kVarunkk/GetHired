import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { LAST_RESUME_ERROR, deleteResume } from "./delete-resume";

vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/user/update-user-embedding", () => ({ updateUserEmbedding: vi.fn() }));

const USER = { id: "00000000-0000-4000-8000-000000000001" };

let db: SupabaseMock;

const seed = (resumes: { id: string; is_primary: boolean }[], reviews = 0) => {
  db.queue("resumes", { data: resumes, error: null });
  db.queue("resume_reviews", { data: null, error: null, count: reviews });
  db.queue("resumes", { data: [{ id: "r1" }], error: null });
};

const steps = () => db.callsFor("resumes").flatMap((call) => call.chain);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(updateUserEmbedding).mockResolvedValue({ success: true } as never);
});

describe("deleteResume (RE-REQ-037)", () => {
  it("deletes the user's resume and says how many reviews went with it", async () => {
    seed(
      [
        { id: "r2", is_primary: true },
        { id: "r1", is_primary: false },
      ],
      3,
    );

    expect(await deleteResume(db.client, USER, { resumeId: "r1" })).toEqual({ ok: true, reviewsDeleted: 3 });

    const deleteCall = db.callsFor("resumes")[1];
    expect(deleteCall.chain).toContainEqual({ method: "eq", args: ["id", "r1"] });
    expect(deleteCall.chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
  });

  it("refuses the last resume", async () => {
    db.queue("resumes", { data: [{ id: "r1", is_primary: true }], error: null });

    expect(await deleteResume(db.client, USER, { resumeId: "r1" })).toEqual({ ok: false, error: LAST_RESUME_ERROR });
    expect(steps().some((step) => step.method === "delete")).toBe(false);
  });

  it("finds nothing for another user's id", async () => {
    db.queue("resumes", { data: [{ id: "r1", is_primary: true }, { id: "r2", is_primary: false }], error: null });

    expect(await deleteResume(db.client, USER, { resumeId: "other" })).toEqual({ ok: false, error: "Resume not found." });
    expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
    expect(steps().some((step) => step.method === "delete")).toBe(false);
  });

  it("promotes the most recently updated resume when the primary goes, and re-embeds", async () => {
    seed([
      { id: "newest", is_primary: false },
      { id: "r1", is_primary: true },
      { id: "oldest", is_primary: false },
    ]);

    await deleteResume(db.client, USER, { resumeId: "r1" });

    expect(db.callsFor("resumes")[0].chain).toContainEqual({
      method: "order",
      args: ["updated_at", { ascending: false, nullsFirst: false }],
    });
    const promote = db.callsFor("resumes")[2];
    expect(promote.chain).toContainEqual({ method: "update", args: [{ is_primary: true }] });
    expect(promote.chain).toContainEqual({ method: "eq", args: ["id", "newest"] });
    expect(promote.chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });

    expect(updateUserEmbedding).not.toHaveBeenCalled();
    await flushAfter();
    expect(updateUserEmbedding).toHaveBeenCalledWith(USER.id);
  });

  it("changes nothing else when the resume isn't primary", async () => {
    seed([
      { id: "r2", is_primary: true },
      { id: "r1", is_primary: false },
    ]);

    await deleteResume(db.client, USER, { resumeId: "r1" });
    await flushAfter();

    expect(steps().some((step) => step.method === "update")).toBe(false);
    expect(updateUserEmbedding).not.toHaveBeenCalled();
  });

  it("never touches a stored file", async () => {
    const storage = vi.fn();
    Object.assign(db.client, { storage: { from: storage } });
    seed([
      { id: "r2", is_primary: true },
      { id: "r1", is_primary: false },
    ]);

    await deleteResume(db.client, USER, { resumeId: "r1" });

    expect(storage).not.toHaveBeenCalled();
  });

  it("reports a resume that went in the meantime", async () => {
    db.queue("resumes", { data: [{ id: "r1", is_primary: true }, { id: "r2", is_primary: false }], error: null });
    db.queue("resume_reviews", { data: null, error: null, count: 0 });
    db.queue("resumes", { data: [], error: null });

    expect(await deleteResume(db.client, USER, { resumeId: "r1" })).toEqual({ ok: false, error: "Resume not found." });
    expect(steps().some((step) => step.method === "update")).toBe(false);
  });
});
