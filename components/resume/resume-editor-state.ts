import type { ResumeTemplate } from "@/helpers/resume/config";
import { ResumeContactSchema, ResumeContentSchema } from "@/helpers/resume/resume-schema";
import { runResumeOperations, type ResumeDraft, type ResumeOperation } from "@/helpers/resumes/resume-operations";

export type EditorDraft = ResumeDraft & { name: string; template: ResumeTemplate };

export type EditorAction = { type: "apply"; operations: ResumeOperation[] } | { type: "reset"; draft: EditorDraft };

/**
 * The editor's state runs on the same operations as the agent and MCP. They run
 * unvalidated here: a bullet is empty the moment it's added, and the save is
 * what has to be valid.
 */
export function editorReducer(state: EditorDraft, action: EditorAction): EditorDraft {
  if (action.type === "reset") return action.draft;

  const result = runResumeOperations(state, action.operations);
  return result.ok ? { ...state, content: result.content, contact: result.contact, name: result.name ?? state.name, template: result.template ?? state.template } : state;
}

export type EditorIssue = {
  /** Dotted, as the fields look it up: `sections.0.items.1.bullets.2.text`. */
  path: string;
  message: string;
  /** A limit shows as it's passed. The rest wait for Save, so a new field isn't an error. */
  immediate: boolean;
};

export function editorIssues(draft: EditorDraft): EditorIssue[] {
  const content = ResumeContentSchema.safeParse(draft.content);
  const contact = ResumeContactSchema.safeParse(draft.contact);

  return [
    ...(draft.name.trim() ? [] : [{ path: "name", message: "Give this resume a name.", immediate: false }]),
    ...(contact.success ? [] : contact.error.issues).map((issue) => ({
      path: ["contact", ...issue.path].join("."),
      message: issue.message,
      immediate: issue.code === "too_big",
    })),
    ...(content.success ? [] : content.error.issues).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      immediate: issue.code === "too_big",
    })),
  ];
}

export const isSameDraft = (a: EditorDraft, b: EditorDraft) => JSON.stringify(a) === JSON.stringify(b);
