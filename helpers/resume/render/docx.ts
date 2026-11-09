import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { ResumeTemplate } from "@/helpers/resume/config";
import type { ResumeDocument, ResumeDocumentLink } from "./document";

// RE-REQ-052: plain paragraphs and real headings, with no tables or columns, so
// a resume stays ATS-safe. Sizes are in half-points.

const SCALE: Record<ResumeTemplate, { body: number; name: number; heading: number; gap: number }> = {
  classic: { body: 21, name: 40, heading: 24, gap: 200 },
  compact: { body: 19, name: 32, heading: 21, gap: 120 },
};

const FONT = "Arial";
const META_COLOR = "444444";

function linkRun(part: ResumeDocumentLink, size: number) {
  const run = new TextRun({ text: part.text, size, color: META_COLOR });
  return part.href ? new ExternalHyperlink({ link: part.href, children: [run] }) : run;
}

function contactParagraph(contact: ResumeDocumentLink[], size: number) {
  return new Paragraph({
    children: contact.flatMap((part, index) => [
      ...(index > 0 ? [new TextRun({ text: " · ", size, color: META_COLOR })] : []),
      linkRun(part, size),
    ]),
  });
}

function toParagraphs(document: ResumeDocument): Paragraph[] {
  const { body, name, heading, gap } = SCALE[document.template];
  return [
    ...(document.name
      ? [new Paragraph({ children: [new TextRun({ text: document.name, bold: true, size: name })] })]
      : []),
    ...(document.headline ? [new Paragraph({ children: [new TextRun({ text: document.headline, size: body })] })] : []),
    ...(document.contact.length > 0 ? [contactParagraph(document.contact, body)] : []),
    ...document.sections.flatMap((section) => [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: gap, after: 60 },
        border: { bottom: { style: "single", size: 4, color: "999999", space: 2 } },
        children: [new TextRun({ text: section.title, bold: true, size: heading, color: "111111", font: FONT })],
      }),
      ...section.items.flatMap((item) => [
        ...(item.title
          ? [new Paragraph({ keepNext: true, children: [new TextRun({ text: item.title, bold: true, size: body })] })]
          : []),
        ...(item.meta
          ? [new Paragraph({ children: [new TextRun({ text: item.meta, size: body, color: META_COLOR })] })]
          : []),
        ...(item.link ? [new Paragraph({ children: [linkRun(item.link, body)] })] : []),
        ...item.bullets.map(
          (bullet) =>
            new Paragraph({
              ...(section.plain ? {} : { bullet: { level: 0 } }),
              children: [new TextRun({ text: bullet.text, size: body })],
            }),
        ),
      ]),
    ]),
  ];
}

/** The resume as a Word file. */
export async function renderResumeDocx(document: ResumeDocument): Promise<Uint8Array> {
  const file = new Document({
    title: document.name ?? "Resume",
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [{ children: toParagraphs(document) }],
  });
  return new Uint8Array(await Packer.toBuffer(file));
}
