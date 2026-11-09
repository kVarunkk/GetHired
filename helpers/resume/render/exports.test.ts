import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { RESUME_TEMPLATES, type ResumeTemplate } from "@/helpers/resume/config";
import { extractPdfLines, extractResumeText } from "@/helpers/resume/extract-text";
import type { ResumeContact, ResumeContent } from "@/helpers/resume/resume-schema";
import { buildResumeDocument, resumeDocumentText } from "./document";
import { renderResumeDocx } from "./docx";
import { ResumePdfCharactersError, renderResumePdf } from "./pdf";

const CONTACT: ResumeContact = {
  fullName: "Ada Lovelace",
  headline: "Staff Engineer",
  email: "ada@example.com",
  phone: "+91 98765 43210",
  location: "Pune, India",
  links: [{ label: "GitHub", url: "https://github.com/ada" }],
};

const CONTENT: ResumeContent = {
  version: 2,
  sections: [
    { id: "s1", type: "summary", items: [{ id: "i0", bullets: [{ id: "b0", text: "Builds billing systems at scale." }] }] },
    {
      id: "s2",
      type: "experience",
      items: [
        {
          id: "i1",
          heading: "Senior Engineer",
          subheading: "Acme Corp",
          location: "Remote",
          startDate: "Jan 2022",
          endDate: "Present",
          url: "https://acme.dev",
          bullets: [
            { id: "b1", text: "Built the billing API serving 2M requests a day" },
            { id: "b2", text: "Cut invoice errors by 40%" },
          ],
        },
      ],
    },
    { id: "s3", type: "other", title: "Talks", items: [{ id: "i2", heading: "RustConf 2024", bullets: [] }] },
  ],
};

const documentFor = (template: ResumeTemplate, content = CONTENT, contact = CONTACT) =>
  buildResumeDocument({ contact, content, template });

/** Wrapped lines are rejoined, so a field is found wherever it wrapped. */
const flatten = (lines: string[]) => lines.join(" ").replace(/\s+/g, " ");

function expectInOrder(text: string, parts: string[]) {
  let from = 0;
  for (const part of parts) {
    const at = text.indexOf(part.replace(/\s+/g, " "), from);
    expect(at, `"${part}" should come back, after what's before it`).toBeGreaterThanOrEqual(0);
    from = at + part.length;
  }
}

/** Each text run's baseline, in points from the top of the first page. */
async function pdfBaselines(pdf: Uint8Array) {
  const document = await getDocument({ data: pdf.slice(), verbosity: 0 }).promise;
  const page = await document.getPage(1);
  const { items } = await page.getTextContent();
  const runs = items.flatMap((item) => ("str" in item ? [item] : []));
  return new Map(runs.map((run) => [run.str, page.view[3] - run.transform[5]]));
}

describe.each(RESUME_TEMPLATES)("the %s template", (template) => {
  it("PDF: every field comes back in reading order (RE-REQ-053)", async () => {
    const document = documentFor(template);
    const bytes = await renderResumePdf(document);

    const lines = await extractPdfLines({ data: bytes }, { pageMarkers: false });

    expectInOrder(flatten(lines), resumeDocumentText(document));
  });

  it("PDF: the headline sits clear of the larger name above it", async () => {
    const pdf = await renderResumePdf(documentFor(template));
    const baselines = await pdfBaselines(pdf);
    const gap = baselines.get(CONTACT.headline!)! - baselines.get(CONTACT.fullName)!;

    // When the name inherits the body's line height, this comes out under 10pt.
    expect(gap).toBeGreaterThan(15);
  });

  it("Word: every field comes back in reading order", async () => {
    const document = documentFor(template);
    const bytes = await renderResumeDocx(document);

    const { type, lines } = await extractResumeText(bytes);

    expect(type).toBe("docx");
    expectInOrder(flatten(lines), resumeDocumentText(document));
  });
});

describe("a long resume", () => {
  const LONG: ResumeContent = {
    version: 2,
    sections: [
      {
        id: "s",
        type: "experience",
        items: Array.from({ length: 12 }, (_, i) => ({
          id: `i${i}`,
          heading: `Role number ${i}`,
          bullets: Array.from({ length: 8 }, (_, j) => ({ id: `b${i}-${j}`, text: `Achievement ${i}-${j} with enough words to fill a line of the page` })),
        })),
      },
    ],
  };

  it("spans pages and loses nothing", async () => {
    const document = documentFor("classic", LONG);
    const bytes = await renderResumePdf(document);

    const lines = await extractPdfLines({ data: bytes });

    expect(lines.some((line) => /^-- 2 of \d+ --$/.test(line))).toBe(true);
    const text = flatten(lines.filter((line) => !/^-- \d+ of \d+ --$/.test(line)));
    expectInOrder(text, resumeDocumentText(document));
  }, 20_000);
});

describe("characters beyond plain English", () => {
  const withBullet = (text: string, fullName = "Ada"): [ResumeContent, ResumeContact] => [
    { version: 2, sections: [{ id: "s", type: "experience", items: [{ id: "i", bullets: [{ id: "b", text }] }] }] },
    { fullName, links: [] },
  ];

  it.each([
    ["the rupee sign", "Saved ₹12,00,000 a year"],
    ["Polish", "Łukasz Żółć"],
    ["Cyrillic", "Иван Петров"],
    ["Greek", "Δημήτρης"],
    ["Devanagari", "वरुण कुमावत"],
    ["typography", "“Quoted” – and – more…"],
  ])("PDF: %s survives", async (_label, text) => {
    const [content, contact] = withBullet(text);
    const lines = await extractPdfLines({ data: await renderResumePdf(documentFor("classic", content, contact)) }, { pageMarkers: false });

    expect(flatten(lines)).toContain(text);
  });

  it.each([
    ["Chinese", "数据工程师", "数"],
    ["an emoji", "Shipped it 🚀", "🚀"],
  ])("PDF: refuses %s rather than corrupt it", async (_label, text, character) => {
    const [content, contact] = withBullet(text);

    const error = await renderResumePdf(documentFor("classic", content, contact)).catch((e) => e);

    expect(error).toBeInstanceOf(ResumePdfCharactersError);
    expect(error.characters).toContain(character);
    expect(error.message).toContain("Word");
  });

  it("PDF: lists only a few of the characters", async () => {
    const [content, contact] = withBullet("数据工程师和设计师经理");

    const error = await renderResumePdf(documentFor("classic", content, contact)).catch((e) => e);

    expect(error.characters).toHaveLength(5);
  });

  it("Word: keeps what a PDF can't show", async () => {
    const [content, contact] = withBullet("数据工程师 🚀");
    const { lines } = await extractResumeText(await renderResumeDocx(documentFor("classic", content, contact)));

    expect(flatten(lines)).toContain("数据工程师 🚀");
  });
});
