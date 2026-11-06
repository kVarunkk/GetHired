import { readResume } from "@/helpers/resume/read-resume";
import { buildResumeDocument, type ResumeDocument } from "@/helpers/resume/render/document";
import { readResumeSnapshot, snapshotDocument } from "./resume-snapshot";

export type ApplicationResumeRow = {
  resume_snapshot?: unknown;
  resume_contact_snapshot?: unknown;
  resumes?: { resume_path?: string | null; content?: unknown; template?: string | null } | null;
};

export type ApplicationResume =
  | { kind: "document"; document: ReturnType<typeof snapshotDocument> }
  | { kind: "file"; path: string }
  | null;

/**
 * What an application's resume is, for the company (RE-REQ-062): the snapshot,
 * or for an older application the stored file, or else the linked resume's text
 * (RE-REQ-100). An older application has no contact snapshot, and this never
 * reads the live contact details.
 */
export function applicationResume(application: ApplicationResumeRow | null | undefined): ApplicationResume {
  const snapshot = readResumeSnapshot(application?.resume_snapshot);
  if (snapshot) {
    return { kind: "document", document: snapshotDocument(snapshot, application?.resume_contact_snapshot) };
  }

  const linked = application?.resumes;
  if (linked?.resume_path) return { kind: "file", path: linked.resume_path };

  const resume = readResume(linked ?? {});
  if (!resume.hasContent) return null;
  const document: ResumeDocument = buildResumeDocument({
    contact: { fullName: "", links: [] },
    content: resume.content,
    template: resume.template,
  });
  return { kind: "document", document };
}
