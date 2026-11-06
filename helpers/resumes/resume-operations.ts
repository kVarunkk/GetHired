import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  RESUME_SECTION_TYPES,
  RESUME_TEMPLATES,
  type ResumeSectionType,
  type ResumeTemplate,
} from "@/helpers/resume/config";
import {
  ResumeContactSchema,
  ResumeContentSchema,
  type ResumeContact,
  type ResumeContent,
  type ResumeItem,
  type ResumeSection,
} from "@/helpers/resume/resume-schema";

// RE-REQ-071: the edits the agent, MCP and the editor can make, applied purely.
// `saveResume` writes the result. Client-safe.

const itemFields = z
  .object({
    heading: z.string(),
    subheading: z.string(),
    location: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    url: z.string(),
  })
  .partial();

const contactFields = z
  .object({
    fullName: z.string(),
    headline: z.string(),
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    links: z.array(z.object({ label: z.string(), url: z.string() })),
  })
  .partial();

const index = z.number().int().min(0).optional();

export const ResumeOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setBulletText"), bulletId: z.string(), text: z.string() }),
  z.object({ op: z.literal("addBullet"), itemId: z.string(), text: z.string(), index }),
  z.object({ op: z.literal("removeBullet"), bulletId: z.string() }),
  z.object({ op: z.literal("setItemFields"), itemId: z.string(), fields: itemFields }),
  z.object({
    op: z.literal("addItem"),
    sectionId: z.string(),
    fields: itemFields.optional(),
    bullets: z.array(z.string()).optional(),
    index,
  }),
  z.object({ op: z.literal("removeItem"), itemId: z.string() }),
  z.object({
    op: z.literal("addSection"),
    sectionType: z.enum(RESUME_SECTION_TYPES),
    title: z.string().optional(),
    index,
  }),
  z.object({ op: z.literal("setSectionTitle"), sectionId: z.string(), title: z.string() }),
  z.object({ op: z.literal("removeSection"), sectionId: z.string() }),
  z.object({
    op: z.literal("move"),
    id: z.string().describe("The section, item or bullet to move, within its parent."),
    index: z.number().int().min(0).describe("Its new position. Past the end means last."),
  }),
  z.object({ op: z.literal("setContact"), fields: contactFields }),
  z.object({ op: z.literal("rename"), name: z.string() }),
  z.object({ op: z.literal("setTemplate"), template: z.enum(RESUME_TEMPLATES) }),
]);

export type ResumeOperation = z.infer<typeof ResumeOperationSchema>;

export type ResumeDraft = {
  content: ResumeContent;
  contact: ResumeContact;
  name?: string;
  template?: ResumeTemplate;
};

export type ResumeOperationsResult = ({ ok: true } & ResumeDraft) | { ok: false; error: string };

class UnknownIdError extends Error {}

const insertAt = <T>(list: T[], item: T, at: number | undefined) => {
  const position = at === undefined ? list.length : Math.min(at, list.length);
  list.splice(position, 0, item);
};

function moveWithin<T>(list: T[], from: number, to: number) {
  const [moved] = list.splice(from, 1);
  list.splice(Math.min(to, list.length), 0, moved);
}

function findItem(content: ResumeContent, itemId: string): { section: ResumeSection; item: ResumeItem } {
  for (const section of content.sections) {
    const item = section.items.find((candidate) => candidate.id === itemId);
    if (item) return { section, item };
  }
  throw new UnknownIdError(`No entry has the id ${itemId}.`);
}

function findBullet(content: ResumeContent, bulletId: string) {
  for (const section of content.sections) {
    for (const item of section.items) {
      const position = item.bullets.findIndex((bullet) => bullet.id === bulletId);
      if (position !== -1) return { item, position };
    }
  }
  throw new UnknownIdError(`No bullet has the id ${bulletId}.`);
}

function findSection(content: ResumeContent, sectionId: string) {
  const section = content.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new UnknownIdError(`No section has the id ${sectionId}.`);
  return section;
}

function move(content: ResumeContent, id: string, to: number) {
  const sectionAt = content.sections.findIndex((section) => section.id === id);
  if (sectionAt !== -1) return moveWithin(content.sections, sectionAt, to);

  for (const section of content.sections) {
    const itemAt = section.items.findIndex((item) => item.id === id);
    if (itemAt !== -1) return moveWithin(section.items, itemAt, to);
    for (const item of section.items) {
      const bulletAt = item.bullets.findIndex((bullet) => bullet.id === id);
      if (bulletAt !== -1) return moveWithin(item.bullets, bulletAt, to);
    }
  }
  throw new UnknownIdError(`Nothing has the id ${id}.`);
}

function apply(draft: ResumeDraft, operation: ResumeOperation) {
  const { content } = draft;
  switch (operation.op) {
    case "setBulletText": {
      const { item, position } = findBullet(content, operation.bulletId);
      item.bullets[position].text = operation.text;
      break;
    }
    case "addBullet":
      insertAt(findItem(content, operation.itemId).item.bullets, { id: uuidv4(), text: operation.text }, operation.index);
      break;
    case "removeBullet": {
      const { item, position } = findBullet(content, operation.bulletId);
      item.bullets.splice(position, 1);
      break;
    }
    case "setItemFields":
      Object.assign(findItem(content, operation.itemId).item, operation.fields);
      break;
    case "addItem":
      insertAt(
        findSection(content, operation.sectionId).items,
        {
          ...operation.fields,
          id: uuidv4(),
          bullets: (operation.bullets ?? []).map((text) => ({ id: uuidv4(), text })),
        },
        operation.index,
      );
      break;
    case "removeItem": {
      const { section, item } = findItem(content, operation.itemId);
      section.items.splice(section.items.indexOf(item), 1);
      break;
    }
    case "addSection":
      insertAt(
        content.sections,
        { id: uuidv4(), type: operation.sectionType as ResumeSectionType, title: operation.title, items: [] },
        operation.index,
      );
      break;
    case "setSectionTitle":
      findSection(content, operation.sectionId).title = operation.title;
      break;
    case "removeSection":
      content.sections.splice(content.sections.indexOf(findSection(content, operation.sectionId)), 1);
      break;
    case "move":
      move(content, operation.id, operation.index);
      break;
    case "setContact":
      Object.assign(draft.contact, operation.fields);
      break;
    case "rename":
      draft.name = operation.name;
      break;
    case "setTemplate":
      draft.template = operation.template;
      break;
  }
}

/**
 * Runs the operations on a copy, without checking the limits. The editor uses
 * this directly, since a half-typed resume isn't valid until it's saved.
 */
export function runResumeOperations(draft: ResumeDraft, operations: ResumeOperation[]): ResumeOperationsResult {
  const next = structuredClone(draft);
  try {
    for (const operation of operations) apply(next, operation);
  } catch (error) {
    if (error instanceof UnknownIdError) return { ok: false, error: error.message };
    throw error;
  }
  return { ok: true, ...next };
}

/**
 * Applies a list of operations. An unknown id fails the whole list, and the
 * result must still be a valid resume. New parts get ids; the rest keep theirs.
 */
export function applyResumeOperations(
  content: ResumeContent,
  contact: ResumeContact,
  operations: ResumeOperation[],
): ResumeOperationsResult {
  const result = runResumeOperations({ content, contact }, operations);
  if (!result.ok) return result;

  const validContent = ResumeContentSchema.safeParse(result.content);
  if (!validContent.success) return { ok: false, error: validContent.error.issues[0].message };
  const validContact = ResumeContactSchema.safeParse(result.contact);
  if (!validContact.success) return { ok: false, error: validContact.error.issues[0].message };

  return { ...result, content: validContent.data, contact: validContact.data };
}
