"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listQuestionSetsAction } from "@/app/actions/question-sets/list-question-sets";
import { copyQuestionSet, QUESTION_SETS_PATH, type QuestionSet } from "@/helpers/jobs/question-sets";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";

/**
 * AF-REQ-004: apply a saved question set to the job (a copy: later edits to
 * the set don't change the job). Sets are created and edited on their own
 * settings page, opened in a new tab so the job being edited isn't lost;
 * the list reloads when this tab regains focus.
 */
export default function QuestionSetPicker({
  onApply,
  disabled,
}: {
  onApply: (form: ApplicationForm) => void;
  disabled?: boolean;
}) {
  const [sets, setSets] = useState<QuestionSet[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [selected, setSelected] = useState("");

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    const result = await listQuestionSetsAction();
    if (isCancelled()) return;
    if (result.ok) {
      setSets(result.sets);
      setCanManage(result.canManage);
      setSelected((current) => (result.sets.some((s) => s.id === current) ? current : ""));
    } else {
      setSets((existing) => existing ?? []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    void load(isCancelled);
    const onFocus = () => void load(isCancelled);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  if (!sets || (sets.length === 0 && !canManage)) return null;

  const apply = () => {
    const set = sets.find((s) => s.id === selected);
    if (set) onApply(copyQuestionSet(set.form));
  };

  const manageLink = (
    <Link
      href={sets.length === 0 ? `${QUESTION_SETS_PATH}/new` : QUESTION_SETS_PATH}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-brand hover:underline"
    >
      {sets.length === 0 ? "Create a question set" : canManage ? "Manage question sets" : "View question sets"}
      <ExternalLink className="h-3 w-3" />
    </Link>
  );

  if (sets.length === 0) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
        <p className="text-sm text-muted-foreground">Reuse the same questions across jobs with a question set.</p>
        {manageLink}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor="question-set">Question set</Label>
          <Select disabled={disabled} value={selected} onValueChange={setSelected}>
            <SelectTrigger id="question-set">
              <SelectValue placeholder="Choose a set…" />
            </SelectTrigger>
            <SelectContent>
              {sets.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" disabled={disabled || !selected} onClick={apply}>
          Apply set
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Applying a set replaces this job&apos;s questions with a copy of it.</p>
        {manageLink}
      </div>
    </section>
  );
}
