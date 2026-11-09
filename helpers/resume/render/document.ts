import { RESUME_SECTION_LABELS, type ResumeTemplate } from "@/helpers/resume/config";
import { isSafeResumeUrl, type ResumeContact, type ResumeContent, type ResumeItem } from "@/helpers/resume/resume-schema";

// RE-REQ-051: the one model behind the preview, the PDF and the Word file, so
// they can't drift. Empty parts are left out here, not in each renderer.
// Client-safe.

export type ResumeDocumentLink = { text: string; href?: string };

export type ResumeDocumentItem = {
  id: string;
  title?: string;
  /** Subheading, location and dates, in reading order. */
  meta?: string;
  link?: ResumeDocumentLink;
  bullets: { id: string; text: string }[];
};

export type ResumeDocumentSection = {
  id: string;
  title: string;
  /** A summary reads as paragraphs, not a list. */
  plain: boolean;
  items: ResumeDocumentItem[];
};

export type ResumeDocument = {
  template: ResumeTemplate;
  name?: string;
  headline?: string;
  contact: ResumeDocumentLink[];
  sections: ResumeDocumentSection[];
};

const META_SEPARATOR = " · ";
const DATE_SEPARATOR = " – ";

const text = (value: string | undefined) => value?.trim() || undefined;

const withoutScheme = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

/** RE-SEC-003: only http(s) links become links. Anything else stays plain text. */
const toLink = (url: string, label?: string): ResumeDocumentLink => {
  const shown = isSafeResumeUrl(url) ? withoutScheme(url) : url;
  return {
    text: label ? `${label}: ${shown}` : shown,
    href: isSafeResumeUrl(url) ? url : undefined,
  };
};

function contactLine(contact: ResumeContact): ResumeDocumentLink[] {
  const email = text(contact.email);
  const phone = text(contact.phone);
  const location = text(contact.location);
  return [
    ...(email ? [{ text: email, href: `mailto:${email}` }] : []),
    ...(phone ? [{ text: phone }] : []),
    ...(location ? [{ text: location }] : []),
    ...contact.links.flatMap((link) => (text(link.url) ? [toLink(link.url, text(link.label))] : [])),
  ];
}

function toItem(item: ResumeItem): ResumeDocumentItem | null {
  const dates = [text(item.startDate), text(item.endDate)].filter(Boolean).join(DATE_SEPARATOR);
  const meta = [text(item.subheading), text(item.location), dates].filter(Boolean).join(META_SEPARATOR);
  const url = text(item.url);
  const bullets = item.bullets.filter((bullet) => text(bullet.text));
  const title = text(item.heading);

  if (!title && !meta && !url && bullets.length === 0) return null;
  return { id: item.id, title, meta: meta || undefined, link: url ? toLink(url) : undefined, bullets };
}

export function buildResumeDocument({
  contact,
  content,
  template,
}: {
  contact: ResumeContact;
  content: ResumeContent;
  template: ResumeTemplate;
}): ResumeDocument {
  return {
    template,
    name: text(contact.fullName),
    headline: text(contact.headline),
    contact: contactLine(contact),
    sections: content.sections.flatMap((section) => {
      const items = section.items.flatMap((item) => toItem(item) ?? []);
      if (items.length === 0) return [];
      return [
        {
          id: section.id,
          title: text(section.title) ?? RESUME_SECTION_LABELS[section.type],
          plain: section.type === "summary",
          items,
        },
      ];
    }),
  };
}

/** Every piece of text in the document, in reading order. */
export function resumeDocumentText(document: ResumeDocument): string[] {
  return [
    document.name,
    document.headline,
    ...document.contact.map((part) => part.text),
    ...document.sections.flatMap((section) => [
      section.title,
      ...section.items.flatMap((item) => [
        item.title,
        item.meta,
        item.link?.text,
        ...item.bullets.map((bullet) => bullet.text),
      ]),
    ]),
  ].filter((part): part is string => !!part);
}
