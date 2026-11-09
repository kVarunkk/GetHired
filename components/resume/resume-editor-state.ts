import type { ResumeTemplate } from "@/helpers/resume/config";
import { isResumeDateBefore } from "@/helpers/resume/resume-dates";
import { ResumeContactSchema, ResumeContentSchema } from "@/helpers/resume/resume-schema";
import { runResumeOperations, type ResumeDraft, type ResumeOperation } from "@/helpers/resumes/resume-operations";

export type EditorDraft = ResumeDraft & { name: string; template: ResumeTemplate };

export type EditorAction = { type: "apply"; operations: ResumeOperation[] } | { type: "reset"; draft: EditorDraft };

/**
 * `after`, reusing every part of `before` that's equal. The operations clone the
 * whole draft, and the form's memoized parts need untouched sections to keep
 * their identity, or every keystroke re-renders all of them.
 */
function keepUnchanged<T>(before: T, after: T): T {
  if (Object.is(before, after)) return before;
  if (typeof before !== "object" || typeof after !== "object" || !before || !after) return after;
  if (Array.isArray(before) !== Array.isArray(after)) return after;

  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  const keys = Object.keys(next);
  const merged: Record<string, unknown> = Array.isArray(after) ? ([] as unknown as Record<string, unknown>) : {};
  for (const key of keys) merged[key] = keepUnchanged(previous[key], next[key]);

  const isSame = keys.length === Object.keys(previous).length && keys.every((key) => merged[key] === previous[key]);
  return isSame ? before : (merged as T);
}

/**
 * The editor's state runs on the same operations as the agent and MCP. They run
 * unvalidated here: a bullet is empty the moment it's added, and the save is
 * what has to be valid.
 */
export function editorReducer(state: EditorDraft, action: EditorAction): EditorDraft {
  if (action.type === "reset") return action.draft;

  const result = runResumeOperations(state, action.operations);
  if (!result.ok) return state;
  return keepUnchanged(state, {
    ...state,
    content: result.content,
    contact: result.contact,
    name: result.name ?? state.name,
    template: result.template ?? state.template,
  });
}

export type EditorIssue = {
  /** Dotted, as the fields look it up: `sections.0.items.1.bullets.2.text`. */
  path: string;
  message: string;
  /** A limit shows as it's passed. The rest wait for Save, so a new field isn't an error. */
  immediate: boolean;
};

/** The pickers stop this, but a resume can arrive with it from an upload, the agent or MCP. */
const dateOrderIssues = (draft: EditorDraft): EditorIssue[] =>
  draft.content.sections.flatMap((section, sectionIndex) =>
    section.items.flatMap((item, itemIndex) =>
      isResumeDateBefore(item.endDate, item.startDate)
        ? [
            {
              path: `sections.${sectionIndex}.items.${itemIndex}.endDate`,
              message: "The end date can't be before the start date.",
              immediate: true,
            },
          ]
        : [],
    ),
  );

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
    ...dateOrderIssues(draft),
  ];
}

export const isSameDraft = (a: EditorDraft, b: EditorDraft) => JSON.stringify(a) === JSON.stringify(b);
