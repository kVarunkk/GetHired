"use client";

import { useId, useState } from "react";
import { Check, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import LocationSearchSelect from "@/components/LocationSearchSelect";
import { cn } from "@/utils/utils";
import {
  answerComplete,
  answerLabels,
  ASK_USER_MAX_LOCATIONS,
  ASK_USER_OTHER_MAX_CHARS,
  isLocationQuestion,
  type AskUserAnswer,
  type AskUserInput,
  type AskUserOutput,
  type AskUserQuestion,
} from "@/helpers/agent/ask-user";

export type { AskUserOutput };

type Draft = { selected: number[]; other: string; locations: string[] };

const EMPTY_DRAFT: Draft = { selected: [], other: "", locations: [] };

const toAnswer = ({ selected, other, locations }: Draft): AskUserAnswer => {
  const trimmed = other.trim();
  return {
    selected,
    ...(trimmed ? { other: trimmed } : {}),
    ...(locations.length > 0 ? { locations } : {}),
  };
};

function QuestionField({
  q,
  index,
  total,
  draft,
  onChange,
  disabled,
}: {
  q: AskUserQuestion;
  index: number;
  total: number;
  draft: Draft;
  onChange: (draft: Draft) => void;
  disabled: boolean;
}) {
  const id = useId();
  const options = q.options ?? [];
  const labelId = `${id}-question`;

  const header = (
    <div id={labelId} className="flex flex-col gap-0.5">
      {total > 1 && (
        <span className="text-xs text-muted-foreground">
          Question {index + 1} of {total}
        </span>
      )}
      <span className="text-sm font-medium text-foreground">{q.question}</span>
      {((options.length > 0 && q.multiSelect) || isLocationQuestion(q)) && (
        <span className="text-xs text-muted-foreground">Choose all that apply.</span>
      )}
    </div>
  );

  // Places come from the app's location search, so the answer is a real city or country.
  if (isLocationQuestion(q)) {
    return (
      <div className="flex flex-col gap-2">
        {header}
        <LocationSearchSelect
          name="locations"
          ariaLabelledBy={labelId}
          initialLocations={draft.locations}
          isSingleSelect={false}
          disabled={disabled}
          placeholder="Search and pick locations"
          onChange={(_, locations) =>
            onChange({ ...EMPTY_DRAFT, locations: locations.slice(0, ASK_USER_MAX_LOCATIONS) })
          }
        />
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {header}
        <Textarea
          aria-labelledby={labelId}
          value={draft.other}
          maxLength={ASK_USER_OTHER_MAX_CHARS}
          disabled={disabled}
          rows={2}
          placeholder="Type your answer"
          onChange={(event) => onChange({ ...EMPTY_DRAFT, other: event.target.value })}
        />
      </div>
    );
  }

  const values = draft.selected.map(String);
  // A single choice and a typed answer replace each other.
  const pick = (next: string[]) =>
    onChange({
      ...EMPTY_DRAFT,
      selected: next.map(Number).sort((a, b) => a - b),
      other: q.multiSelect || next.length === 0 ? draft.other : "",
    });

  const items = options.map((option, i) => (
    <ToggleGroupItem
      key={i}
      value={String(i)}
      disabled={disabled}
      className="group h-auto w-full justify-start gap-3 rounded-lg border border-input px-3 py-2.5 text-left font-normal hover:bg-muted/60 hover:text-foreground data-[state=on]:border-brand/50 data-[state=on]:bg-brandSoft data-[state=on]:text-foreground"
    >
      <span
        aria-hidden
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center border border-muted-foreground/50 group-data-[state=on]:border-brand group-data-[state=on]:bg-brand group-data-[state=on]:text-brand-foreground",
          q.multiSelect ? "rounded-sm" : "rounded-full",
        )}
      >
        <Check className="!size-3 opacity-0 group-data-[state=on]:opacity-100" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-foreground">{option.label}</span>
        {option.description && (
          <span className="text-xs text-muted-foreground">{option.description}</span>
        )}
      </span>
    </ToggleGroupItem>
  ));

  return (
    <div className="flex flex-col gap-2">
      {header}
      {q.multiSelect ? (
        <ToggleGroup
          type="multiple"
          aria-labelledby={labelId}
          value={values}
          onValueChange={pick}
          className="flex-col items-stretch gap-1.5"
        >
          {items}
        </ToggleGroup>
      ) : (
        <ToggleGroup
          type="single"
          aria-labelledby={labelId}
          value={values[0] ?? ""}
          onValueChange={(value) => pick(value ? [value] : [])}
          className="flex-col items-stretch gap-1.5"
        >
          {items}
        </ToggleGroup>
      )}
      <Input
        aria-label={`Your own answer to: ${q.question}`}
        value={draft.other}
        maxLength={ASK_USER_OTHER_MAX_CHARS}
        disabled={disabled}
        placeholder="Or type your own answer"
        onChange={(event) =>
          onChange({
            ...EMPTY_DRAFT,
            selected: q.multiSelect || !event.target.value.trim() ? draft.selected : [],
            other: event.target.value,
          })
        }
      />
    </div>
  );
}

/**
 * The agents' `askUser` client tool: the model's questions with choices to
 * click, or a box for the user's own words. `onComplete` is left out on an
 * older reply, which can't take a tool output any more.
 */
export default function AskUserCard({
  input,
  onComplete,
}: {
  input: AskUserInput;
  onComplete?: (output: AskUserOutput) => void;
}) {
  const { questions } = input;
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(() => EMPTY_DRAFT));
  const disabled = !onComplete;
  const answers = drafts.map(toAnswer);
  const ready = questions.every((q, i) => answerComplete(q, answers[i]));

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <MessageCircleQuestion aria-hidden className="h-4 w-4" />
        {questions.length > 1 ? "A few questions" : "A quick question"}
      </div>
      {questions.map((q, i) => (
        <QuestionField
          key={i}
          q={q}
          index={i}
          total={questions.length}
          draft={drafts[i]}
          disabled={disabled}
          onChange={(draft) => setDrafts((current) => current.map((d, j) => (j === i ? draft : d)))}
        />
      ))}
      {disabled ? (
        <p className="text-xs text-muted-foreground">These questions were left unanswered.</p>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="brand" disabled={!ready} onClick={() => onComplete({ answers })}>
            {questions.length > 1 ? "Send answers" : "Send answer"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onComplete({ dismissed: true })}>
            Skip
          </Button>
        </div>
      )}
    </div>
  );
}

/** The answered card, as the user sees it after sending (and after a reload). */
export function AskUserResult({ input, output }: { input: AskUserInput; output: AskUserOutput }) {
  if ("dismissed" in output) return null;
  return (
    <dl className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
      {input.questions.map((q, i) => {
        const answer = output.answers[i];
        return (
          <div key={i} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">{q.question}</dt>
            <dd className="text-foreground">{answer ? answerLabels(q, answer).join(", ") : "—"}</dd>
          </div>
        );
      })}
    </dl>
  );
}
