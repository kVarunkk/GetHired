import { tool } from "ai";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { getCompanyFunnel, getJobFunnel, NEEDS_ATTENTION_DAYS } from "@/helpers/pipeline/funnel";
import { moveApplications, type MoveEmail } from "@/helpers/pipeline/move";
import { addNote, listNotes, ratingSummary } from "@/helpers/pipeline/notes";
import { mentionsToText } from "@/helpers/team/mentions";
import { listStages } from "@/helpers/pipeline/stages";
import { statusForKind } from "@/helpers/pipeline/status-map";
import { addToTalentList, createTalentList, listTalentLists } from "@/helpers/pipeline/talent-lists";
import { MAX_TEMPLATE_BODY, MAX_TEMPLATE_SUBJECT } from "@/helpers/pipeline/templates";
import { Constants } from "@/utils/types/database.types";
import { slugifyListName, talentListPath } from "@/utils/talent-list-tabs";
import {
  RA_FUNNEL_MAX_JOBS,
  RA_MAX_BULK_APPLICATIONS,
  RA_MAX_NOTE_CHARS,
  RA_MAX_TALENT_LISTS,
  RA_NOTE_EXCERPT_MAX_CHARS,
  RA_NOTES_LISTED,
} from "../config";
import {
  applicationUrl,
  jobPostUrl,
  type RecruiterToolContext,
  uuidInput,
  withToolErrors,
} from "./shared";

const JOB_NOT_FOUND = { error: "Job post not found." } as const;

/** Exactly one of a candidate or an application. */
const noteTarget = z.object({
  candidateId: uuidInput("candidate").optional(),
  applicationId: uuidInput("application").optional(),
});
const oneTarget = (value: z.infer<typeof noteTarget>) =>
  (value.candidateId === undefined) !== (value.applicationId === undefined);
const ONE_TARGET = { message: "Pass either candidateId or applicationId, not both." };

/** moveApplications' input, shared with the approval card's preview (`previewAgentMoveAction`). */
export const moveApplicationsInput = z.object({
  applicationIds: z.array(uuidInput("application")).min(1).max(RA_MAX_BULK_APPLICATIONS),
  stageId: uuidInput("stage"),
  email: z
    .object({
      templateId: uuidInput("email template"),
      subject: z.string().trim().min(1).max(MAX_TEMPLATE_SUBJECT).optional(),
      body: z.string().trim().min(1).max(MAX_TEMPLATE_BODY).optional(),
    })
    .optional(),
});

/** The tool's email input as `moveApplications` takes it. */
export function toMoveEmail(email: z.infer<typeof moveApplicationsInput>["email"]): MoveEmail | undefined {
  if (!email) return undefined;
  const { templateId, subject, body } = email;
  return subject || body ? { templateId, overrides: { subject, body } } : { templateId };
}

/** The pipeline tools (RA-TASK-040), on top of `helpers/pipeline/*` (RA-CON-003). */
export function createPipelineTools(ctx: RecruiterToolContext) {
  const { supabase, company } = ctx;

  return {
    listStages: tool({
      description:
        "List the company's hiring pipeline stages in order, with the status candidates see in each, and the company's email templates (for moveApplications' email).",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "listStages", async () => {
          const [stages, { data: templates, error }] = await Promise.all([
            listStages(ctx),
            supabase
              .from("company_email_templates")
              .select("id, name, purpose, is_default")
              .eq("company_id", company.id)
              .order("purpose", { ascending: true }),
          ]);
          if (error) throw error;
          return {
            stages: stages.map((s) => ({
              id: s.id,
              name: s.name,
              kind: s.kind,
              candidateSees: statusForKind(s.kind),
            })),
            emailTemplates: (templates ?? []).map((t) => ({
              id: t.id,
              name: t.name,
              purpose: t.purpose,
              isDefault: t.is_default,
            })),
          };
        }),
    }),

    moveApplications: tool({
      description: `Move up to ${RA_MAX_BULK_APPLICATIONS} applications to the company's jobs into a pipeline stage (ids from listStages). With email, the candidates whose visible status changes get the template's email; subject and body replace the template's text and may use its {{variables}}.`,
      inputSchema: moveApplicationsInput,
      execute: ({ applicationIds, stageId, email }) =>
        withToolErrors(ctx, "moveApplications", async () => {
          const result = await moveApplications(ctx, {
            applicationIds,
            stageId,
            email: toMoveEmail(email),
          });
          if (!result.ok) {
            return {
              error: result.error,
              ...(result.unknownVariables?.length ? { unknownVariables: result.unknownVariables } : {}),
              ...(result.missingVariables?.length ? { missingVariables: result.missingVariables } : {}),
            };
          }
          return {
            stage: { id: result.stage.id, name: result.stage.name },
            moved: result.moved,
            emailed: result.emailed,
            skipped: result.skipped,
          };
        }),
    }),

    addNote: tool({
      description:
        "Add a note, optionally with a rating, on a candidate or on an application to the company's jobs. Notes are for the hiring team: job-related observations only, never protected characteristics.",
      inputSchema: noteTarget
        .extend({
          body: z.string().trim().min(1).max(RA_MAX_NOTE_CHARS),
          rating: z.enum(Constants.public.Enums.candidate_rating).optional(),
        })
        .refine(oneTarget, ONE_TARGET),
      execute: ({ candidateId, applicationId, body, rating }) =>
        withToolErrors(ctx, "addNote", async () => {
          const result = await addNote(ctx, {
            body,
            rating: rating ?? null,
            ...(applicationId ? { applicationId } : { candidateUserId: candidateId }),
          });
          if (!result.ok) return { error: result.error };
          return {
            noteId: result.note.id,
            rating: result.note.rating,
            ...(result.note.application_id
              ? { url: applicationUrl(result.note.application_id) }
              : {}),
          };
        }),
    }),

    listNotes: tool({
      description:
        "Read the team's notes and ratings on a candidate or on one application, newest first, with a rating summary.",
      inputSchema: noteTarget.refine(oneTarget, ONE_TARGET),
      execute: ({ candidateId, applicationId }) =>
        withToolErrors(ctx, "listNotes", async () => {
          const notes = await listNotes(
            ctx,
            applicationId ? { applicationId } : { candidateUserId: candidateId! },
          );
          return {
            total: notes.length,
            ratings: ratingSummary(notes),
            notes: notes.slice(0, RA_NOTES_LISTED).map((note) => ({
              id: note.id,
              author: note.author_name,
              rating: note.rating,
              createdAt: note.created_at,
              // Team-written, but notes may quote candidates (RA-SEC-003).
              body: wrapInSandbox("candidate_note", mentionsToText(note.body).slice(0, RA_NOTE_EXCERPT_MAX_CHARS)),
            })),
          };
        }),
    }),

    addToTalentList: tool({
      description: `Add a talent-pool candidate (a public profile, e.g. from searchCandidates or findMatchesForJob) to one of the company's named talent lists, creating the list if it doesn't exist (up to ${RA_MAX_TALENT_LISTS} lists). Applicants with private profiles can't be added; they stay in their job's pipeline. Adding someone twice does nothing.`,
      inputSchema: z.object({
        candidateId: uuidInput("candidate"),
        listName: z.string().trim().min(1).max(60),
      }),
      execute: ({ candidateId, listName }) =>
        withToolErrors(ctx, "addToTalentList", async () => {
          const lists = await listTalentLists(ctx, { candidateUserId: candidateId });
          // Same slug, same list: "backend shortlist" finds "Backend Shortlist".
          const slug = slugifyListName(listName);
          let list = lists.find((l) => l.slug === slug);
          let created = false;
          if (!list) {
            if (lists.length >= RA_MAX_TALENT_LISTS) {
              return {
                error: `The company already has ${RA_MAX_TALENT_LISTS} talent lists. Add the candidate to an existing one: ${lists.map((l) => l.name).join(", ")}.`,
              };
            }
            const result = await createTalentList(ctx, listName);
            if (!result.ok) return { error: result.error };
            const { id, name } = result.list;
            list = { id, name, slug: result.list.slug, memberCount: 0, hasCandidate: false };
            created = true;
          }

          const alreadyIn = list.hasCandidate;
          if (!alreadyIn) {
            const result = await addToTalentList(ctx, list.id, candidateId);
            if (!result.ok) return { error: result.error };
          }
          return {
            list: { id: list.id, name: list.name },
            created,
            added: !alreadyIn,
            url: talentListPath(list.slug),
          };
        }),
    }),

    getHiringFunnel: tool({
      description: `The hiring funnel. For one job: applications in each pipeline stage, the share that reached each step, median days per stage, sources and time to hire. Without a job: stage totals across active jobs, each job's counts, and applications waiting in Applied for more than ${NEEDS_ATTENTION_DAYS} days.`,
      inputSchema: z.object({ jobPostId: uuidInput("job post").optional() }),
      execute: ({ jobPostId }) =>
        withToolErrors(ctx, "getHiringFunnel", async () => {
          if (jobPostId) {
            const funnel = await getJobFunnel(supabase, jobPostId);
            if (!funnel) return JOB_NOT_FOUND;
            return {
              jobPostId,
              total: funnel.total,
              stages: funnel.stages.map((s) => ({
                name: s.name,
                kind: s.kind,
                count: s.count,
                reached: s.reached,
                conversion: s.conversion === null ? null : Math.round(s.conversion * 100) / 100,
                medianDays: s.medianDays,
              })),
              sources: funnel.sources,
              timeToHireDays: funnel.timeToHireDays,
              url: jobPostUrl(jobPostId),
            };
          }

          const funnel = await getCompanyFunnel(ctx);
          return {
            stages: funnel.stages.map((s) => ({ name: s.name, kind: s.kind, count: s.count })),
            jobs: funnel.jobs.slice(0, RA_FUNNEL_MAX_JOBS).map((job) => ({
              jobPostId: job.jobPostId,
              title: job.title,
              total: job.total,
              byStage: Object.fromEntries(job.stages.map((s) => [s.name, s.count])),
              url: jobPostUrl(job.jobPostId),
            })),
            needsAttention: funnel.needsAttention.map((item) => ({
              applicationId: item.applicationId,
              name: item.name,
              jobTitle: item.jobTitle,
              daysInApplied: item.daysInApplied,
              url: applicationUrl(item.applicationId),
            })),
          };
        }),
    }),
  };
}
