import { tool } from "ai";
import { z } from "zod";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  saveTemplate,
} from "@/helpers/pipeline/email-templates";
import { templateFields } from "@/helpers/pipeline/template-input";
import { TEMPLATE_PURPOSES, TEMPLATE_VARIABLES } from "@/helpers/pipeline/templates";
import { RA_TEMPLATE_EXCERPT_MAX_CHARS } from "../config";
import { type RecruiterToolContext, uuidInput, withToolErrors } from "./shared";

const VARIABLES = TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(", ");

/**
 * The email template tools (settings.templates), on top of
 * `helpers/pipeline/email-templates.ts`, shared with the template editor.
 * Templates are written by the team, so they aren't sandboxed.
 */
export function createTemplateTools(ctx: RecruiterToolContext) {
  return {
    listEmailTemplates: tool({
      description: `List the company's email templates (the emails moveApplications can send), with subject and message. Messages are trimmed to ${RA_TEMPLATE_EXCERPT_MAX_CHARS} characters unless you pass templateId, which returns that template in full.`,
      inputSchema: z.object({
        templateId: uuidInput("email template").optional(),
        purpose: z.enum(TEMPLATE_PURPOSES).optional(),
      }),
      execute: ({ templateId, purpose }) =>
        withToolErrors(ctx, "listEmailTemplates", async () => {
          const templates = (await listTemplates(ctx)).filter(
            (t) => (!templateId || t.id === templateId) && (!purpose || t.purpose === purpose),
          );
          if (templateId && templates.length === 0) return { error: "Template not found." };
          return {
            templates: templates.map((t) => ({
              id: t.id,
              name: t.name,
              purpose: t.purpose,
              isDefault: t.is_default,
              subject: t.subject,
              body: templateId ? t.body_md : t.body_md.slice(0, RA_TEMPLATE_EXCERPT_MAX_CHARS),
              ...(!templateId && t.body_md.length > RA_TEMPLATE_EXCERPT_MAX_CHARS ? { trimmed: true } : {}),
            })),
            variables: TEMPLATE_VARIABLES,
          };
        }),
    }),

    createEmailTemplate: tool({
      description: `Add an email template for a purpose (rejection, advance, interview_invite, offer, on_hold, reopen or custom), next to the default one. The message is markdown and may use only these variables: ${VARIABLES}. Write it as the company, with no promises the user didn't make.`,
      inputSchema: z.object({ purpose: z.enum(TEMPLATE_PURPOSES), ...templateFields }),
      execute: (input) =>
        withToolErrors(ctx, "createEmailTemplate", async () => {
          const result = await createTemplate(ctx, input, { source: "agent" });
          if (!result.ok) return refusal(result);
          const { template } = result;
          return { template: { id: template.id, name: template.name, purpose: template.purpose } };
        }),
    }),

    updateEmailTemplate: tool({
      description: `Edit one of the company's email templates (ids from listEmailTemplates; read it with templateId first). Fields left out stay the same. Only these variables work: ${VARIABLES}.`,
      inputSchema: z
        .object({
          templateId: uuidInput("email template"),
          name: templateFields.name.optional(),
          subject: templateFields.subject.optional(),
          body: templateFields.body.optional(),
        })
        .refine((v) => v.name !== undefined || v.subject !== undefined || v.body !== undefined, {
          message: "Pass at least one of name, subject or body.",
        }),
      execute: (input) =>
        withToolErrors(ctx, "updateEmailTemplate", async () => {
          const result = await saveTemplate(ctx, input, { source: "agent" });
          if (!result.ok) return refusal(result);
          return { templateId: input.templateId, updated: true };
        }),
    }),

    deleteEmailTemplate: tool({
      description:
        "Delete one of the company's own email templates (ids from listEmailTemplates), only when the user asks. Default templates can be edited but not deleted.",
      inputSchema: z.object({ templateId: uuidInput("email template") }),
      execute: ({ templateId }) =>
        withToolErrors(ctx, "deleteEmailTemplate", async () => {
          const result = await deleteTemplate(ctx, { templateId });
          if (!result.ok) return { error: result.error };
          return { templateId, deleted: true };
        }),
    }),
  };
}

function refusal(result: { error: string; unknownVariables?: string[] }) {
  return {
    error: result.error,
    ...(result.unknownVariables?.length ? { unknownVariables: result.unknownVariables } : {}),
  };
}
