"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildResumeDocument } from "@/helpers/resume/render/document";
import type { ResumeOperation } from "@/helpers/resumes/resume-operations";
import { cn } from "@/utils/utils";
import { editorIssues, editorReducer, isSameDraft, type EditorDraft } from "./resume-editor-state";
import ResumeForm, { type FieldErrors } from "./ResumeForm";
import ResumePreview from "./ResumePreview";

const LEAVE_WARNING = "You have unsaved changes. Leave without saving?";

/** Warns before the tab closes or an in-app link leaves the editor (RE-REQ-032). */
function useUnsavedChangesGuard(isDirty: boolean, bypass: React.RefObject<boolean>) {
  useEffect(() => {
    if (!isDirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current) return;
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      if (!window.confirm(LEAVE_WARNING)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [isDirty, bypass]);
}

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
  const isDirty = !isSameDraft(draft, saved);
  useUnsavedChangesGuard(isDirty, bypassGuard);

  const issues = useMemo(() => editorIssues(draft), [draft]);
  const errors: FieldErrors = useMemo(
    () =>
      new Map(
        issues
          .filter((issue) => saveAttempted || issue.immediate)
          .reverse()
          .map((issue) => [issue.path, issue.message]),
      ),
    [issues, saveAttempted],
  );

  const document = useMemo(
    () => buildResumeDocument({ contact: draft.contact, content: draft.content, template: draft.template }),
    [draft],
  );

  const apply = (...operations: ResumeOperation[]) => dispatch({ type: "apply", operations });

  const save = async () => {
    setSaveAttempted(true);
    setSaveError(null);
    if (issues.length > 0) {
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
        <div className={cn("min-w-0", view === "preview" && "hidden lg:block")}>
          <ResumeForm draft={draft} apply={apply} errors={errors} onFocusBullet={setActiveBulletId} />
        </div>
        <div className={cn("min-w-0 lg:sticky lg:top-4", view === "edit" && "hidden lg:block")}>
          <ResumePreview document={document} activeBulletId={activeBulletId} />
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
      </StickyActionBar>
    </div>
  );
}
