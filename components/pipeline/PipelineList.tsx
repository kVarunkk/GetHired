"use client";

import { useState } from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import ApplicantsTable, { type AnswerFilterQuestion } from "@/components/ApplicantsTable";
import type { TApplicationServer } from "@/utils/types/application.types";
import BulkActionBar from "./BulkActionBar";
import type { TemplateOption } from "./MoveDialog";
import type { StageOption } from "./StagePicker";

/** A job's List view (PL-TASK-004): the applicants table with bulk moves. */
export default function PipelineList({
  data,
  jobPostId,
  stages,
  templates = [],
  screeningCap = null,
  answerQuestions = [],
}: {
  data: (TApplicationServer & { stage_id: string | null })[];
  jobPostId: string;
  /** Active stages, in position order. */
  stages: StageOption[];
  /** The company's email templates, for the move dialog. */
  templates?: TemplateOption[];
  /** The member's own screening cap (RP-REQ-044), for the Screen button. */
  screeningCap?: { limit: number; remaining: number } | null;
  answerQuestions?: AnswerFilterQuestion[];
}) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const stageIds = new Map(data.map((a) => [a.id, a.stage_id]));

  return (
    <div className="space-y-4">
      <BulkActionBar
        selectedIds={selectedIds}
        stages={stages}
        templates={templates}
        stageIdOf={(id) => stageIds.get(id) ?? null}
        onDone={() => setRowSelection({})}
      />
      <ApplicantsTable
        data={data}
        jobPostId={jobPostId}
        defaultSort="fit"
        stages={stages}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        screeningCap={screeningCap}
        answerQuestions={answerQuestions}
      />
    </div>
  );
}
