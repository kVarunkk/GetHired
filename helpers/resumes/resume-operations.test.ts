import { describe, expect, it } from "vitest";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import type { ResumeContact, ResumeContent } from "@/helpers/resume/resume-schema";
import {
  ResumeOperationSchema,
  applyResumeOperations,
  runResumeOperations,
  type ResumeOperation,
} from "./resume-operations";

const CONTENT: ResumeContent = {
  version: 2,
  sections: [
    {
      id: "s1",
      type: "experience",
      items: [
        {
          id: "i1",
          heading: "Engineer",
          bullets: [
            { id: "b1", text: "One" },
            { id: "b2", text: "Two" },
            { id: "b3", text: "Three" },
          ],
        },
        { id: "i2", bullets: [] },
      ],
    },
    { id: "s2", type: "skills", items: [] },
  ],
};

const CONTACT: ResumeContact = { fullName: "Ada", links: [] };

function run(...operations: ResumeOperation[]) {
  const result = applyResumeOperations(CONTENT, CONTACT, operations);
  if (!result.ok) throw new Error(result.error);
  return result;
}

const bullets = (content: ResumeContent) => content.sections[0].items[0].bullets;

describe("applyResumeOperations (RE-REQ-071)", () => {
  it("setBulletText", () => {
    expect(bullets(run({ op: "setBulletText", bulletId: "b2", text: "New" }).content)[1]).toEqual({ id: "b2", text: "New" });
  });

  it("addBullet, at the end or a position, with a new id", () => {
    const end = bullets(run({ op: "addBullet", itemId: "i1", text: "Four" }).content);
    expect(end[3].text).toBe("Four");
    expect(end[3].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(bullets(run({ op: "addBullet", itemId: "i1", text: "Zero", index: 0 }).content)[0].text).toBe("Zero");
  });

  it("removeBullet", () => {
    expect(bullets(run({ op: "removeBullet", bulletId: "b2" }).content).map((b) => b.id)).toEqual(["b1", "b3"]);
  });

  it("setItemFields changes only those fields", () => {
    const { content } = run({ op: "setItemFields", itemId: "i1", fields: { subheading: "Acme", startDate: "2022" } });
    expect(content.sections[0].items[0]).toMatchObject({ heading: "Engineer", subheading: "Acme", startDate: "2022" });
  });

  it("addItem, with fields and bullets, all with new ids", () => {
    const { content } = run({ op: "addItem", sectionId: "s2", fields: { heading: "Languages" }, bullets: ["Go"] });
    const [item] = content.sections[1].items;
    expect(item.heading).toBe("Languages");
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.bullets[0]).toMatchObject({ text: "Go", id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });

  it("removeItem", () => {
    expect(run({ op: "removeItem", itemId: "i1" }).content.sections[0].items.map((i) => i.id)).toEqual(["i2"]);
  });

  it("addSection, at a position", () => {
    const { content } = run({ op: "addSection", sectionType: "awards", index: 0 });
    expect(content.sections[0]).toMatchObject({ type: "awards", items: [] });
    expect(content.sections[1].id).toBe("s1");
  });

  it("setSectionTitle", () => {
    expect(run({ op: "setSectionTitle", sectionId: "s2", title: "Tools" }).content.sections[1].title).toBe("Tools");
  });

  it("removeSection", () => {
    expect(run({ op: "removeSection", sectionId: "s1" }).content.sections.map((s) => s.id)).toEqual(["s2"]);
  });

  describe("move", () => {
    it("moves a bullet, an item and a section within its parent", () => {
      expect(bullets(run({ op: "move", id: "b1", index: 2 }).content).map((b) => b.id)).toEqual(["b2", "b3", "b1"]);
      expect(run({ op: "move", id: "i2", index: 0 }).content.sections[0].items[0].id).toBe("i2");
      expect(run({ op: "move", id: "s2", index: 0 }).content.sections[0].id).toBe("s2");
    });

    it("to the same place changes nothing", () => {
      expect(run({ op: "move", id: "b2", index: 1 }).content).toEqual(CONTENT);
    });

    it("past the end means last", () => {
      expect(bullets(run({ op: "move", id: "b1", index: 99 }).content).map((b) => b.id)).toEqual(["b2", "b3", "b1"]);
    });

    it("the first to the front stays first", () => {
      expect(bullets(run({ op: "move", id: "b1", index: 0 }).content)[0].id).toBe("b1");
    });
  });

  it("setContact changes only those fields", () => {
    const { contact } = run({ op: "setContact", fields: { phone: "+91 98" } });
    expect(contact).toEqual({ fullName: "Ada", phone: "+91 98", links: [] });
  });

  it("rename and setTemplate", () => {
    expect(run({ op: "rename", name: "Backend" }).name).toBe("Backend");
    expect(run({ op: "setTemplate", template: "compact" }).template).toBe("compact");
  });

  it("leaves untouched parts and their ids alone", () => {
    const { content } = run({ op: "addBullet", itemId: "i2", text: "New" });
    expect(content.sections[0].items[0]).toEqual(CONTENT.sections[0].items[0]);
    expect(content.sections[1]).toEqual(CONTENT.sections[1]);
  });

  it("applies in order, so a later operation sees an earlier one", () => {
    const { content } = run({ op: "removeBullet", bulletId: "b1" }, { op: "move", id: "b3", index: 0 });
    expect(bullets(content).map((b) => b.id)).toEqual(["b3", "b2"]);
  });

  it("never changes its input", () => {
    const before = structuredClone(CONTENT);
    run({ op: "removeSection", sectionId: "s1" }, { op: "setContact", fields: { fullName: "Eve" } });
    expect(CONTENT).toEqual(before);
    expect(CONTACT.fullName).toBe("Ada");
  });

  it.each<[string, ResumeOperation]>([
    ["bullet", { op: "setBulletText", bulletId: "nope", text: "x" }],
    ["item", { op: "addBullet", itemId: "nope", text: "x" }],
    ["section", { op: "removeSection", sectionId: "nope" }],
    ["move target", { op: "move", id: "nope", index: 0 }],
  ])("an unknown %s id fails the whole list", (_label, bad) => {
    const result = applyResumeOperations(CONTENT, CONTACT, [{ op: "removeBullet", bulletId: "b1" }, bad]);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("nope") });
  });

  it("the limits still hold after the operations", () => {
    expect(applyResumeOperations(CONTENT, CONTACT, [{ op: "setBulletText", bulletId: "b1", text: "x".repeat(RESUME_LIMITS.bulletChars + 1) }])).toMatchObject({ ok: false });
    expect(applyResumeOperations(CONTENT, CONTACT, [{ op: "setBulletText", bulletId: "b1", text: " " }])).toMatchObject({ ok: false });
    expect(applyResumeOperations(CONTENT, CONTACT, [{ op: "setItemFields", itemId: "i1", fields: { url: "javascript:alert(1)" } }])).toMatchObject({ ok: false });
    expect(applyResumeOperations(CONTENT, CONTACT, [{ op: "addSection", sectionType: "other" }])).toMatchObject({ ok: false });
    expect(applyResumeOperations(CONTENT, CONTACT, [{ op: "setContact", fields: { email: "nope" } }])).toMatchObject({ ok: false });
    const full = Array.from({ length: RESUME_LIMITS.bulletsPerItem }, () => ({ op: "addBullet", itemId: "i1", text: "x" }) as const);
    expect(applyResumeOperations(CONTENT, CONTACT, full)).toMatchObject({ ok: false });
  });
});

describe("runResumeOperations", () => {
  it("allows what's only invalid until it's finished, for the editor", () => {
    const result = runResumeOperations({ content: CONTENT, contact: CONTACT }, [{ op: "setBulletText", bulletId: "b1", text: "" }]);
    expect(result).toMatchObject({ ok: true });
  });

  it("still refuses an unknown id", () => {
    const result = runResumeOperations({ content: CONTENT, contact: CONTACT }, [{ op: "removeItem", itemId: "nope" }]);
    expect(result).toMatchObject({ ok: false });
  });
});

describe("ResumeOperationSchema", () => {
  it("refuses an unknown operation and bad input", () => {
    expect(ResumeOperationSchema.safeParse({ op: "deleteEverything" }).success).toBe(false);
    expect(ResumeOperationSchema.safeParse({ op: "move", id: "b1", index: -1 }).success).toBe(false);
    expect(ResumeOperationSchema.safeParse({ op: "addSection", sectionType: "hobbies" }).success).toBe(false);
    expect(ResumeOperationSchema.safeParse({ op: "setBulletText", bulletId: "b1", text: "x" }).success).toBe(true);
  });
});
