import {
  RESUME_DEFAULT_TEMPLATE,
  RESUME_SECTION_TYPES,
  RESUME_TEMPLATES,
  type ResumeSectionType,
  type ResumeTemplate,
} from "./config";
import type { ResumeBullet, ResumeContact, ResumeContent, ResumeItem, ResumeSection } from "./resume-schema";

// RE-REQ-008: the one place that turns a stored `resumes` row into the typed
// shape, so no caller branches on the version. Never throws: a row that can't
// be read is an empty resume. Client-safe.

type ResumeRowLike = {
  content?: unknown;
  contact?: unknown;
  schema_version?: number | null;
  revision?: number | null;
  template?: string | null;
};

export type ReadResumeFields = {
  content: ResumeContent;
  contact: ResumeContact | null;
  schemaVersion: 1 | 2;
  revision: number;
  template: ResumeTemplate;
  /** False when the row has no parsed content at all. */
  hasContent: boolean;
};

export type ReadResume<T> = Omit<T, keyof ResumeRowLike> & ReadResumeFields;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);

const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const objects = (value: unknown) => (Array.isArray(value) ? value.filter(isObject) : []);

function readBullets(value: unknown, parentId: string): ResumeBullet[] {
  return objects(value).flatMap((bullet, index) => {
    const bulletText = text(bullet.text);
    return bulletText ? [{ id: text(bullet.id) ?? `${parentId}-b${index}`, text: bulletText }] : [];
  });
}

function readItems(value: unknown, parentId: string): ResumeItem[] {
  return objects(value).map((item, index) => {
    const id = text(item.id) ?? `${parentId}-i${index}`;
    return defined({
      id,
      heading: text(item.heading),
      subheading: text(item.subheading),
      location: text(item.location),
      startDate: text(item.startDate),
      endDate: text(item.endDate),
      url: text(item.url),
      bullets: readBullets(item.bullets, id),
    });
  });
}

const isSectionType = (value: unknown): value is ResumeSectionType =>
  (RESUME_SECTION_TYPES as readonly unknown[]).includes(value);

/** `other` needs a title: the unknown type's own name, or "Other". */
function fallbackTitle(type: unknown) {
  if (isSectionType(type) && type !== "other") return undefined;
  return type === "other" ? "Other" : (text(type) ?? "Other");
}

function readSections(value: unknown): ResumeSection[] {
  return objects(value).map((section, index) => {
    // Ids are derived from the position, so a version 1 row reads the same every time.
    const id = text(section.id) ?? `s${index}`;
    return defined({
      id,
      type: isSectionType(section.type) ? section.type : ("other" as const),
      title: text(section.title) ?? fallbackTitle(section.type),
      items: readItems(section.items, id),
    });
  });
}

function readContact(value: unknown): ResumeContact | null {
  if (!isObject(value)) return null;
  return defined({
    fullName: text(value.fullName) ?? "",
    headline: text(value.headline),
    email: text(value.email),
    phone: text(value.phone),
    location: text(value.location),
    links: objects(value.links).flatMap((link) => {
      const label = text(link.label);
      const url = text(link.url);
      return label && url ? [{ label, url }] : [];
    }),
  });
}

/** The parts of a row, typed. Other columns pass through unchanged. */
export function readResume<T extends ResumeRowLike>(row: T): ReadResume<T> {
  const { content, contact, schema_version, revision, template, ...rest } = row;
  const stored = isObject(content) ? content : null;
  return {
    ...(rest as unknown as Omit<T, keyof ResumeRowLike>),
    content: { version: 2, sections: readSections(stored?.sections) },
    contact: readContact(contact),
    schemaVersion: schema_version === 2 || stored?.version === 2 ? 2 : 1,
    revision: revision ?? 1,
    template: (RESUME_TEMPLATES as readonly unknown[]).includes(template)
      ? (template as ResumeTemplate)
      : RESUME_DEFAULT_TEMPLATE,
    hasContent: content !== null && content !== undefined,
  };
}
