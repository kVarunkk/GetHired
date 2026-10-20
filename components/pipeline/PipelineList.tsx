"use client";

import { useState } from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import ApplicantsTable, { type AnswerFilterQuestion } from "@/components/ApplicantsTable";
import type { TApplicationServer } from "@/utils/types/application.types";
import BulkActionBar from "./BulkActionBar";
import type { TemplateOption } from "./MoveDialog";
import type { StageOption } from "./StagePicker";
import type { InterviewSummary } from "@/helpers/interview/screening/summary-view";

/** A job's List view (PL-TASK-004): the applicants table with bulk moves. */
export default function PipelineList({
  data,
  jobPostId,
  stages,
  templates = [],
  screeningCap = null,
  answerQuestions = [],
  interviews,
  interviewInvite,
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
  /** SIT-062: each application's AI interview, with interviews.view on the job. */
  interviews?: Record<string, InterviewSummary>;
  /** SIT-062: bulk invites, when the member has interviews.manage (on or off). */
  interviewInvite?: { durationMinutes: number; enabled: boolean };
}) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const stageIds = new Map(data.map((a) => [a.id, a.stage_id]));
  const names = new Map(data.map((a) => [a.id, a.user_info?.full_name || "Applicant"]));

  return (
    <div className="space-y-4">
      <BulkActionBar
        selectedIds={selectedIds}
        stages={stages}
        templates={templates}
        stageIdOf={(id) => stageIds.get(id) ?? null}
        interviewStatusOf={(id) => interviews?.[id]?.status ?? null}
        interviewInvite={interviewInvite && { jobPostId, ...interviewInvite }}
        nameOf={(id) => names.get(id) ?? "Applicant"}
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
        interviews={interviews}
      />
    </div>
  );
}
