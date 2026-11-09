import { describe, expect, it } from "vitest";
import { resumeDocumentText } from "@/helpers/resume/render/document";
import { applicationResume } from "./application-resume";
import { buildResumeSnapshot, readResumeSnapshot } from "./resume-snapshot";

const CONTENT = {
  version: 2,
  sections: [
    { id: "s1", type: "experience", items: [{ id: "i1", heading: "Engineer", bullets: [{ id: "b1", text: "Sent text" }] }] },
  ],
};
const CONTACT = { fullName: "Ada Lovelace", email: "ada@example.com", links: [] };
const ROW = { name: "Backend", content: CONTENT, contact: CONTACT, template: "compact", schema_version: 2 };

const documentText = (result: ReturnType<typeof applicationResume>) => {
  if (result?.kind !== "document") throw new Error("Expected a document");
  return resumeDocumentText(result.document);
};

describe("buildResumeSnapshot (RE-REQ-061)", () => {
  it("keeps the name, template and content, and contact apart", () => {
    const { resume_snapshot, resume_contact_snapshot } = buildResumeSnapshot(ROW);

    expect(resume_snapshot).toEqual({ name: "Backend", template: "compact", content: CONTENT });
    expect(JSON.stringify(resume_snapshot)).not.toContain("ada@example.com");
    expect(resume_contact_snapshot).toEqual(CONTACT);
  });

  it("reads a version 1 resume, which has no contact", () => {
    const result = buildResumeSnapshot({
      name: "Old",
      content: { sections: [{ type: "skills", items: [{ bullets: [{ id: "b", text: "Go" }] }] }] },
      contact: null,
      schema_version: 1,
    });

    expect(readResumeSnapshot(result.resume_snapshot)?.content.sections[0].items[0].bullets[0].text).toBe("Go");
    expect(result.resume_contact_snapshot).toBeNull();
  });

  it("leaves both null for a resume with no content", () => {
    expect(buildResumeSnapshot({ name: "Empty", content: null })).toEqual({
      resume_snapshot: null,
      resume_contact_snapshot: null,
    });
  });
});

describe("readResumeSnapshot", () => {
  it.each([[null], [undefined], ["text"], [[]]])("reads %j as none", (value) => {
    expect(readResumeSnapshot(value)).toBeNull();
  });
});

describe("applicationResume (RE-REQ-062)", () => {
  it("prefers the snapshot, with the contact sent with it, over the file and the live resume", () => {
    const result = applicationResume({
      ...buildResumeSnapshot(ROW),
      resumes: { resume_path: "u/r.pdf", content: { sections: [] } },
    });

    expect(documentText(result)).toContain("Sent text");
    expect(documentText(result)).toContain("Ada Lovelace");
  });

  it("uses the file for an older application", () => {
    expect(applicationResume({ resume_snapshot: null, resumes: { resume_path: "u/r.pdf", content: CONTENT } })).toEqual({
      kind: "file",
      path: "u/r.pdf",
    });
  });

  it("falls back to the linked resume's text, with no contact details", () => {
    const result = applicationResume({ resume_snapshot: null, resumes: { resume_path: null, content: CONTENT } });

    expect(documentText(result)).toContain("Sent text");
  });

  it.each([[null], [undefined], [{}], [{ resumes: null }], [{ resumes: { resume_path: null, content: null } }]])(
    "finds no resume in %j",
    (row) => {
      expect(applicationResume(row)).toBeNull();
    },
  );
});
