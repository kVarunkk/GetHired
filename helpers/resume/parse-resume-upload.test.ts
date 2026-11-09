import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { mockGenerateModel } from "@/test/utils/ai";
import { docxOf, pdfOf } from "@/test/utils/resume-files";
import { RESUME_UNUSED_LINE_WARNING } from "./config";
import { ResumeParseError, parseResumeUpload, resumeCoverage } from "./parse-resume";
import { ResumeContactSchema, ResumeContentSchema, type ResumeParseOutput } from "./resume-schema";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/app/actions/send-resume-status-email", () => ({ sendResumeParsingStatusEmail: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const LINES = ["Ada Lovelace", "ada@example.com", "Experience", "Engineer at Acme", "Built the engine"];

const PARSED: ResumeParseOutput = {
  contact: {
    fullName: { value: "Ada Lovelace", lineIndices: [0] },
    email: { value: "ada@example.com", lineIndices: [1] },
    links: [],
  },
  sections: [
    {
      type: "experience",
      lineIndices: [2],
      items: [
        {
          heading: "Engineer",
          subheading: "Acme",
          startDate: "Jan 2022",
          lineIndices: [3],
          bullets: [{ text: "Built the engine", lineIndices: [4] }],
        },
      ],
    },
  ],
};

const modelFor = (output: unknown = PARSED) => mockGenerateModel(JSON.stringify(output));
const promptOf = (model: MockLanguageModelV4) => JSON.stringify(model.doGenerateCalls[0].prompt);

beforeEach(() => vi.clearAllMocks());

describe("parseResumeUpload (RE-REQ-010)", () => {
  it("parses a PDF into valid contact and content", async () => {
    const result = await parseResumeUpload(pdfOf(LINES), { fileName: "cv.pdf", model: modelFor() });

    expect(result.fileType).toBe("pdf");
    expect(result.contact).toMatchObject({ fullName: "Ada Lovelace", email: "ada@example.com" });
    expect(ResumeContactSchema.safeParse(result.contact).success).toBe(true);
    expect(ResumeContentSchema.safeParse(result.content).success).toBe(true);
    expect(result.content.sections[0].items[0]).toMatchObject({ heading: "Engineer", startDate: "Jan 2022" });
    expect(result.content.sections[0].items[0].bullets[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("parses a DOCX, by its bytes, whatever the name", async () => {
    const result = await parseResumeUpload(await docxOf(LINES), { fileName: "cv.pdf", model: modelFor() });
    expect(result.fileType).toBe("docx");
    expect(result.content.sections).toHaveLength(1);
  });

  it("reads a PDF named .docx as a PDF", async () => {
    const result = await parseResumeUpload(pdfOf(LINES), { fileName: "cv.docx", model: modelFor() });
    expect(result.fileType).toBe("pdf");
  });

  it("refuses a .pdf that's really text, without calling the model", async () => {
    const model = modelFor();
    const bytes = new TextEncoder().encode("just some text");

    await expect(parseResumeUpload(bytes, { fileName: "cv.pdf", model })).rejects.toThrow("Upload a PDF or Word (.docx) file.");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("wraps the numbered lines in the sandbox", async () => {
    const model = modelFor();
    await parseResumeUpload(pdfOf(LINES), { fileName: "cv.pdf", model });

    const prompt = promptOf(model);
    expect(prompt).toContain("<source_lines>");
    expect(prompt).toContain("[1] ada@example.com");
    expect(prompt).toContain("</source_lines>");
  });

  it("asks for everything, in the original wording", async () => {
    const model = modelFor();
    await parseResumeUpload(pdfOf(LINES), { fileName: "cv.pdf", model });

    const system = model.doGenerateCalls[0].prompt.find((m) => m.role === "system")?.content as string;
    expect(system).toMatch(/contact/i);
    expect(system).toMatch(/lineIndices/);
    expect(system).not.toMatch(/ignore .*contact/i);
  });

  it("leaves no lineIndices in the result", async () => {
    const result = await parseResumeUpload(pdfOf(LINES), { fileName: "cv.pdf", model: modelFor() });
    expect(JSON.stringify({ contact: result.contact, content: result.content })).not.toContain("lineIndices");
  });

  it("sends the file itself when there are no lines (a scan)", async () => {
    const model = modelFor();
    const result = await parseResumeUpload(pdfOf([]), { fileName: "scan.pdf", model });

    expect(result.fallbackUsed).toBe(true);
    expect(result.coverage).toBeNull();
    expect(result.parseNotes).toBeNull();
    const user = model.doGenerateCalls[0].prompt.find((m) => m.role === "user")!;
    expect((user.content as { type: string }[]).some((part) => part.type === "file")).toBe(true);
  });

  it("says it can't read the file when that fails too", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("the provider said no");
      },
    });

    await expect(parseResumeUpload(pdfOf([]), { fileName: "scan.pdf", model })).rejects.toThrow("We couldn't read this file.");
  });

  it("says the same when the model finds nothing", async () => {
    const model = modelFor({ contact: { links: [] }, sections: [] });
    await expect(parseResumeUpload(pdfOf(LINES), { fileName: "cv.pdf", model })).rejects.toThrow("We couldn't read this file.");
  });

  it("never sends a Word file with no text to the model", async () => {
    const model = modelFor();
    await expect(parseResumeUpload(await docxOf([]), { fileName: "cv.docx", model })).rejects.toThrow("We couldn't read this file.");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("aborts a call that runs past the timeout", async () => {
    let signal: AbortSignal | undefined;
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        signal = options.abortSignal;
        await new Promise((_, reject) => options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal?.reason)));
        throw new Error("unreachable");
      },
    });

    await expect(parseResumeUpload(pdfOf(LINES), { fileName: "cv.pdf", model, timeoutMs: 5 })).rejects.toBeInstanceOf(ResumeParseError);
    expect(signal?.aborted).toBe(true);
  });

  it("makes links safe: adds https to a bare domain and drops other schemes", async () => {
    const result = await parseResumeUpload(pdfOf(LINES), {
      fileName: "cv.pdf",
      model: modelFor({
        ...PARSED,
        contact: {
          ...PARSED.contact,
          links: [
            { label: "LinkedIn", url: "linkedin.com/in/ada", lineIndices: [1] },
            { label: "Evil", url: "javascript:alert(1)", lineIndices: [1] },
          ],
        },
        sections: [
          {
            ...PARSED.sections[0],
            items: [{ ...PARSED.sections[0].items[0], url: "javascript:alert(1)" }],
          },
        ],
      }),
    });

    expect(result.contact.links).toEqual([{ label: "LinkedIn", url: "https://linkedin.com/in/ada" }]);
    expect(result.content.sections[0].items[0].url).toBeUndefined();
  });

  it("drops an email that isn't one, rather than failing the upload", async () => {
    const result = await parseResumeUpload(pdfOf(LINES), {
      fileName: "cv.pdf",
      model: modelFor({ ...PARSED, contact: { ...PARSED.contact, email: { value: "ada at example", lineIndices: [1] } } }),
    });
    expect(result.contact.email).toBeUndefined();
  });

  it("keeps a resume with fields over the limits, cut to fit", async () => {
    const result = await parseResumeUpload(pdfOf(LINES), {
      fileName: "cv.pdf",
      model: modelFor({
        ...PARSED,
        sections: [
          {
            type: "other",
            lineIndices: [2],
            items: [{ heading: "x".repeat(500), lineIndices: [3], bullets: [{ text: "y".repeat(3000), lineIndices: [4] }] }],
          },
        ],
      }),
    });

    expect(ResumeContentSchema.safeParse(result.content).success).toBe(true);
    expect(result.content.sections[0].title).toBe("Other");
  });

  it("saves the unused lines over the threshold", async () => {
    const extra = Array.from({ length: RESUME_UNUSED_LINE_WARNING + 1 }, (_, i) => `Forgotten line ${i}`);
    const result = await parseResumeUpload(pdfOf([...LINES, ...extra]), { fileName: "cv.pdf", model: modelFor() });

    expect(result.parseNotes?.unusedLines).toEqual(extra);
    expect(result.coverage).toBeLessThan(1);
  });

  it("saves no notes at or under the threshold", async () => {
    const extra = Array.from({ length: RESUME_UNUSED_LINE_WARNING }, (_, i) => `Forgotten line ${i}`);
    const result = await parseResumeUpload(pdfOf([...LINES, ...extra]), { fileName: "cv.pdf", model: modelFor() });

    expect(result.parseNotes).toBeNull();
  });
});

describe("resumeCoverage (RE-REQ-016)", () => {
  it("counts every part's lines as used", () => {
    expect(resumeCoverage(LINES, PARSED)).toEqual({ coverage: 1, unusedLines: [] });
  });

  it("lists the lines nothing used", () => {
    expect(resumeCoverage([...LINES, "Lost"], PARSED).unusedLines).toEqual(["Lost"]);
  });

  it("doesn't count page markers, page numbers or repeated footers", () => {
    const lines = [...LINES, "-- 1 of 2 --", "2", "Page 3", "Page 3 of 4", "Ada Lovelace - CV", "Ada Lovelace - CV"];
    expect(resumeCoverage(lines, PARSED)).toEqual({ coverage: 1, unusedLines: [] });
  });

  it("reads coverage as 1 for a file with only noise", () => {
    expect(resumeCoverage(["1"], { contact: { links: [] }, sections: [] }).coverage).toBe(1);
  });
});
