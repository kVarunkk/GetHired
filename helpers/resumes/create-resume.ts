import { v4 as uuidv4 } from "uuid";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/utils/types/database.types";
import { z } from "zod";
import {
  RESUME_BLANK_SECTIONS,
  RESUME_DEFAULT_TEMPLATE,
  RESUME_LIMITS,
  RESUME_SECTION_TYPES,
} from "@/helpers/resume/config";
import {
  ResumeContactSchema,
  ResumeContentSchema,
  normalizeResumeUrl,
  withResumeIds,
  type ResumeContact,
  type ResumeContent,
} from "@/helpers/resume/resume-schema";
import { RESUME_LIMIT_ERROR, hasRoomForResume } from "./resume-limit";

export const RESUME_DEFAULT_NAME = "Untitled resume";

export type CreateResumeInput = { name?: string; content?: ResumeContent };

/** A resume as the agent gives it from what the user said in chat: no ids yet. */
export const ResumeFromChatSchema = z.object({
  name: z.string().trim().min(1).max(RESUME_LIMITS.shortFieldChars).optional(),
  sections: z
    .array(
      z.object({
        type: z.enum(RESUME_SECTION_TYPES),
        title: z.string().optional().describe("The heading as the user wrote it. Required for type 'other'."),
        items: z.array(
          z.object({
            heading: z.string().optional().describe("A role, degree, project or skill group."),
            subheading: z.string().optional().describe("A company or school."),
            location: z.string().optional(),
            startDate: z.string().optional().describe("As the user wrote it, e.g. 'Jan 2022'."),
            endDate: z.string().optional().describe("As the user wrote it, e.g. 'Present'."),
            url: z.string().optional(),
            bullets: z.array(z.string()),
          }),
        ),
      }),
    )
    .optional()
    .describe("Only what the user gave you. Leave out for a blank resume."),
});

export type ResumeFromChat = z.infer<typeof ResumeFromChatSchema>;

/** Chat sections as resume content, with new ids. `createResume` still validates it. */
export const contentFromChat = (sections: NonNullable<ResumeFromChat["sections"]>): ResumeContent => ({
  version: 2,
  ...withResumeIds({
    sections: sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({ ...item, bullets: item.bullets.map((text) => ({ text })) })),
    })),
  }),
});

export type CreateResumeResult = { ok: true; resumeId: string } | { ok: false; error: string };

const blankContent = (): ResumeContent => ({
  version: 2,
  sections: RESUME_BLANK_SECTIONS.map((type) => ({ id: uuidv4(), type, items: [] })),
});

/** What the profile already knows, so a blank resume doesn't start from nothing. */
export async function contactFromProfile(supabase: SupabaseClient<Database>, userId: string): Promise<ResumeContact> {
  const { data: profile } = await supabase
    .from("user_info")
    .select("full_name, email, linkedin_url, github_url")
    .eq("user_id", userId)
    .maybeSingle();

  const links = [
    { label: "LinkedIn", url: normalizeResumeUrl(profile?.linkedin_url) },
    { label: "GitHub", url: normalizeResumeUrl(profile?.github_url) },
  ].flatMap(({ label, url }) => (url ? [{ label, url }] : []));

  const contact = { fullName: profile?.full_name ?? "", email: profile?.email ?? undefined, links };
  const parsed = ResumeContactSchema.safeParse(contact);
  if (parsed.success) return parsed.data;
  // A profile value the resume can't hold mustn't stop the resume being made.
  return { fullName: "", links: [] };
}

/** A new resume, free, from blank sections or validated content (RE-REQ-035). */
export async function createResume(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  { name, content }: CreateResumeInput = {},
): Promise<CreateResumeResult> {
  const given = content === undefined ? null : ResumeContentSchema.safeParse(content);
  if (given && !given.success) return { ok: false, error: given.error.issues[0]?.message ?? "This resume isn't valid." };

  if (!(await hasRoomForResume(supabase, user.id))) return { ok: false, error: RESUME_LIMIT_ERROR };

  const { data, error } = await supabase
    .from("resumes")
    .insert({
      user_id: user.id,
      name: name?.trim() || RESUME_DEFAULT_NAME,
      is_primary: false,
      schema_version: 2,
      template: RESUME_DEFAULT_TEMPLATE,
      content: (given?.data ?? blankContent()) as unknown as Json,
      contact: (await contactFromProfile(supabase, user.id)) as unknown as Json,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "We couldn't create this resume. Please try again." };

  return { ok: true, resumeId: data.id };
}
