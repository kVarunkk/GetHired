import { describe, expect, it } from "vitest";
import { docxOf, pdfOf } from "@/test/utils/resume-files";
import { extractResumeText, sniffFileType, UnreadableFileError } from "./extract-text";

describe("sniffFileType (BI-REQ-022)", () => {
  it("reads the type from the bytes", async () => {
    expect(sniffFileType(pdfOf(["Ada"]))).toBe("pdf");
    expect(sniffFileType(await docxOf(["Ada"]))).toBe("docx");
  });

  it("refuses a text file, an old .doc and a ZIP that isn't a Word document", async () => {
    expect(sniffFileType(new TextEncoder().encode("Ada Lovelace, engineer"))).toBeNull();
    // An OLE2 compound file: the old binary .doc.
    expect(sniffFileType(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toBeNull();
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("notes.txt", "hello");
    expect(sniffFileType(await zip.generateAsync({ type: "uint8array" }))).toBeNull();
  });
});

describe("extractResumeText (BIT-041)", () => {
  it("extracts a PDF's lines", async () => {
    const result = await extractResumeText(pdfOf(["Ada Lovelace", "ada@mail.test", "Analytical engines"]));
    expect(result.type).toBe("pdf");
    expect(result.lines).toEqual(["Ada Lovelace", "ada@mail.test", "Analytical engines"]);
  });

  it("extracts a DOCX's paragraphs", async () => {
    const result = await extractResumeText(await docxOf(["Bo Baker", "", "Go & Rust"]));
    expect(result).toEqual({ type: "docx", lines: ["Bo Baker", "Go & Rust"] });
  });

  it("reads a PDF named .docx as a PDF: the name is never used", async () => {
    // The bytes are all it gets.
    expect((await extractResumeText(pdfOf(["Cy"]))).type).toBe("pdf");
  });

  it("returns no lines for a PDF with no text (a scan)", async () => {
    expect(await extractResumeText(pdfOf([]))).toEqual({ type: "pdf", lines: [] });
  });

  it("refuses a renamed text file or a .doc", async () => {
    await expect(extractResumeText(new TextEncoder().encode("plain text"))).rejects.toBeInstanceOf(UnreadableFileError);
    await expect(
      extractResumeText(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).rejects.toBeInstanceOf(UnreadableFileError);
  });

  it("refuses a PDF it can't parse", async () => {
    await expect(extractResumeText(new TextEncoder().encode("%PDF-1.4 garbage"))).rejects.toBeInstanceOf(
      UnreadableFileError,
    );
  });
});
