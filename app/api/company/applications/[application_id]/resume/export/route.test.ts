import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { loadApplicationFrame } from "@/helpers/applications/application-page";
import { renderResumePdf, ResumePdfCharactersError } from "@/helpers/resume/render/pdf";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { GET } from "./route";

vi.mock("@/helpers/applications/application-page", () => ({ loadApplicationFrame: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/resume/render/docx", () => ({ renderResumeDocx: vi.fn(async () => new Uint8Array([2])) }));
vi.mock("@/helpers/resume/render/pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/resume/render/pdf")>()),
  renderResumePdf: vi.fn(),
}));

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = { name: "Backend – Stripe", template: "classic", content: { version: 2, sections: [] } };

let db: SupabaseMock;

const call = (format = "pdf") =>
  GET(new NextRequest(`http://test/api?format=${format}`), { params: Promise.resolve({ application_id: APPLICATION_ID }) });

const frame = (person: Record<string, unknown>) =>
  vi.mocked(loadApplicationFrame).mockResolvedValue({ supabase: db.client, person } as never);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(renderResumePdf).mockResolvedValue(new Uint8Array([1]) as never);
});

describe("GET /api/company/applications/[id]/resume/export (RE-REQ-063)", () => {
  it("serves the snapshot, named for the person", async () => {
    frame({ kind: "user", name: "Ada Lovelace" });
    db.queue("applications", {
      data: { resume_snapshot: SNAPSHOT, resume_contact_snapshot: { fullName: "Ada Lovelace", links: [] } },
      error: null,
    });

    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain('filename="Ada Lovelace.pdf"');
    expect(vi.mocked(renderResumePdf).mock.calls[0][0]).toMatchObject({ name: "Ada Lovelace" });
  });

  it("is 404 for another company's application, which the frame can't load", async () => {
    vi.mocked(loadApplicationFrame).mockResolvedValue(null);

    expect((await call()).status).toBe(404);
    expect(db.calls).toHaveLength(0);
  });

  it("has no export for an imported candidate", async () => {
    frame({ kind: "candidate", name: "Imported" });

    expect((await call()).status).toBe(404);
    expect(db.calls).toHaveLength(0);
  });

  it("is 404 for an application with no snapshot", async () => {
    frame({ kind: "user", name: "Ada" });
    db.queue("applications", { data: { resume_snapshot: null }, error: null });

    expect((await call()).status).toBe(404);
  });

  it("refuses a bad format", async () => {
    expect((await call("exe")).status).toBe(400);
    expect(loadApplicationFrame).not.toHaveBeenCalled();
  });

  it("explains a PDF the fonts can't draw", async () => {
    frame({ kind: "user", name: "Ada" });
    db.queue("applications", { data: { resume_snapshot: SNAPSHOT }, error: null });
    vi.mocked(renderResumePdf).mockRejectedValue(new ResumePdfCharactersError(["字"]));

    expect((await call()).status).toBe(422);
  });
});
