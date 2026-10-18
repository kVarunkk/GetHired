"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, Trash } from "lucide-react";
import StickyActionBar from "@/components/StickyActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { saveQuestionSetAction } from "@/app/actions/question-sets/save-question-set";
import { deleteQuestionSetAction } from "@/app/actions/question-sets/delete-question-set";
import { applicationFormSchema, type ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { QUESTION_SETS_PATH } from "@/helpers/jobs/question-sets";
import ApplicationFormBuilder from "./ApplicationFormBuilder";

/**
 * AF-REQ-004: create or edit one question set (its questions, standard-field
 * toggles and knockout rules). Jobs it was applied to keep their own copy.
 */
export default function QuestionSetEditor({
  id,
  initialName = "",
  initialForm,
  readOnly = false,
}: {
  /** Set when editing an existing set. */
  id?: string;
  initialName?: string;
  initialForm: ApplicationForm;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [form, setForm] = useState<ApplicationForm>(initialForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = saving || deleting;

  const save = async () => {
    const checked = applicationFormSchema.safeParse(form);
    if (!checked.success) {
      toast.error(checked.error.issues[0]?.message ?? "Check the questions.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveQuestionSetAction({ ...(id ? { id } : {}), name: name.trim(), form: checked.data });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Saved “${result.set.name}”.`);
      router.push(QUESTION_SETS_PATH);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      const result = await deleteQuestionSetAction({ id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Question set deleted.");
      router.push(QUESTION_SETS_PATH);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-md flex-col gap-1.5">
        <Label htmlFor="question-set-name">Name</Label>
        <Input
          id="question-set-name"
          value={name}
          maxLength={80}
          placeholder="e.g. Engineering screen"
          disabled={readOnly || busy}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <ApplicationFormBuilder value={form} onChange={setForm} disabled={readOnly || busy} />

      {!readOnly && (
        <StickyActionBar className="justify-between">
          {id ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash className="mr-2 h-4 w-4" />}
                  Delete set
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete “{initialName}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Jobs that already use these questions keep their copy. This can&apos;t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => router.push(QUESTION_SETS_PATH)}>
              Cancel
            </Button>
            <Button type="button" variant="brand" disabled={busy || !name.trim()} onClick={() => void save()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {id ? "Save changes" : "Create set"}
            </Button>
          </div>
        </StickyActionBar>
      )}
    </div>
  );
}
