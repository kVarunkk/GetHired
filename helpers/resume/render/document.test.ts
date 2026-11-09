import { describe, expect, it } from "vitest";
import type { ResumeContact, ResumeContent } from "@/helpers/resume/resume-schema";
import { buildResumeDocument, resumeDocumentText } from "./document";

const CONTACT: ResumeContact = {
  fullName: "Ada Lovelace",
  headline: "Engineer",
  email: "ada@example.com",
  phone: "+91 98",
  location: "Pune",
  links: [{ label: "GitHub", url: "https://github.com/ada/" }],
};

const CONTENT: ResumeContent = {
  version: 2,
  sections: [
    { id: "s1", type: "summary", items: [{ id: "i0", bullets: [{ id: "b0", text: "Builds billing systems." }] }] },
    {
      id: "s2",
      type: "experience",
      items: [
        {
          id: "i1",
          heading: "Staff Engineer",
          subheading: "Acme",
          location: "Remote",
          startDate: "2022",
          endDate: "Present",
          url: "https://acme.dev",
          bullets: [{ id: "b1", text: "Built the billing API" }],
        },
      ],
    },
    { id: "s3", type: "other", title: "Talks", items: [{ id: "i2", heading: "RustConf", bullets: [] }] },
  ],
};

const build = (content: ResumeContent = CONTENT, contact: ResumeContact = CONTACT) =>
  buildResumeDocument({ contact, content, template: "classic" });

describe("buildResumeDocument (RE-REQ-051)", () => {
  it("keeps the section order", () => {
    expect(build().sections.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("puts the subheading, location and dates on an item", () => {
    expect(build().sections[1].items[0]).toMatchObject({
      title: "Staff Engineer",
      meta: "Acme · Remote · 2022 – Present",
      link: { text: "acme.dev", href: "https://acme.dev" },
    });
  });

  it("handles one date alone", () => {
    const content: ResumeContent = {
      version: 2,
      sections: [{ id: "s", type: "education", items: [{ id: "i", endDate: "2020", bullets: [] }] }],
    };
    expect(build(content).sections[0].items[0].meta).toBe("2020");
  });

  it("uses a custom title, or the type's label", () => {
    expect(build().sections.map((s) => s.title)).toEqual(["Summary", "Experience", "Talks"]);
  });

  it("marks only a summary as plain", () => {
    expect(build().sections.map((s) => s.plain)).toEqual([true, false, false]);
  });

  it("skips empty sections and empty items", () => {
    const content: ResumeContent = {
      version: 2,
      sections: [
        { id: "empty", type: "skills", items: [] },
        { id: "hollow", type: "awards", items: [{ id: "i", heading: "  ", bullets: [{ id: "b", text: " " }] }] },
        { id: "kept", type: "projects", items: [{ id: "x", bullets: [] }, { id: "y", heading: "Kept", bullets: [] }] },
      ],
    };
    const { sections } = build(content);
    expect(sections.map((s) => s.id)).toEqual(["kept"]);
    expect(sections[0].items.map((i) => i.id)).toEqual(["y"]);
  });

  it("builds the contact line, with mailto: from the email", () => {
    expect(build().contact).toEqual([
      { text: "ada@example.com", href: "mailto:ada@example.com" },
      { text: "+91 98" },
      { text: "Pune" },
      { text: "GitHub: github.com/ada", href: "https://github.com/ada/" },
    ]);
  });

  it("leaves empty contact parts out", () => {
    const document = build(CONTENT, { fullName: " ", links: [] });
    expect(document.name).toBeUndefined();
    expect(document.headline).toBeUndefined();
    expect(document.contact).toEqual([]);
  });

  it("never links anything but http(s) (RE-SEC-003)", () => {
    const content: ResumeContent = {
      version: 2,
      sections: [{ id: "s", type: "projects", items: [{ id: "i", url: "javascript:alert(1)", bullets: [] }] }],
    };
    const contact = { fullName: "A", links: [{ label: "x", url: "data:text/html,hi" }] };
    const document = build(content, contact);

    expect(document.sections[0].items[0].link?.href).toBeUndefined();
    expect(document.contact[0].href).toBeUndefined();
  });
});

describe("resumeDocumentText", () => {
  it("gives every piece of text in reading order", () => {
    expect(resumeDocumentText(build())).toEqual([
      "Ada Lovelace",
      "Engineer",
      "ada@example.com",
      "+91 98",
      "Pune",
      "GitHub: github.com/ada",
      "Summary",
      "Builds billing systems.",
      "Experience",
      "Staff Engineer",
      "Acme · Remote · 2022 – Present",
      "acme.dev",
      "Built the billing API",
      "Talks",
      "RustConf",
    ]);
  });
});
