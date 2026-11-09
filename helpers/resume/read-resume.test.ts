import { describe, expect, it } from "vitest";
import { extractSectionText } from "@/utils/extract-resume-content";
import { resumeEmbeddingText, resumeSectionText } from "@/helpers/embeddings/resume-text";
import { readResume } from "./read-resume";
import { ResumeContentSchema } from "./resume-schema";

const V1 = {
  sections: [
    {
      type: "experience",
      items: [
        {
          heading: "Engineer",
          subheading: "Acme",
          bullets: [{ id: "b-old", text: "Built things", lineIndices: [4] }],
        },
      ],
    },
    { type: "other", items: [{ bullets: [{ id: "b-other", text: "Patent" }] }] },
  ],
};

const V2 = {
  version: 2,
  sections: [
    {
      id: "s1",
      type: "certifications",
      title: "Licenses",
      items: [{ id: "i1", heading: "AWS", startDate: "2022", bullets: [{ id: "b1", text: "Passed" }] }],
    },
    { id: "s2", type: "experience", items: [{ id: "i2", heading: "Engineer", bullets: [{ id: "b2", text: "Shipped" }] }] },
  ],
};

const CONTACT = { fullName: "Ada", links: [] };

describe("readResume", () => {
  it("gives a version 1 row ids for sections and items, keeping its bullet ids", () => {
    const { content, contact, schemaVersion } = readResume({ content: V1 });
    expect(schemaVersion).toBe(1);
    expect(contact).toBeNull();
    expect(content.version).toBe(2);
    expect(content.sections[0].id).toBeTruthy();
    expect(content.sections[0].items[0].id).toBeTruthy();
    expect(content.sections[0].items[0].bullets[0]).toEqual({ id: "b-old", text: "Built things" });
    expect(ResumeContentSchema.safeParse(content).success).toBe(true);
  });

  it("gives the same ids to a version 1 row on every read", () => {
    expect(readResume({ content: V1 }).content).toEqual(readResume({ content: V1 }).content);
  });

  it("names an untitled `other` section, so it's valid", () => {
    expect(readResume({ content: V1 }).content.sections[1].title).toBe("Other");
  });

  it("maps an unknown section type to `other`, keeping its name", () => {
    const { content } = readResume({ content: { sections: [{ type: "hobbies", items: [] }] } });
    expect(content.sections[0]).toMatchObject({ type: "other", title: "hobbies" });
  });

  it("passes a version 2 row through", () => {
    const resume = readResume({ content: V2, contact: CONTACT, schema_version: 2 });
    expect(resume.schemaVersion).toBe(2);
    expect(resume.content).toEqual(V2);
    expect(resume.contact).toEqual(CONTACT);
  });

  it("keeps the row's other columns", () => {
    const resume = readResume({ id: "r1", name: "CV", content: V2, schema_version: 2, revision: 4, template: "compact" });
    expect(resume).toMatchObject({ id: "r1", name: "CV", revision: 4, template: "compact" });
  });

  it("gives defaults for a row without the new columns", () => {
    const resume = readResume({ content: V1 });
    expect(resume.revision).toBe(1);
    expect(resume.template).toBe("classic");
  });

  it("treats an unknown template as the default", () => {
    expect(readResume({ content: V2, template: "fancy" }).template).toBe("classic");
  });

  it("reads null content as an empty resume", () => {
    const resume = readResume({ content: null });
    expect(resume.content).toEqual({ version: 2, sections: [] });
    expect(resume.hasContent).toBe(false);
    expect(readResume({ content: V1 }).hasContent).toBe(true);
  });

  it.each([
    ["a string", "not json"],
    ["a number", 7],
    ["an array", []],
    ["sections of the wrong type", { sections: "x" }],
    ["sections holding junk", { sections: [null, 3, "x"] }],
  ])("never throws on %s", (_label, content) => {
    expect(readResume({ content }).content.sections).toEqual([]);
  });

  it("drops junk inside a section and keeps the rest", () => {
    const { content } = readResume({
      content: {
        sections: [{ type: "skills", items: [null, { heading: 3, bullets: [{ text: 1 }, { id: "ok", text: "Go" }, null] }] }],
      },
    });
    expect(content.sections[0].items).toHaveLength(1);
    expect(content.sections[0].items[0].heading).toBeUndefined();
    expect(content.sections[0].items[0].bullets).toEqual([{ id: "ok", text: "Go" }]);
  });

  it("reads a contact that isn't an object as null", () => {
    expect(readResume({ content: V2, contact: "x" }).contact).toBeNull();
    expect(readResume({ content: V2, contact: [] }).contact).toBeNull();
  });

  it("fills in a partial contact", () => {
    expect(readResume({ content: V2, contact: { email: "a@b.c" } }).contact).toEqual({
      fullName: "",
      email: "a@b.c",
      links: [],
    });
  });
});

describe("the content readers with a version 2 resume", () => {
  it("extractSectionText reads its sections", () => {
    expect(extractSectionText(["experience"], V2).experience).toBe("**Engineer** \n- Shipped");
  });

  it("the embedding text reads its sections, and leaves out what it always did", () => {
    expect(resumeSectionText(V2, "experience")).toBe("Shipped");
    expect(resumeEmbeddingText(V2)).toBe("EXPERIENCE: Shipped");
  });
});
