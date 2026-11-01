import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

// The structured resume the parsers produce (`resumes.content`,
// `company_candidates.resume_content`): sections of items of bullets, each
// bullet with the source line indices it came from.

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

/** Gives every bullet an id, as the resume editor expects. */
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
