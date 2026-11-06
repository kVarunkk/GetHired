import { describe, expect, it } from "vitest";
import { RESUME_LIMITS } from "./config";
import {
  ResumeContactSchema,
  ResumeContentSchema,
  ResumeParseSchema,
  emptyResumeContent,
  isSafeResumeUrl,
  normalizeResumeUrl,
  withResumeIds,
} from "./resume-schema";

const bullet = (id = "b1", text = "Built things") => ({ id, text });
const item = (overrides: object = {}) => ({ id: "i1", heading: "Engineer", bullets: [bullet()], ...overrides });
const section = (overrides: object = {}) => ({ id: "s1", type: "experience", items: [item()], ...overrides });
const content = (sections: unknown[] = [section()]) => ({ version: 2, sections });

const fails = (value: unknown) => !ResumeContentSchema.safeParse(value).success;
const many = <T,>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));

describe("ResumeContentSchema", () => {
  it("accepts a full resume, keeping every field", () => {
    const value = content([
      section({
        title: "Work",
        items: [
          item({
            subheading: "Acme",
            location: "Pune",
            startDate: "Jan 2022",
            endDate: "Present",
            url: "https://acme.test",
          }),
        ],
      }),
    ]);
    expect(ResumeContentSchema.parse(value)).toEqual(value);
  });

  it("needs version 2", () => {
    expect(fails({ ...content(), version: 1 })).toBe(true);
    expect(fails({ sections: [] })).toBe(true);
  });

  it("strips unknown keys and lineIndices", () => {
    const parsed = ResumeContentSchema.parse({
      ...content([
        {
          ...section({ items: [{ ...item({ bullets: [{ ...bullet(), lineIndices: [1] }] }), lineIndices: [2], evil: 1 }] }),
          lineIndices: [3],
        },
      ]),
      extra: true,
    });
    expect(JSON.stringify(parsed)).not.toMatch(/lineIndices|evil|extra/);
  });

  it("limits sections, items, bullets and text", () => {
    expect(fails(content(many(RESUME_LIMITS.sections + 1, (i) => section({ id: `s${i}`, items: [] }))))).toBe(true);
    expect(fails(content([section({ items: many(RESUME_LIMITS.itemsPerSection + 1, (i) => item({ id: `i${i}`, bullets: [] })) })]))).toBe(true);
    expect(fails(content([section({ items: [item({ bullets: many(RESUME_LIMITS.bulletsPerItem + 1, (i) => bullet(`b${i}`)) })] })]))).toBe(true);
    expect(fails(content([section({ items: [item({ bullets: [bullet("b", "x".repeat(RESUME_LIMITS.bulletChars + 1))] })] })]))).toBe(true);
    expect(fails(content([section({ items: [item({ heading: "x".repeat(RESUME_LIMITS.shortFieldChars + 1) })] })]))).toBe(true);
  });

  it("allows exactly the limit", () => {
    expect(fails(content(many(RESUME_LIMITS.sections, (i) => section({ id: `s${i}`, items: [] }))))).toBe(false);
    expect(fails(content([section({ items: [item({ bullets: [bullet("b", "x".repeat(RESUME_LIMITS.bulletChars))] })] })]))).toBe(false);
  });

  it("refuses an empty bullet", () => {
    expect(fails(content([section({ items: [item({ bullets: [bullet("b", "   ")] })] })]))).toBe(true);
  });

  it("refuses a link that isn't http(s)", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://a.test", "acme.test"]) {
      expect(fails(content([section({ items: [item({ url })] })])), url).toBe(true);
    }
    expect(fails(content([section({ items: [item({ url: "http://acme.test/a?b=1" })] })]))).toBe(false);
  });

  it("needs a title for an `other` section, and only there", () => {
    expect(fails(content([section({ type: "other" })]))).toBe(true);
    expect(fails(content([section({ type: "other", title: "  " })]))).toBe(true);
    expect(fails(content([section({ type: "other", title: "Patents" })]))).toBe(false);
    expect(fails(content([section({ type: "experience" })]))).toBe(false);
  });

  it("refuses an unknown section type", () => {
    expect(fails(content([section({ type: "hobbies" })]))).toBe(true);
  });

  it("refuses an id used twice in one resume", () => {
    expect(fails(content([section(), section()]))).toBe(true);
    expect(fails(content([section({ items: [item({ bullets: [bullet("x"), bullet("x")] })] })]))).toBe(true);
  });
});

describe("ResumeContactSchema", () => {
  const contact = { fullName: "Ada Lovelace", links: [] };

  it("keeps the fields and defaults links", () => {
    const value = {
      fullName: "Ada",
      headline: "Engineer",
      email: "ada@example.com",
      phone: "+91 98",
      location: "Pune",
      links: [{ label: "GitHub", url: "https://github.com/ada" }],
    };
    expect(ResumeContactSchema.parse(value)).toEqual(value);
    expect(ResumeContactSchema.parse({ fullName: "Ada" }).links).toEqual([]);
  });

  it("allows a blank name, for a blank resume", () => {
    expect(ResumeContactSchema.safeParse({ ...contact, fullName: "" }).success).toBe(true);
  });

  it("refuses a javascript: link", () => {
    const links = [{ label: "x", url: "javascript:alert(1)" }];
    expect(ResumeContactSchema.safeParse({ ...contact, links }).success).toBe(false);
  });

  it("refuses a bad email and too many links", () => {
    expect(ResumeContactSchema.safeParse({ ...contact, email: "not an email" }).success).toBe(false);
    const links = many(RESUME_LIMITS.contactLinks + 1, () => ({ label: "x", url: "https://a.test" }));
    expect(ResumeContactSchema.safeParse({ ...contact, links }).success).toBe(false);
  });

  it("strips unknown keys", () => {
    expect(ResumeContactSchema.parse({ ...contact, ssn: "1" })).not.toHaveProperty("ssn");
  });
});

describe("ResumeParseSchema", () => {
  it("needs lineIndices on every part, contact fields included", () => {
    const line = { value: "Ada", lineIndices: [0] };
    const valid = {
      contact: { fullName: line, links: [] },
      sections: [
        {
          type: "experience",
          lineIndices: [1],
          items: [{ lineIndices: [2], bullets: [{ text: "Built", lineIndices: [3] }] }],
        },
      ],
    };
    expect(ResumeParseSchema.safeParse(valid).success).toBe(true);
    const noBulletLines = structuredClone(valid) as { sections: { items: { bullets: object[] }[] }[] };
    noBulletLines.sections[0].items[0].bullets = [{ text: "Built" }];
    expect(ResumeParseSchema.safeParse(noBulletLines).success).toBe(false);
    expect(ResumeParseSchema.safeParse({ ...valid, contact: { fullName: { value: "Ada" }, links: [] } }).success).toBe(false);
  });
});

describe("withResumeIds", () => {
  const parsed = {
    sections: [{ type: "experience", items: [{ heading: "A", bullets: [{ text: "One" }, { text: "Two", id: "keep" }] }] }],
  };

  it("gives every new part an id and keeps existing ones", () => {
    const { sections } = withResumeIds({
      sections: [{ ...parsed.sections[0], id: "s-keep", items: [{ ...parsed.sections[0].items[0], id: "i-keep" }] }, parsed.sections[0]],
    });
    expect(sections[0].id).toBe("s-keep");
    expect(sections[0].items[0].id).toBe("i-keep");
    expect(sections[0].items[0].bullets[1].id).toBe("keep");
    expect(sections[0].items[0].bullets[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sections[1].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sections[1].items[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps the other fields", () => {
    expect(withResumeIds(parsed).sections[0].items[0].heading).toBe("A");
  });
});

describe("links", () => {
  it("isSafeResumeUrl allows only http(s)", () => {
    expect(isSafeResumeUrl("https://a.test")).toBe(true);
    expect(isSafeResumeUrl("HTTP://a.test")).toBe(true);
    expect(isSafeResumeUrl(" javascript:alert(1)")).toBe(false);
    expect(isSafeResumeUrl("mailto:a@b.c")).toBe(false);
    expect(isSafeResumeUrl("")).toBe(false);
  });

  it("normalizeResumeUrl adds https to a bare domain and drops other schemes", () => {
    expect(normalizeResumeUrl("linkedin.com/in/ada")).toBe("https://linkedin.com/in/ada");
    expect(normalizeResumeUrl("www.ada.dev")).toBe("https://www.ada.dev");
    expect(normalizeResumeUrl("https://ada.dev")).toBe("https://ada.dev");
    expect(normalizeResumeUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizeResumeUrl("mailto:a@b.c")).toBeUndefined();
    expect(normalizeResumeUrl("Portfolio")).toBeUndefined();
    expect(normalizeResumeUrl("")).toBeUndefined();
  });
});

describe("emptyResumeContent", () => {
  it("is a valid resume", () => {
    expect(ResumeContentSchema.safeParse(emptyResumeContent()).success).toBe(true);
  });
});
