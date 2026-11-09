import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { getResumeDetails } from "./get-resume-details";
import { upgradeResumeFromFile } from "./upgrade-resume";

vi.mock("./upgrade-resume", () => ({ upgradeResumeFromFile: vi.fn() }));

const USER = { id: "u1" };
const ROW = {
  id: "r1",
  name: "Backend",
  content: { version: 2, sections: [] },
  contact: { fullName: "Ada", email: "ada@example.com", links: [] },
  template: "classic",
  revision: 3,
  schema_version: 2,
  resume_path: "u1/file.pdf",
  created_at: "c",
  updated_at: "u",
  is_primary: true,
};

let db: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
});

describe("getResumeDetails", () => {
  it("limits the read to the user, and is null for no such resume", async () => {
    db.queue("resumes", { data: null, error: null });

    expect(await getResumeDetails(db.client, USER, "r1")).toBeNull();
    expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", "u1"] });
  });

  it("leaves contact details out by default (RE-REQ-005)", async () => {
    db.queue("resumes", { data: ROW, error: null });

    const resume = await getResumeDetails(db.client, USER, "r1");

    expect(JSON.stringify(resume)).not.toContain("ada@example.com");
  });

  it("gives the owner's tools the contact details and revision, and keeps the internals out", async () => {
    db.queue("resumes", { data: ROW, error: null });

    const resume = await getResumeDetails(db.client, USER, "r1", { forEditing: true });

    expect(resume).toMatchObject({ contact: ROW.contact, revision: 3 });
    expect(resume).not.toHaveProperty("schema_version");
    expect(resume).not.toHaveProperty("resume_path");
  });

  it("doesn't upgrade a version 1 resume for a plain read", async () => {
    db.queue("resumes", { data: { ...ROW, schema_version: 1 }, error: null });

    await getResumeDetails(db.client, USER, "r1");

    expect(upgradeResumeFromFile).not.toHaveBeenCalled();
  });

  it("upgrades a version 1 resume for editing and returns the new one, ids and revision included (RE-REQ-095)", async () => {
    vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: true, upgraded: true, coverage: 1 });
    db.queue("resumes", { data: { ...ROW, schema_version: 1 }, error: null });
    db.queue("resumes", { data: { ...ROW, revision: 4 }, error: null });

    const resume = await getResumeDetails(db.client, USER, "r1", { forEditing: true });

    expect(upgradeResumeFromFile).toHaveBeenCalledOnce();
    expect(resume).toMatchObject({ revision: 4 });
  });

  it("returns the stored resume when the upgrade fails", async () => {
    vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: false, error: "no" });
    db.queue("resumes", { data: { ...ROW, schema_version: 1 }, error: null });

    expect(await getResumeDetails(db.client, USER, "r1", { forEditing: true })).toMatchObject({ revision: 3 });
  });
});
