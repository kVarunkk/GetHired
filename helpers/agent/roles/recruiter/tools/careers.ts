import { tool } from "ai";
import { z } from "zod";
import { claimCareersSlug, saveCareersPage, setCareersPublished } from "@/helpers/careers/careers-writes";
import { toCareersPage, type CareersPage } from "@/helpers/careers/get-careers-page";
import {
  LINK_KEYS,
  MAX_CUSTOM_SECTIONS,
  MAX_PERKS,
  MAX_SECTION_BODY,
  type CareersLinks,
  type CareersSection,
} from "@/helpers/careers/page-schema";
import { careersPath } from "@/helpers/careers/slug";
import { fairnessError, type RecruiterToolContext, withToolErrors } from "./shared";

export const CAREERS_EDITOR_URL = "/company/settings/careers";

const NO_PAGE = {
  error: "The company doesn't have a careers page address yet. Claim one with setCareersAddress, or open the careers page settings.",
  url: CAREERS_EDITOR_URL,
} as const;

/** The page as the model sees it: no section ids, which the tool keeps itself. */
function compactPage(page: CareersPage) {
  return {
    address: careersPath(page.slug),
    published: page.published,
    accentColor: page.accentColor,
    coverUrl: page.coverUrl,
    sections: page.sections.map((section) => {
      const { id, ...rest } = section;
      void id;
      return rest;
    }),
    links: page.links,
    // The About section shows the company profile's description.
    about: page.description,
    editorUrl: CAREERS_EDITOR_URL,
  };
}

const https = z.string().trim().max(300).url().startsWith("https://");

const sectionInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("about"), hidden: z.boolean().optional() }).strict(),
  z
    .object({
      kind: z.literal("perks"),
      title: z.string().trim().min(1).max(60),
      items: z
        .array(z.object({ title: z.string().trim().min(1).max(60), text: z.string().trim().max(300) }).strict())
        .max(MAX_PERKS),
      hidden: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("custom"),
      title: z.string().trim().min(1).max(80),
      body: z.string().trim().max(MAX_SECTION_BODY).describe("Markdown, without raw HTML."),
      hidden: z.boolean().optional(),
    })
    .strict(),
]);
type SectionInput = z.infer<typeof sectionInput>;

/**
 * The new section list with ids: About and Perks keep theirs, custom
 * sections reuse the current ones' ids in order, and new ones get fresh ids.
 */
function withSectionIds(current: CareersSection[], next: SectionInput[]): CareersSection[] {
  const customIds = current.filter((s) => s.kind === "custom").map((s) => s.id);
  let custom = 0;
  return next.map((section) => {
    const id =
      section.kind === "custom"
        ? (customIds[custom++] ?? crypto.randomUUID())
        : (current.find((s) => s.kind === section.kind)?.id ?? crypto.randomUUID());
    return { ...section, id, hidden: section.hidden ?? false } as CareersSection;
  });
}

/** Links merged onto the current ones; null removes one. */
function mergeLinks(current: CareersLinks, changes: Partial<Record<keyof CareersLinks, string | null>>): CareersLinks {
  const out: CareersLinks = { ...current };
  for (const key of LINK_KEYS) {
    if (!(key in changes)) continue;
    const value = changes[key];
    if (value) out[key] = value;
    else delete out[key];
  }
  return out;
}

/**
 * CP spec: the agent reads and edits the careers page through the same
 * helpers as the editor (helpers/careers/careers-writes.ts), so the RPCs'
 * careers.edit check, validation and cache revalidation apply unchanged.
 * Every write asks first. The cover image is uploaded in the editor only.
 */
export function createCareersTools(ctx: RecruiterToolContext) {
  const { supabase, company } = ctx;

  const loadPage = async () => {
    const { data, error } = await supabase.rpc("get_my_careers_page");
    if (error) throw new Error(`get_my_careers_page failed: ${error.message}`);
    return toCareersPage(data);
  };

  return {
    getCareersPage: tool({
      description:
        "Read the company's careers page: its address, whether it's published, the accent colour, cover, sections (About, Perks, up to 3 custom sections) and social links. It lists the company's active jobs automatically.",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "getCareersPage", async () => {
          const page = await loadPage();
          return page ? compactPage(page) : NO_PAGE;
        }),
    }),

    updateCareersPage: tool({
      description:
        "Edit the careers page. Pass only what changes. sections replaces the whole list, in display order (at most one About, one Perks and 3 custom sections; About shows the company profile's description). links are merged; null removes one. accentColor is #rrggbb and must be readable on light and dark pages; null resets it.",
      inputSchema: z
        .object({
          accentColor: z.string().trim().nullable().optional().describe("A #rrggbb colour, or null for the default."),
          coverUrl: https.nullable().optional().describe("null removes the cover. New covers are uploaded in the editor."),
          sections: z.array(sectionInput).max(2 + MAX_CUSTOM_SECTIONS).optional(),
          links: z
            .object(
              Object.fromEntries(LINK_KEYS.map((k) => [k, https.nullable().optional()])) as Record<
                (typeof LINK_KEYS)[number],
                z.ZodOptional<z.ZodNullable<typeof https>>
              >,
            )
            .strict()
            .optional()
            .describe("https links to the company's profiles; null removes one."),
        })
        .strict()
        .refine((input) => Object.keys(input).length > 0, { message: "Pass at least one field to change." }),
      execute: (changes) =>
        withToolErrors(ctx, "updateCareersPage", async () => {
          const unfair = fairnessError(
            (changes.sections ?? []).flatMap((s) =>
              s.kind === "custom" ? [s.title, s.body] : s.kind === "perks" ? [s.title, ...s.items.flatMap((i) => [i.title, i.text])] : [],
            ),
            "job_post",
          );
          if (unfair) return unfair;

          const page = await loadPage();
          if (!page) return NO_PAGE;
          const result = await saveCareersPage(supabase, company.id, {
            accentColor: changes.accentColor !== undefined ? changes.accentColor : page.accentColor,
            coverUrl: changes.coverUrl !== undefined ? changes.coverUrl : page.coverUrl,
            sections: changes.sections ? withSectionIds(page.sections, changes.sections) : page.sections,
            links: changes.links ? mergeLinks(page.links, changes.links) : page.links,
          });
          if (!result.ok) return { error: result.error };
          return { updated: Object.keys(changes), address: careersPath(page.slug), editorUrl: CAREERS_EDITOR_URL };
        }),
    }),

    setCareersAddress: tool({
      description:
        "Change the careers page address (/careers/<slug>): 3 to 40 lowercase letters, numbers and single dashes. The old address keeps redirecting and stays reserved for 90 days.",
      inputSchema: z.object({ slug: z.string().trim().max(60) }).strict(),
      execute: ({ slug }) =>
        withToolErrors(ctx, "setCareersAddress", async () => {
          const result = await claimCareersSlug(supabase, company.id, slug);
          if (!result.ok) return { error: result.error };
          return { address: careersPath(result.slug), editorUrl: CAREERS_EDITOR_URL };
        }),
    }),

    setCareersPublished: tool({
      description: "Publish or unpublish the careers page. Unpublished, its address shows nothing to the public.",
      inputSchema: z.object({ published: z.boolean() }).strict(),
      execute: ({ published }) =>
        withToolErrors(ctx, "setCareersPublished", async () => {
          const result = await setCareersPublished(supabase, company.id, published);
          if (!result.ok) return { error: result.error };
          const page = await loadPage();
          return { published, ...(page ? { address: careersPath(page.slug) } : {}), editorUrl: CAREERS_EDITOR_URL };
        }),
    }),
  };
}
