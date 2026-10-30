import { beforeEach, describe, expect, it, vi } from "vitest";
import { google } from "@ai-sdk/google";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mockGenerateModel } from "@/test/utils/ai";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { sendResumeParsingStatusEmail } from "@/app/actions/send-resume-status-email";
import { extractPdfLines } from "./extract-text";
import { parseResume } from "./parse-resume";

// BIT-041: the PDF extraction moved to extract-text.ts; parseResume keeps its behaviour.

vi.mock("@ai-sdk/google", () => ({ google: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/app/actions/send-resume-status-email", () => ({ sendResumeParsingStatusEmail: vi.fn() }));
vi.mock("../ai/deduct-user-credits", () => ({ deductUserCreditsHelper: vi.fn() }));
vi.mock("./extract-text", () => ({ extractPdfLines: vi.fn() }));

const SECTIONS = {
  sections: [{ type: "experience", items: [{ heading: "Acme", bullets: [{ text: "Built things", lineIndices: [1] }] }] }],
};

let db: SupabaseMock;
const createSignedUrl = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.test/r.pdf" }, error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue({
    ...db.client,
    from: db.client.from,
    storage: { from: () => ({ createSignedUrl }) },
  } as never);
  db.queue("resumes", { data: { resume_path: "u1/r.pdf", name: "CV", user_info: { email: "u@mail.test" } }, error: null });
});

describe("parseResume", () => {
  it("extracts the PDF's lines from a signed URL, saves the sections with bullet ids", async () => {
    vi.mocked(extractPdfLines).mockResolvedValue(["Ada", "Built things"]);
    vi.mocked(google).mockReturnValue(mockGenerateModel(JSON.stringify(SECTIONS)) as never);

    await parseResume("u1", "r1");

    expect(extractPdfLines).toHaveBeenCalledWith({ url: "https://storage.test/r.pdf" });
    const update = db.callsFor("resumes")[1].chain.find((c) => c.method === "update")!.args[0] as {
      content: { sections: { items: { bullets: { id: string }[] }[] }[] };
      parsing_failed: boolean;
    };
    expect(update.parsing_failed).toBe(false);
    expect(update.content.sections[0].items[0].bullets[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sendResumeParsingStatusEmail).toHaveBeenCalledWith("u@mail.test", "success", "CV", "r1", "u1");
  });

  it("marks the resume failed when the file has no text", async () => {
    vi.mocked(extractPdfLines).mockResolvedValue([]);

    await parseResume("u1", "r1");

    const update = db.callsFor("resumes")[1].chain.find((c) => c.method === "update")!.args[0];
    expect(update).toMatchObject({ content: null, parsing_failed: true });
    expect(google).not.toHaveBeenCalled();
    expect(sendResumeParsingStatusEmail).toHaveBeenCalledWith("u@mail.test", "failure", "CV", "r1", "u1");
  });
});
