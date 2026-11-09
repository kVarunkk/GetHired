"use client";

import { useCallback, useDeferredValue, useMemo, useReducer, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { dismissResumeNotesAction } from "@/app/actions/resumes/dismiss-resume-notes";
import { saveResumeAction } from "@/app/actions/resumes/save-resume";
import StickyActionBar from "@/components/StickyActionBar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildResumeDocument } from "@/helpers/resume/render/document";
import type { ResumeOperation } from "@/helpers/resumes/resume-operations";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { cn } from "@/utils/utils";
import { editorIssues, editorReducer, isSameDraft, type EditorDraft } from "./resume-editor-state";
import ResumeForm, { type FieldErrors } from "./ResumeForm";
import ResumePreview from "./ResumePreview";
import { usePreviewSync } from "./use-preview-sync";

/** Marks the smallest part under the mouse, the one the form will scroll to. */
const LINKED_PREVIEW_CLASSES =
  "lg:[&_[data-resume-target]]:rounded-sm lg:[&_[data-resume-target]]:transition-colors lg:[&_[data-resume-target]:hover:not(:has([data-resume-target]:hover))]:bg-muted";

function ParseNotesNotice({ resumeId, lines }: { resumeId: string; lines: string[] }) {
  const [dismissed, setDismissed] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  if (dismissed) return null;

  const dismiss = async () => {
    setIsDismissing(true);
    const result = await dismissResumeNotesAction({ resumeId }).catch(() => null);
    setIsDismissing(false);
    if (result?.ok) setDismissed(true);
    else toast.error(result?.error ?? "Couldn't dismiss this. Please try again.");
  };

  return (
    <Alert>
      <AlertTitle>These lines from your file weren&apos;t added</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 list-disc pl-4">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" className="mt-3" disabled={isDismissing} onClick={dismiss}>
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export default function ResumeEditor({
  resumeId,
  initial,
  revision: initialRevision,
  unusedLines = [],
}: {
  resumeId: string;
  initial: EditorDraft;
  revision: number;
  unusedLines?: string[];
}) {
  const [draft, dispatch] = useReducer(editorReducer, initial);
  const [saved, setSaved] = useState(initial);
  const [revision, setRevision] = useState(initialRevision);
  const [isSaving, setIsSaving] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [activeBulletId, setActiveBulletId] = useState<string | null>(null);
  const [view, setView] = useState<"edit" | "preview">("edit");

  const bypassGuard = useRef(false);
  // Validating, comparing and the preview all read this, so they run after the
  // keystroke has painted and never hold up typing.
  const settledDraft = useDeferredValue(draft);
  const isDirty = useMemo(() => !isSameDraft(settledDraft, saved), [settledDraft, saved]);
  useUnsavedChangesGuard(isDirty, bypassGuard);
  const { formRef, previewRef, onFormFocus, onPreviewMouseMove, onPreviewMouseLeave, hoverScroll, setHoverScroll } =
    usePreviewSync();

  const issues = useMemo(() => editorIssues(settledDraft), [settledDraft]);
  // Keyed by content: the form's memoized parts need the same Map until a message changes.
  const errorEntries = JSON.stringify(
    issues
      .filter((issue) => saveAttempted || issue.immediate)
      .reverse()
      .map((issue) => [issue.path, issue.message]),
  );
  const errors: FieldErrors = useMemo(() => new Map(JSON.parse(errorEntries)), [errorEntries]);

  const preview = useMemo(
    () => (
      <ResumePreview
        document={buildResumeDocument({
          contact: settledDraft.contact,
          content: settledDraft.content,
          template: settledDraft.template,
        })}
        activeBulletId={activeBulletId}
      />
    ),
    [settledDraft, activeBulletId],
  );

  const apply = useCallback((...operations: ResumeOperation[]) => dispatch({ type: "apply", operations }), []);

  const save = async () => {
    setSaveAttempted(true);
    setSaveError(null);
    // The latest draft, not the settled one: Save can land before validation catches up.
    if (editorIssues(draft).length > 0) {
      setSaveError("Fix the highlighted fields to save.");
      return;
    }

    setIsSaving(true);
    const submitted = draft;
    try {
      const result = await saveResumeAction({
        resumeId,
        expectedRevision: revision,
        contact: submitted.contact,
        content: submitted.content,
        name: submitted.name,
        template: submitted.template,
      });

      if (result.ok) {
        setSaved(submitted);
        setRevision(result.revision);
        setSaveAttempted(false);
        toast.success("Resume saved.");
      } else if (result.code === "RESUME_CHANGED") {
        setChangedElsewhere(true);
      } else {
        setSaveError(result.error);
      }
    } catch {
      setSaveError("We couldn't save your changes. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const discard = () => {
    dispatch({ type: "reset", draft: saved });
    setSaveAttempted(false);
    setSaveError(null);
  };

  const reload = () => {
    bypassGuard.current = true;
    window.location.reload();
  };

  return (
    <div className="flex flex-col gap-6">
      {unusedLines.length > 0 && <ParseNotesNotice resumeId={resumeId} lines={unusedLines} />}

      {changedElsewhere && (
        <Alert variant="destructive">
          <AlertTitle>This resume changed somewhere else</AlertTitle>
          <AlertDescription>
            Reload to get the latest version. The changes on this page will be lost.
            <Button type="button" variant="outline" size="sm" className="mt-3 block" onClick={reload}>
              Reload
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={view} onValueChange={(value) => setView(value as "edit" | "preview")} className="lg:hidden">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div ref={formRef} onFocus={onFormFocus} className={cn("min-w-0", view === "preview" && "hidden lg:block")}>
          <ResumeForm draft={draft} apply={apply} errors={errors} onFocusBullet={setActiveBulletId} />
        </div>
        {/* Its own scroll area, so all of it can be read wherever the form is. */}
        <div
          ref={previewRef}
          onMouseMove={onPreviewMouseMove}
          onMouseLeave={onPreviewMouseLeave}
          className={cn(
            "min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem-var(--sticky-action-bar-height,4rem))] lg:overflow-y-auto",
            hoverScroll && LINKED_PREVIEW_CLASSES,
            view === "edit" && "hidden lg:block",
          )}
        >
          {preview}
        </div>
      </div>

      <StickyActionBar>
        <Button type="button" variant="brand" disabled={!isDirty || isSaving || changedElsewhere} onClick={save}>
          {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" disabled={!isDirty || isSaving}>
              Discard
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
              <AlertDialogDescription>This goes back to the last saved version of this resume.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction onClick={discard}>Discard changes</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {saveError ? (
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
        ) : (
          isDirty && <p className="text-sm text-muted-foreground">Unsaved changes</p>
        )}
        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <Switch id="resume-hover-scroll" checked={hoverScroll} onCheckedChange={setHoverScroll} />
          <Label htmlFor="resume-hover-scroll">Scroll form on hover</Label>
        </div>
      </StickyActionBar>
    </div>
  );
}
