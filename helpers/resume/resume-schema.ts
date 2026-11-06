import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  RESUME_LIMITS,
  RESUME_MAX_CONTACT_BYTES,
  RESUME_MAX_CONTENT_BYTES,
  RESUME_SECTION_TYPES,
} from "./config";

// The structured resume (plan/resume-editor/feature-resume-editor-spec.md §1).
// `ResumeParseSchema` is what the model returns, `ResumeContentSchema` is what
// we store and what every write validates against. Client-safe.

/** Only http(s) links reach a resume (RE-SEC-003). */
export function isSafeResumeUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A link as a resume writes it, made safe to store: a bare domain gets
 * https://, and anything else that isn't http(s) is dropped.
 */
export function normalizeResumeUrl(raw: string | null | undefined): string | undefined {
  const url = raw?.trim();
  if (!url) return undefined;
  if (isSafeResumeUrl(url)) return url;
  const bareDomain = /^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(url);
  return bareDomain ? `https://${url}` : undefined;
}

/** A blank optional field reads as absent, so the editor can send what it holds. */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === "string" && !value.trim() ? undefined : value), schema.optional());

const shortText = z
  .string()
  .trim()
  .max(RESUME_LIMITS.shortFieldChars, `Keep this under ${RESUME_LIMITS.shortFieldChars} characters.`);

const linkUrl = shortText.refine(isSafeResumeUrl, "Links must start with http:// or https://.");

const id = z.string().min(1).max(64);

const BulletSchema = z.object({
  id,
  text: z
    .string()
    .trim()
    .min(1, "A bullet can't be empty.")
    .max(RESUME_LIMITS.bulletChars, `Keep a bullet under ${RESUME_LIMITS.bulletChars} characters.`),
});

const ItemSchema = z.object({
  id,
  heading: optional(shortText),
  subheading: optional(shortText),
  location: optional(shortText),
  startDate: optional(shortText),
  endDate: optional(shortText),
  url: optional(linkUrl),
  bullets: z
    .array(BulletSchema)
    .max(RESUME_LIMITS.bulletsPerItem, `An entry can have at most ${RESUME_LIMITS.bulletsPerItem} bullets.`),
});

const SectionSchema = z
  .object({
    id,
    type: z.enum(RESUME_SECTION_TYPES),
    title: optional(shortText),
    items: z
      .array(ItemSchema)
      .max(RESUME_LIMITS.itemsPerSection, `A section can have at most ${RESUME_LIMITS.itemsPerSection} entries.`),
  })
  .superRefine((section, ctx) => {
    if (section.type === "other" && !section.title) {
      ctx.addIssue({ code: "custom", path: ["title"], message: "Give this section a title." });
    }
  });

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export const ResumeContentSchema = z
  .object({
    version: z.literal(2),
    sections: z
      .array(SectionSchema)
      .max(RESUME_LIMITS.sections, `A resume can have at most ${RESUME_LIMITS.sections} sections.`),
  })
  .superRefine((content, ctx) => {
    const ids = content.sections.flatMap((s) => [
      s.id,
      ...s.items.flatMap((i) => [i.id, ...i.bullets.map((b) => b.id)]),
    ]);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["sections"], message: "This resume has a repeated id." });
    }
    if (byteLength(content) > RESUME_MAX_CONTENT_BYTES) {
      ctx.addIssue({ code: "custom", path: ["sections"], message: "This resume is too long." });
    }
  });

export const ResumeContactSchema = z
  .object({
    fullName: shortText,
    headline: optional(shortText),
    email: optional(shortText.email("Enter a valid email.")),
    phone: optional(shortText),
    location: optional(shortText),
    links: z
      .array(z.object({ label: shortText, url: linkUrl }))
      .max(RESUME_LIMITS.contactLinks, `Add at most ${RESUME_LIMITS.contactLinks} links.`)
      .default([]),
  })
  .superRefine((contact, ctx) => {
    if (byteLength(contact) > RESUME_MAX_CONTACT_BYTES) {
      ctx.addIssue({ code: "custom", path: ["links"], message: "These contact details are too long." });
    }
  });

export type ResumeContent = z.output<typeof ResumeContentSchema>;
export type ResumeSection = ResumeContent["sections"][number];
export type ResumeItem = ResumeSection["items"][number];
export type ResumeBullet = ResumeItem["bullets"][number];
export type ResumeContact = z.output<typeof ResumeContactSchema>;

export const emptyResumeContent = (): ResumeContent => ({ version: 2, sections: [] });

const lineIndices = z.array(z.number()).describe("The [index] of every source line used for this part.");

const contactField = z.object({ value: z.string(), lineIndices });

/** The model's output. Every part says which source lines it came from (RE-REQ-014). */
export const ResumeParseSchema = z.object({
  contact: z.object({
    fullName: contactField.optional(),
    headline: contactField.optional().describe("The person's title or tagline under their name, if any."),
    email: contactField.optional(),
    phone: contactField.optional(),
    location: contactField.optional(),
    links: z.array(
      z.object({
        label: z.string().describe("e.g. LinkedIn, GitHub, Portfolio."),
        url: z.string(),
        lineIndices,
      }),
    ),
  }),
  sections: z.array(
    z.object({
      type: z.enum(RESUME_SECTION_TYPES),
      title: z.string().optional().describe("The section's heading as written. Required for `other`."),
      lineIndices,
      items: z.array(
        z.object({
          heading: z.string().optional().describe("e.g. role, degree, project, skill group."),
          subheading: z.string().optional().describe("e.g. company, school."),
          location: z.string().optional(),
          startDate: z.string().optional().describe("As written, never normalized."),
          endDate: z.string().optional().describe("As written, e.g. Present."),
          url: z.string().optional(),
          lineIndices,
          bullets: z.array(z.object({ text: z.string().min(1), lineIndices })),
        }),
      ),
    }),
  ),
});

export type ResumeParseOutput = z.infer<typeof ResumeParseSchema>;

const withId = <T extends object>(part: T): T & { id: string } => ({
  ...part,
  id: (part as { id?: string }).id ?? uuidv4(),
});

type SectionLike = { items: { bullets: object[] }[] };

type ItemWithIds<I extends SectionLike["items"][number]> = Omit<I, "bullets"> & {
  id: string;
  bullets: (I["bullets"][number] & { id: string })[];
};

export type SectionWithIds<S extends SectionLike> = Omit<S, "items"> & {
  id: string;
  items: ItemWithIds<S["items"][number]>[];
};

/** Gives every section, item and bullet without an id a new one (RE-REQ-003). */
export function withResumeIds<S extends SectionLike>(resume: { sections: S[] }): { sections: SectionWithIds<S>[] } {
  return {
    sections: resume.sections.map((section) => ({
      ...withId(section),
      items: section.items.map((item) => ({
        ...withId(item),
        bullets: item.bullets.map(withId),
      })),
    })) as unknown as SectionWithIds<S>[],
  };
}

// Version 1, for the background parse that stays until the cleanup
// (RE-REQ-022): messages already queued at deploy still write this shape.

export const ResumeSchema = z.object({
  sections: z.array(
    z.object({
      type: z.enum([
        "experience",
        "projects",
        "skills",
        "education",
        "summary",
        "achievements",
        "other",
      ]),
      items: z.array(
        z.object({
          heading: z.string().optional(),
          subheading: z.string().optional(),
          bullets: z.array(
            z.object({
              text: z.string().min(1),
              lineIndices: z
                .array(z.number())
                .describe("Original indices used for this text."),
            }),
          ),
        }),
      ),
    }),
  ),
});

/** Gives every bullet an id, as version 1 stores them. */
export function withBulletIds(profile: z.infer<typeof ResumeSchema>) {
  return {
    sections: profile.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        bullets: item.bullets.map((bullet) => ({ ...bullet, id: uuidv4() })),
      })),
    })),
  };
}
