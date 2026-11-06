import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { renderResumeDocx } from "@/helpers/resume/render/docx";
import { renderResumePdf } from "@/helpers/resume/render/pdf";
import { upgradeResumeFromFile } from "@/helpers/resumes/upgrade-resume";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { flushAfter } from "@/test/utils/after";
import { mockUser } from "@/test/utils/auth";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { PostHogEvent } from "@/utils/types";
import { GET } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/resumes/upgrade-resume", () => ({ upgradeResumeFromFile: vi.fn() }));
vi.mock("@/helpers/resume/render/docx", () => ({ renderResumeDocx: vi.fn() }));
vi.mock("@/helpers/resume/render/pdf", async () => {
  class ResumePdfCharactersError extends Error {}
  return { ResumePdfCharactersError, renderResumePdf: vi.fn() };
});

const RESUME_ID = "22222222-2222-4222-8222-222222222222";
const USER = mockUser();

const ROW = {
  id: RESUME_ID,
  name: "Backend",
  content: { version: 2, sections: [{ id: "s", type: "skills", items: [{ id: "i", heading: "Go", bullets: [] }] }] },
  contact: { fullName: "Ada", links: [] },
  template: "compact",
  revision: 2,
  schema_version: 2,
  resume_path: null,
};

let db: SupabaseMock;

const get = (format: string | null = "pdf", id = RESUME_ID) =>
  GET(buildRequest(`/api/resumes/${id}/export`, { searchParams: format ? { format } : {} }), {
    params: Promise.resolve({ resume_id: id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createClient).mockResolvedValue(db.client);
  vi.mocked(getUserFromRequest).mockResolvedValue(USER);
  vi.mocked(renderResumePdf).mockResolvedValue(new Uint8Array([1, 2, 3]));
  vi.mocked(renderResumeDocx).mockResolvedValue(new Uint8Array([4, 5]));
});

describe("GET /api/resumes/[resume_id]/export (RE-REQ-050)", () => {
  it("401s without a user", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(null);

    expect((await get()).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it.each([["doc"], [null]])("400s for the format %s", async (format) => {
    expect((await get(format)).status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it("404s for a bad id", async () => {
    expect((await get("pdf", "nope")).status).toBe(404);
  });

  it("404s for another user's resume", async () => {
    db.queue("resumes", { data: null, error: null });

    expect((await get()).status).toBe(404);
    expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER.id] });
    expect(renderResumePdf).not.toHaveBeenCalled();
  });

  it("returns a PDF named after the resume", async () => {
    db.queue("resumes", { data: ROW, error: null });

    const response = await get("pdf");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Backend.pdf"');
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(vi.mocked(renderResumePdf).mock.calls[0][0]).toMatchObject({ template: "compact", name: "Ada" });
  });

  it("returns a Word file", async () => {
    db.queue("resumes", { data: ROW, error: null });

    const response = await get("docx");

    expect(response.headers.get("content-type")).toContain("wordprocessingml");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Backend.docx"');
  });

  it.each([
    ['evil"\r\nX-Injected: 1/../name', 'attachment; filename="evilX-Injected 1..name.pdf"'],
    ["../../etc/passwd", 'attachment; filename="etcpasswd.pdf"'],
    ["रेज़्यूमे", 'attachment; filename="resume.pdf"'],
    [null, 'attachment; filename="resume.pdf"'],
  ])("removes unsafe characters from the name %j", async (name, header) => {
    db.queue("resumes", { data: { ...ROW, name }, error: null });

    expect((await get()).headers.get("content-disposition")).toBe(header);
  });

  describe("a version 1 resume (RE-REQ-095)", () => {
    const V1 = { ...ROW, schema_version: 1, resume_path: "resumes/u/cv.pdf" };

    it("upgrades first, and exports the result", async () => {
      db.queue("resumes", { data: V1, error: null });
      db.queue("resumes", { data: { ...ROW, name: "Upgraded" }, error: null });
      vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: true, upgraded: true, coverage: 1 });

      const response = await get();

      expect(upgradeResumeFromFile).toHaveBeenCalledWith(V1);
      expect(response.headers.get("content-disposition")).toContain("Upgraded.pdf");
    });

    it("409s when the upgrade fails", async () => {
      db.queue("resumes", { data: V1, error: null });
      vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: false, error: "Upload it again." });

      const response = await get();

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Upload it again." });
    });
  });

  it("409s for a resume with nothing in it", async () => {
    db.queue("resumes", { data: { ...ROW, content: null }, error: null });

    expect((await get()).status).toBe(409);
    expect(renderResumePdf).not.toHaveBeenCalled();
  });

  it("works with no contact", async () => {
    db.queue("resumes", { data: { ...ROW, contact: null }, error: null });

    expect((await get()).status).toBe(200);
  });

  it("explains a PDF the fonts can't draw, so the user can pick Word", async () => {
    const { ResumePdfCharactersError } = await import("@/helpers/resume/render/pdf");
    db.queue("resumes", { data: ROW, error: null });
    vi.mocked(renderResumePdf).mockRejectedValue(new (ResumePdfCharactersError as unknown as new (m: string) => Error)("Download Word."));

    const response = await get();

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Download Word." });
  });

  it("500s without detail when rendering breaks", async () => {
    db.queue("resumes", { data: ROW, error: null });
    vi.mocked(renderResumePdf).mockRejectedValue(new Error("secret"));

    const response = await get();

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("records resume_exported, with no resume text", async () => {
    db.queue("resumes", { data: ROW, error: null });

    await get("docx");
    await flushAfter();

    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.ResumeExported,
      distinctId: USER.id,
      properties: { format: "docx", template: "compact", surface: "page" },
    });
  });
});
