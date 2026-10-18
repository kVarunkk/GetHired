import { z } from "zod";

// CP-REQ-003/004/009/010: what a careers page shows beyond the company card.
// Client-safe: the editor and the save action validate with it. Bodies are
// markdown, rendered without raw HTML (CP-SEC-002).

export const MAX_PERKS = 12;
export const MAX_CUSTOM_SECTIONS = 3;
export const MAX_SECTION_BODY = 10000;

const https = z
  .string()
  .trim()
  .max(300)
  .url("Enter a full link.")
  .refine((v) => v.startsWith("https://"), "Links must start with https://.");

const sectionBase = { id: z.string().uuid(), hidden: z.boolean() };

export const careersSectionSchema = z.discriminatedUnion("kind", [
  // The About text is the company profile's description.
  z.object({ ...sectionBase, kind: z.literal("about") }).strict(),
  z
    .object({
      ...sectionBase,
      kind: z.literal("perks"),
      title: z.string().trim().min(1).max(60),
      items: z
        .array(
          z
            .object({ title: z.string().trim().min(1, "Every perk needs a title.").max(60), text: z.string().trim().max(300) })
            .strict(),
        )
        .max(MAX_PERKS, `Add up to ${MAX_PERKS} perks.`),
    })
    .strict(),
  z
    .object({
      ...sectionBase,
      kind: z.literal("custom"),
      title: z.string().trim().min(1, "Every section needs a title.").max(80),
      body: z.string().trim().max(MAX_SECTION_BODY, "Sections can be at most 10,000 characters."),
    })
    .strict(),
]);
export type CareersSection = z.infer<typeof careersSectionSchema>;

export const LINK_KEYS = ["linkedin", "x", "github", "instagram", "youtube"] as const;
export type LinkKey = (typeof LINK_KEYS)[number];
export const LINK_LABELS: Record<LinkKey, string> = {
  linkedin: "LinkedIn",
  x: "X",
  github: "GitHub",
  instagram: "Instagram",
  youtube: "YouTube",
};

export const careersLinksSchema = z
  .object(Object.fromEntries(LINK_KEYS.map((k) => [k, https.optional()])) as Record<LinkKey, z.ZodOptional<typeof https>>)
  .strict();
export type CareersLinks = z.infer<typeof careersLinksSchema>;

const ACCENT = /^#[0-9a-f]{6}$/;

/** WCAG relative luminance of #rrggbb. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The page backgrounds the accent sits on (light and dark themes). */
export const LIGHT_BG = "#ffffff";
export const DARK_BG = "#0a0a0a";
/** White text on accent buttons in light mode; the accent as text on dark. */
export const MIN_LIGHT_CONTRAST = 3;
export const MIN_DARK_CONTRAST = 2;

/**
 * CP-REQ-009 / CP-SEC-003: `#rrggbb` only, readable on both themes. Buttons
 * use white text on the accent, links use it on the dark background.
 */
export function accentError(hex: string): string | null {
  if (!ACCENT.test(hex)) return "Use a colour like #4f46e5.";
  if (contrast(hex, LIGHT_BG) < MIN_LIGHT_CONTRAST) return "That colour is too light to read on a white page. Pick a darker one.";
  if (contrast(hex, DARK_BG) < MIN_DARK_CONTRAST) return "That colour is too dark to read in dark mode. Pick a lighter one.";
  return null;
}

export const careersPageSchema = z
  .object({
    accentColor: z
      .string()
      .trim()
      .toLowerCase()
      .nullable()
      .superRefine((v, ctx) => {
        const error = v === null ? null : accentError(v);
        if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
      }),
    coverUrl: https.nullable(),
    sections: z
      .array(careersSectionSchema)
      .max(1 + 1 + MAX_CUSTOM_SECTIONS)
      .superRefine((sections, ctx) => {
        const count = (kind: CareersSection["kind"]) => sections.filter((s) => s.kind === kind).length;
        if (count("about") > 1 || count("perks") > 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A page has one About and one Perks section." });
        }
        if (count("custom") > MAX_CUSTOM_SECTIONS) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Add up to ${MAX_CUSTOM_SECTIONS} custom sections.` });
        }
        if (new Set(sections.map((s) => s.id)).size !== sections.length) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each section needs its own id." });
        }
      }),
    links: careersLinksSchema,
  })
  .strict();
export type CareersPageInput = z.input<typeof careersPageSchema>;
export type CareersPageValues = z.output<typeof careersPageSchema>;

/** Reads stored sections, dropping any that don't validate. */
export function readSections(raw: unknown): CareersSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    const parsed = careersSectionSchema.safeParse(s);
    return parsed.success ? [parsed.data] : [];
  });
}

export function readLinks(raw: unknown): CareersLinks {
  if (!raw || typeof raw !== "object") return {};
  const out: CareersLinks = {};
  for (const key of LINK_KEYS) {
    const parsed = https.safeParse((raw as Record<string, unknown>)[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}
