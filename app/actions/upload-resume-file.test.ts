import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { resumeFromUpload } from "@/helpers/resumes/resume-from-upload";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { uploadResumeAction } from "./upload-resume-file";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/resumes/resume-from-upload", () => ({ resumeFromUpload: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));

const USER = { id: "00000000-0000-4000-8000-000000000001" };
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

let db: SupabaseMock;

function form(fields: { file?: File; replaceResumeId?: string } = {}) {
  const data = new FormData();
  if (fields.file) data.append("file", fields.file);
  if (fields.replaceResumeId) data.append("replaceResumeId", fields.replaceResumeId);
  return data;
}

const pdf = () => new File([new Uint8Array(10)], "cv.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: USER });
  vi.mocked(createClient).mockResolvedValue(db.client);
  vi.mocked(resumeFromUpload).mockResolvedValue({ ok: true, resumeId: "r1" });
});

describe("uploadResumeAction", () => {
  it("returns the saved resume once it's parsed", async () => {
    expect(await uploadResumeAction(form({ file: pdf() }))).toEqual({ success: true, resumeId: "r1" });
    expect(resumeFromUpload).toHaveBeenCalledWith(db.client, expect.objectContaining({ id: USER.id }), expect.any(File), {});
    expect(revalidatePath).toHaveBeenCalledWith("/resume");
  });

  it("needs a session", async () => {
    db.setUser(null);
    expect(await uploadResumeAction(form({ file: pdf() }))).toEqual({ error: "Authentication required." });
    expect(resumeFromUpload).not.toHaveBeenCalled();
  });

  it("needs a file", async () => {
    expect(await uploadResumeAction(form())).toEqual({ error: "Missing required upload data." });
  });

  it("passes on a resume to replace", async () => {
    await uploadResumeAction(form({ file: pdf(), replaceResumeId: RESUME_ID }));
    expect(vi.mocked(resumeFromUpload).mock.calls[0][3]).toEqual({ replaceResumeId: RESUME_ID });
  });

  it("refuses a malformed resume to replace", async () => {
    expect(await uploadResumeAction(form({ file: pdf(), replaceResumeId: "x" }))).toEqual({
      error: "Missing required upload data.",
    });
    expect(resumeFromUpload).not.toHaveBeenCalled();
  });

  it("returns the helper's error", async () => {
    vi.mocked(resumeFromUpload).mockResolvedValue({ ok: false, error: "We couldn't read this file." });
    expect(await uploadResumeAction(form({ file: pdf() }))).toEqual({ error: "We couldn't read this file." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports an unexpected failure and hides its detail", async () => {
    vi.mocked(resumeFromUpload).mockRejectedValue(new Error("db password is hunter2"));

    expect(await uploadResumeAction(form({ file: pdf() }))).toEqual({
      error: "We couldn't save this resume. Please try again.",
    });
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: USER.id, properties: { flow: "upload_resume_file" } }),
    );
  });
});
