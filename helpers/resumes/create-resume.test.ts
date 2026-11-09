import { beforeEach, describe, expect, it } from "vitest";
import { RESUME_BLANK_SECTIONS, RESUME_MAX_PER_USER } from "@/helpers/resume/config";
import type { ResumeContent } from "@/helpers/resume/resume-schema";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { RESUME_DEFAULT_NAME, createResume } from "./create-resume";
import { RESUME_LIMIT_ERROR } from "./resume-limit";

const USER = { id: "00000000-0000-4000-8000-000000000001" };

const PROFILE = {
  full_name: "Ada Lovelace",
  email: "ada@example.com",
  linkedin_url: "linkedin.com/in/ada",
  github_url: "javascript:alert(1)",
};

let db: SupabaseMock;

const seed = (profile: unknown = PROFILE, count = 1) => {
  db.queue("resumes", { data: null, error: null, count });
  db.queue("user_info", { data: profile, error: null });
  db.queue("resumes", { data: { id: "r1" }, error: null });
};

const inserted = () =>
  db
    .callsFor("resumes")
    .flatMap((call) => call.chain)
    .find((step) => step.method === "insert")?.args[0] as Record<string, unknown> & {
    content: ResumeContent;
    contact: { fullName: string; email?: string; links: { label: string; url: string }[] };
  };

beforeEach(() => {
  db = createSupabaseMock();
});

describe("createResume (RE-REQ-035)", () => {
  it("starts from the blank sections, with new ids", async () => {
    seed();

    expect(await createResume(db.client, USER)).toEqual({ ok: true, resumeId: "r1" });

    expect(inserted().content.sections.map((s) => s.type)).toEqual(RESUME_BLANK_SECTIONS);
    expect(inserted().content.sections.every((s) => s.items.length === 0)).toBe(true);
    expect(new Set(inserted().content.sections.map((s) => s.id)).size).toBe(RESUME_BLANK_SECTIONS.length);
    expect(inserted()).toMatchObject({ user_id: USER.id, schema_version: 2, is_primary: false, name: RESUME_DEFAULT_NAME });
  });

  it("fills contact from user_info, keeping only safe links", async () => {
    seed();
    await createResume(db.client, USER);

    expect(inserted().contact).toEqual({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      links: [{ label: "LinkedIn", url: "https://linkedin.com/in/ada" }],
    });
  });

  it("works with no profile, or one the resume can't hold", async () => {
    seed(null);
    expect(await createResume(db.client, USER)).toMatchObject({ ok: true });
    expect(inserted().contact).toEqual({ fullName: "", links: [] });

    db = createSupabaseMock();
    seed({ ...PROFILE, email: "not an email" });
    expect(await createResume(db.client, USER)).toMatchObject({ ok: true });
    expect(inserted().contact).toEqual({ fullName: "", links: [] });
  });

  it("uses a given name", async () => {
    seed();
    await createResume(db.client, USER, { name: "  Backend  " });
    expect(inserted().name).toBe("Backend");
  });

  it("uses given content, once it's valid", async () => {
    seed();
    const content: ResumeContent = { version: 2, sections: [{ id: "s1", type: "skills", items: [] }] };

    await createResume(db.client, USER, { content });

    expect(inserted().content).toEqual(content);
  });

  it("refuses invalid content, touching nothing", async () => {
    const content = { version: 2, sections: [{ id: "s1", type: "other", items: [] }] } as ResumeContent;

    expect(await createResume(db.client, USER, { content })).toMatchObject({ ok: false });
    expect(db.calls).toHaveLength(0);
  });

  it("refuses at the limit", async () => {
    db.queue("resumes", { data: null, error: null, count: RESUME_MAX_PER_USER });

    expect(await createResume(db.client, USER)).toEqual({ ok: false, error: RESUME_LIMIT_ERROR });
    expect(inserted()).toBeUndefined();
  });

  it("reports a failed insert", async () => {
    db.queue("resumes", { data: null, error: null, count: 1 });
    db.queue("user_info", { data: PROFILE, error: null });
    db.queue("resumes", { data: null, error: new Error("nope") });

    expect(await createResume(db.client, USER)).toMatchObject({ ok: false });
  });
});
