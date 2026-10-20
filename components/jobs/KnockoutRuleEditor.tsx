"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { screenFairnessText } from "@/helpers/ai/fairness";
import {
  KNOCKOUT_TYPES,
  type FormQuestion,
  type KnockoutAction,
  type KnockoutRule,
} from "@/helpers/jobs/application-form-schema";

// AF-REQ-003: an optional knockout rule on a yes/no, choice or number
// question. New rules flag (AF-DEC-002); reject is opt-in. Applicants never
// see that a question has one.

function defaultRule(question: FormQuestion): KnockoutRule | undefined {
  switch (question.type) {
    case "yes_no":
      return { fail_if: { kind: "equals", value: false }, action: "flag" };
    case "single_select":
    case "multi_select":
      return { fail_if: { kind: "any_of", options: question.options?.slice(0, 1) ?? [] }, action: "flag" };
    case "number":
      return { fail_if: { kind: "less_than", value: question.min ?? 1 }, action: "flag" };
    default:
      return undefined;
  }
}

/** AF-SEC-001: no rule on a question the fairness check flags. */
export function fairnessLocked(question: FormQuestion): boolean {
  return [question.label, question.help_text ?? "", ...(question.options ?? [])].some(
    (text) => !screenFairnessText(text, { context: "candidate_filter" }).ok,
  );
}

export default function KnockoutRuleEditor({
  question,
  onChange,
}: {
  question: FormQuestion;
  onChange: (rule: KnockoutRule | undefined) => void;
}) {
  if (!KNOCKOUT_TYPES.includes(question.type)) return null;
  const fieldId = (name: string) => `ko-${question.id}-${name}`;
  const rule = question.knockout;
  const locked = fairnessLocked(question);

  if (locked) {
    return (
      <p className="text-xs text-muted-foreground">
        Knockout rules aren&apos;t available on this question: it reads as asking about a protected characteristic.
      </p>
    );
  }

  const setAction = (action: KnockoutAction) => rule && onChange({ ...rule, action });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={fieldId("on")}
          checked={Boolean(rule)}
          onCheckedChange={(checked) => onChange(checked === true ? defaultRule(question) : undefined)}
        />
        <Label htmlFor={fieldId("on")} className="font-normal">
          Knockout rule
        </Label>
      </div>

      {rule && (
        <>
          {rule.fail_if.kind === "equals" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={fieldId("equals")}>Doesn&apos;t meet requirements when the answer is</Label>
              <Select
                value={rule.fail_if.value ? "yes" : "no"}
                onValueChange={(v) => onChange({ ...rule, fail_if: { kind: "equals", value: v === "yes" } })}
              >
                <SelectTrigger id={fieldId("equals")} className="h-8 w-fit min-w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {rule.fail_if.kind === "any_of" && (
            <div role="group" aria-label="Failing options" className="flex flex-col gap-1.5">
              <p className="text-sm font-medium leading-none">Doesn&apos;t meet requirements when they pick</p>
              {(question.options ?? []).map((option, i) => {
                const optionId = fieldId(`opt-${i}`);
                const failing = rule.fail_if.kind === "any_of" ? rule.fail_if.options : [];
                return (
                  <div key={option} className="flex items-center gap-2">
                    <Checkbox
                      id={optionId}
                      checked={failing.includes(option)}
                      onCheckedChange={(checked) =>
                        onChange({
                          ...rule,
                          fail_if: {
                            kind: "any_of",
                            options: checked === true ? [...failing, option] : failing.filter((o) => o !== option),
                          },
                        })
                      }
                    />
                    <Label htmlFor={optionId} className="font-normal">
                      {option}
                    </Label>
                  </div>
                );
              })}
            </div>
          )}

          {(rule.fail_if.kind === "less_than" || rule.fail_if.kind === "greater_than") && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={fieldId("cmp")}>Doesn&apos;t meet requirements when the answer is</Label>
                <Select
                  value={rule.fail_if.kind}
                  onValueChange={(v) =>
                    onChange({
                      ...rule,
                      fail_if: {
                        kind: v as "less_than" | "greater_than",
                        value: rule.fail_if.kind === "less_than" || rule.fail_if.kind === "greater_than" ? rule.fail_if.value : 0,
                      },
                    })
                  }
                >
                  <SelectTrigger id={fieldId("cmp")} className="h-8 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="less_than">Less than</SelectItem>
                    <SelectItem value="greater_than">More than</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                aria-label="Knockout value"
                type="number"
                className="h-8 w-28"
                value={rule.fail_if.value}
                onChange={(e) =>
                  onChange({
                    ...rule,
                    fail_if: { kind: rule.fail_if.kind as "less_than" | "greater_than", value: Number(e.target.value) },
                  })
                }
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("action")}>Then</Label>
            <Select value={rule.action} onValueChange={(v) => setAction(v as KnockoutAction)}>
              <SelectTrigger id={fieldId("action")} className="h-8 w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flag">Flag the application</SelectItem>
                <SelectItem value="reject">Move it to Rejected (email after 24 hours)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  );
}
