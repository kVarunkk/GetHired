"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_FORM_QUESTIONS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  STANDARD_FIELDS,
  STANDARD_FIELD_KEYS,
  isSelectType,
  isTextType,
  type ApplicationForm,
  type FormQuestion,
  type QuestionType,
  type StandardFieldMode,
} from "@/helpers/jobs/application-form-schema";
import KnockoutRuleEditor from "./KnockoutRuleEditor";

// AF-REQ-001/002/005: the company's side of a job's application form.
// Controlled: the parent keeps the form and validates it on save.

const newId = () => crypto.randomUUID();

/** The settings that make sense for `type`; the rest are dropped on a type change. */
function retype(q: FormQuestion, type: QuestionType): FormQuestion {
  const { id, label, help_text, required, archived } = q;
  const base: FormQuestion = { id, type, label, required, ...(help_text ? { help_text } : {}), ...(archived ? { archived } : {}) };
  if (isSelectType(type)) return { ...base, options: q.options ?? [] };
  return base;
}

const numberOrUndefined = (value: string) => (value === "" ? undefined : Number(value));

function QuestionEditor({
  question,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  disabled,
}: {
  question: FormQuestion;
  index: number;
  count: number;
  onChange: (next: FormQuestion) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const [optionsText, setOptionsText] = useState((question.options ?? []).join("\n"));
  const fieldId = (name: string) => `q-${question.id}-${name}`;
  const set = (patch: Partial<FormQuestion>) => {
    const next = { ...question, ...patch } as FormQuestion & Record<string, unknown>;
    for (const key of Object.keys(patch)) if (next[key] === undefined) delete next[key];
    onChange(next);
  };

  return (
    <fieldset
      role="group"
      aria-label={`Question ${index + 1}`}
      disabled={disabled}
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Question {index + 1}</span>
        <div className="flex gap-1">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove" onClick={onRemove}>
            <Trash className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId("label")}>Question</Label>
        <Input id={fieldId("label")} value={question.label} maxLength={300} onChange={(e) => set({ label: e.target.value })} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId("type")}>Answer type</Label>
          <Select value={question.type} onValueChange={(v) => onChange(retype(question, v as QuestionType))}>
            <SelectTrigger id={fieldId("type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUESTION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2 pb-2">
          <Checkbox id={fieldId("required")} checked={question.required} onCheckedChange={(checked) => set({ required: checked === true })} />
          <Label htmlFor={fieldId("required")} className="font-normal">
            Required
          </Label>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId("help")}>Help text</Label>
        <Input
          id={fieldId("help")}
          value={question.help_text ?? ""}
          maxLength={500}
          placeholder="Optional. Shown under the question."
          onChange={(e) => set({ help_text: e.target.value || undefined })}
        />
      </div>

      {isSelectType(question.type) && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId("options")}>Options, one per line</Label>
          <Textarea
            id={fieldId("options")}
            className="min-h-24 resize-y"
            value={optionsText}
            onChange={(e) => {
              setOptionsText(e.target.value);
              set({ options: e.target.value.split("\n").map((o) => o.trim()).filter(Boolean) });
            }}
          />
        </div>
      )}

      {question.type === "multi_select" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("min-selected")}>Pick at least</Label>
            <Input id={fieldId("min-selected")} type="number" min={0} value={question.min_selected ?? ""} onChange={(e) => set({ min_selected: numberOrUndefined(e.target.value) })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("max-selected")}>Pick at most</Label>
            <Input id={fieldId("max-selected")} type="number" min={1} value={question.max_selected ?? ""} onChange={(e) => set({ max_selected: numberOrUndefined(e.target.value) })} />
          </div>
        </div>
      )}

      {question.type === "number" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("min")}>Minimum</Label>
            <Input id={fieldId("min")} type="number" value={question.min ?? ""} onChange={(e) => set({ min: numberOrUndefined(e.target.value) })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("max")}>Maximum</Label>
            <Input id={fieldId("max")} type="number" value={question.max ?? ""} onChange={(e) => set({ max: numberOrUndefined(e.target.value) })} />
          </div>
          <div className="flex items-end gap-2 pb-2">
            <Checkbox id={fieldId("integer")} checked={question.integer === true} onCheckedChange={(checked) => set({ integer: checked === true ? true : undefined })} />
            <Label htmlFor={fieldId("integer")} className="font-normal">
              Whole numbers only
            </Label>
          </div>
        </div>
      )}

      {isTextType(question.type) && (
        <div className="flex flex-col gap-1.5 sm:w-1/2">
          <Label htmlFor={fieldId("max-length")}>Maximum length</Label>
          <Input
            id={fieldId("max-length")}
            type="number"
            min={1}
            placeholder={question.type === "long_text" ? "5000" : "300"}
            value={question.max_length ?? ""}
            onChange={(e) => set({ max_length: numberOrUndefined(e.target.value) })}
          />
        </div>
      )}

      {question.type === "date" && (
        <div className="flex flex-col gap-1.5 sm:w-1/2">
          <Label htmlFor={fieldId("date-rule")}>Dates allowed</Label>
          <Select
            value={question.date_rule === "future" ? "future" : "any"}
            onValueChange={(v) => set({ date_rule: v === "future" ? "future" : undefined })}
          >
            <SelectTrigger id={fieldId("date-rule")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any date</SelectItem>
              <SelectItem value="future">Today or later</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <KnockoutRuleEditor question={question} onChange={(knockout) => set({ knockout })} />
    </fieldset>
  );
}

export default function ApplicationFormBuilder({
  value,
  onChange,
  answeredQuestionIds = [],
  disabled,
}: {
  value: ApplicationForm;
  onChange: (form: ApplicationForm) => void;
  /** Questions that already have answers: a type change or removal archives them (AF-REQ-005). */
  answeredQuestionIds?: string[];
  disabled?: boolean;
}) {
  const answered = new Set(answeredQuestionIds);
  const live = value.questions.filter((q) => !q.archived);
  const archived = value.questions.filter((q) => q.archived);
  const atLimit = live.length >= MAX_FORM_QUESTIONS;

  const setLive = (questions: FormQuestion[], extraArchived: FormQuestion[] = []) =>
    onChange({ ...value, questions: [...questions, ...archived, ...extraArchived] });

  const update = (index: number, next: FormQuestion) => {
    const current = live[index];
    if (next.type !== current.type && answered.has(current.id)) {
      // AF-REQ-005: answers stay tied to the old question; this is a new one.
      const replacement = { ...next, id: newId() };
      setLive(live.map((q, i) => (i === index ? replacement : q)), [{ ...current, archived: true }]);
      return;
    }
    setLive(live.map((q, i) => (i === index ? next : q)));
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= live.length) return;
    const next = [...live];
    [next[index], next[target]] = [next[target], next[index]];
    setLive(next);
  };

  const remove = (index: number) => {
    const current = live[index];
    const rest = live.filter((_, i) => i !== index);
    setLive(rest, answered.has(current.id) ? [{ ...current, archived: true }] : []);
  };

  const setStandard = (key: (typeof STANDARD_FIELD_KEYS)[number], mode: StandardFieldMode) => {
    const standard_fields = { ...value.standard_fields };
    if (mode === "off") delete standard_fields[key];
    else standard_fields[key] = mode;
    const next: ApplicationForm = { ...value, standard_fields };
    if (key === "work_authorization" && mode === "off") delete next.standard_knockouts;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold">Questions</h3>
          <p className="text-xs text-muted-foreground">Ask anything that helps you review applicants. Keep it short.</p>
        </div>
        {live.length === 0 && (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No questions yet.</p>
        )}
        {live.map((q, i) => (
          <QuestionEditor
            key={q.id}
            question={q}
            index={i}
            count={live.length}
            disabled={disabled}
            onChange={(next) => update(i, next)}
            onMove={(delta) => move(i, delta)}
            onRemove={() => remove(i)}
          />
        ))}
        <div className="flex items-center justify-between gap-3">
          {atLimit ? (
            <p className="text-xs text-muted-foreground">You can add up to {MAX_FORM_QUESTIONS} questions.</p>
          ) : (
            <span />
          )}
          <Button
            type="button"
            variant="outline"
            disabled={disabled || atLimit}
            onClick={() => setLive([...live, { id: newId(), type: "long_text", label: "", required: true }])}
          >
            <Plus className="h-4 w-4" />
            Add question
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold">Standard fields</h3>
          <p className="text-xs text-muted-foreground">Common details, prefilled from the applicant&apos;s profile where we have them.</p>
        </div>
        <ul className="divide-y rounded-lg border">
          {STANDARD_FIELD_KEYS.map((key) => {
            const selectId = `std-${key}`;
            return (
              <li key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                <Label htmlFor={selectId} className="font-normal">
                  {STANDARD_FIELDS[key].label}
                </Label>
                <Select
                  disabled={disabled}
                  value={value.standard_fields[key] ?? "off"}
                  onValueChange={(v) => setStandard(key, v as StandardFieldMode)}
                >
                  <SelectTrigger id={selectId} className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="optional">Optional</SelectItem>
                    <SelectItem value="required">Required</SelectItem>
                  </SelectContent>
                </Select>
              </li>
            );
          })}
        </ul>
        {value.standard_fields.work_authorization && (
          <KnockoutRuleEditor
            question={{
              id: "std:work_authorization",
              type: "yes_no",
              label: STANDARD_FIELDS.work_authorization.label,
              required: value.standard_fields.work_authorization === "required",
              knockout: value.standard_knockouts?.work_authorization,
            }}
            onChange={(knockout) =>
              onChange({ ...value, standard_knockouts: knockout ? { work_authorization: knockout } : undefined })
            }
          />
        )}
      </section>
    </div>
  );
}
