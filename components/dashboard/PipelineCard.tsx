"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "react-hot-toast";
import { setWeeklyApplicationGoalAction } from "@/app/actions/user/set-weekly-application-goal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { Pipeline } from "@/helpers/dashboard/summary";
import {
  isValidWeeklyGoal,
  WEEKLY_GOAL_MAX,
  WEEKLY_GOAL_MIN,
  WEEKLY_GOAL_PRESETS,
} from "@/helpers/dashboard/weekly-goal";
import { myJobsPath } from "@/helpers/tracker/paths";
import { cn } from "@/utils/utils";

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function GoalForm({
  current,
  pending,
  onSave,
  onCancel,
}: {
  current: number | null;
  pending: boolean;
  onSave: (goal: number | null) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(current === null ? "" : String(current));
  const value = Number(draft);
  const valid = draft !== "" && isValidWeeklyGoal(value);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave(value);
      }}
    >
      <p className="text-sm text-muted-foreground">How many jobs do you want to apply to each week?</p>
      <div className="flex flex-wrap items-center gap-2">
        {WEEKLY_GOAL_PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            size="sm"
            variant={value === preset ? "default" : "outline"}
            aria-pressed={value === preset}
            onClick={() => setDraft(String(preset))}
            className="w-10 tabular-nums"
          >
            {preset}
          </Button>
        ))}
        <Input
          aria-label="Applications per week"
          type="number"
          inputMode="numeric"
          min={WEEKLY_GOAL_MIN}
          max={WEEKLY_GOAL_MAX}
          placeholder="Other"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="h-8 w-20 text-sm"
        />
      </div>
      {draft !== "" && !valid && (
        <p className="text-xs text-destructive">
          Pick a whole number from {WEEKLY_GOAL_MIN} to {WEEKLY_GOAL_MAX}.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!valid || pending}>
          Save goal
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        {current !== null && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={() => onSave(null)}
            disabled={pending}
          >
            Remove goal
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Applications in the last 7 days, against a weekly goal the user picks.
 * With no goal set it only shows the count and offers to set one.
 */
function WeeklyGoal({ thisWeek, initialGoal }: { thisWeek: number; initialGoal: number | null }) {
  const [goal, setGoal] = useState(initialGoal);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = (next: number | null) => {
    const previous = goal;
    setGoal(next);
    setEditing(false);
    startTransition(async () => {
      const result = await setWeeklyApplicationGoalAction({ goal: next });
      if (!result.ok) {
        setGoal(previous);
        toast.error(result.error);
      }
    });
  };

  const applied = plural(thisWeek, "application");

  return (
    <section className="flex flex-col gap-2 border-t pt-4" aria-labelledby="weekly-goal-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 id="weekly-goal-heading" className="text-sm font-medium">
          Weekly goal
        </h3>
        {goal !== null && !editing && (
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <GoalForm current={goal} pending={pending} onSave={save} onCancel={() => setEditing(false)} />
      ) : goal === null ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">
            {thisWeek === 0
              ? "You haven't applied anywhere in the last 7 days."
              : `You sent ${applied} in the last 7 days.`}{" "}
            Set a target to keep a steady pace.
          </p>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Set a weekly goal
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">{thisWeek}</span>
            <span className="text-muted-foreground">
              {" "}
              of {plural(goal, "application")} in the last 7 days
            </span>
          </p>
          <Progress
            value={Math.min(100, (thisWeek / goal) * 100)}
            aria-label={`${thisWeek} of ${goal} applications this week`}
            className="h-2"
          />
          <p className={cn("text-xs", thisWeek >= goal ? "font-medium text-foreground" : "text-muted-foreground")}>
            {thisWeek >= goal ? "Goal met. Nice work." : `${goal - thisWeek} more to hit your goal.`}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Where the user's applications stand now (one bar per board column, counts
 * written beside each bar), the share companies answered, and this week's
 * applications against the user's weekly goal (user_info.weekly_application_goal).
 */
export default function PipelineCard({ pipeline, weeklyGoal }: { pipeline: Pipeline; weeklyGoal: number | null }) {
  const max = Math.max(1, ...pipeline.stages.map((stage) => stage.count));

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Your pipeline</h2>
            <p className="text-sm text-muted-foreground">
              {pipeline.total === 0
                ? "No applications yet."
                : pipeline.responseRate === null
                  ? `${pipeline.total} application${pipeline.total === 1 ? "" : "s"}`
                  : `${pipeline.responseRate}% got a reply (${pipeline.responded} of ${pipeline.total})`}
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href={myJobsPath()}>Board</Link>
          </Button>
        </div>

        {pipeline.total > 0 ? (
          <dl className="flex flex-col gap-2">
            {pipeline.stages.map((stage) => (
              <div key={stage.column} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-sm">
                <dt className="text-muted-foreground">{stage.label}</dt>
                <div className="h-2 rounded-full bg-muted" aria-hidden>
                  {stage.count > 0 && (
                    <div
                      className={stage.column === "closed" ? "h-2 rounded-full bg-muted-foreground/40" : "h-2 rounded-full bg-brand"}
                      style={{ width: `${(stage.count / max) * 100}%` }}
                    />
                  )}
                </div>
                <dd className="text-right font-medium tabular-nums">{stage.count}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            Apply on GetHired, or{" "}
            <Link className="font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground" href={myJobsPath()}>
              add jobs you applied to elsewhere
            </Link>
            , and they&apos;ll show up here.
          </p>
        )}

        <WeeklyGoal thisWeek={pipeline.thisWeek} initialGoal={weeklyGoal} />
      </CardContent>
    </Card>
  );
}
