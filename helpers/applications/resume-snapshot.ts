import { RESUME_DEFAULT_TEMPLATE, type ResumeTemplate } from "@/helpers/resume/config";
import { readResume } from "@/helpers/resume/read-resume";
import type { ResumeContact, ResumeContent } from "@/helpers/resume/resume-schema";
import { buildResumeDocument, type ResumeDocument } from "@/helpers/resume/render/document";
import type { Json } from "@/utils/types/database.types";

// RE-REQ-061: what an application sent, kept on the application, so later edits
// or deletes never change what the company sees. Contact details have their own
// column, so a reader of the resume text never has them (RE-SEC-006).

export type ResumeSnapshot = { name: string | null; template: ResumeTemplate; content: ResumeContent };

type ResumeRow = {
  name?: string | null;
  content?: unknown;
  contact?: unknown;
  template?: string | null;
  schema_version?: number | null;
};

const NO_CONTACT: ResumeContact = { fullName: "", links: [] };

/** The two columns for this resume. A resume with no content leaves them null. */
export function buildResumeSnapshot(row: ResumeRow): {
  resume_snapshot: Json | null;
  resume_contact_snapshot: Json | null;
} {
  const resume = readResume(row);
  if (!resume.hasContent) return { resume_snapshot: null, resume_contact_snapshot: null };
  const snapshot: ResumeSnapshot = {
    name: row.name ?? null,
    template: resume.template,
    content: resume.content,
  };
  return {
    resume_snapshot: snapshot as unknown as Json,
    resume_contact_snapshot: (resume.contact as unknown as Json) ?? null,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored snapshot, typed. Null for an older application that has none. */
export function readResumeSnapshot(value: unknown): ResumeSnapshot | null {
  if (!isObject(value)) return null;
  const { content, template } = readResume({
    content: value.content,
    template: typeof value.template === "string" ? value.template : RESUME_DEFAULT_TEMPLATE,
  });
  return { name: typeof value.name === "string" ? value.name : null, template, content };
}

/** The resume as a company reads it, with the contact details sent with it. */
export function snapshotDocument(snapshot: ResumeSnapshot, contact: unknown): ResumeDocument {
  return buildResumeDocument({
    contact: readResume({ contact }).contact ?? NO_CONTACT,
    content: snapshot.content,
    template: snapshot.template,
  });
}
