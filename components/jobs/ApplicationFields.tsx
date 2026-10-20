"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SalaryAnswer } from "@/helpers/applications/validate-answers";
import { fieldViews } from "@/helpers/applications/field-views";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { cn } from "@/utils/utils";

// AF-REQ-006: the applicant's side of a job's application form. Controlled:
// the parent keeps the values (and the draft) and validates on submit with
// validateAnswers, the same check the server makes.

export type FieldValues = Record<string, unknown>;

export const SALARY_CURRENCIES = ["USD", "INR", "EUR", "GBP", "CAD", "AUD", "SGD"] as const;
const PROGRESS_FROM = 6;

const isAnswered = (value: unknown) =>
  value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "") && !(Array.isArray(value) && value.length === 0);

function ChoiceList({
  name,
  label,
  options,
  value,
  onChange,
  disabled,
  invalid,
}: {
  name: string;
  label: string;
  options: { label: string; value: string }[];
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} aria-invalid={invalid || undefined} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
            value === o.value && "border-foreground/40 bg-muted",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
            className="h-3.5 w-3.5 accent-current"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export default function ApplicationFields({
  form,
  values,
  errors = {},
  onChange,
  disabled,
}: {
  form: ApplicationForm;
  values: FieldValues;
  errors?: Record<string, string>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const fields = fieldViews(form);
  const required = fields.filter((f) => f.required);
  const answered = required.filter((f) => isAnswered(values[f.key])).length;

  return (
    <div className="flex flex-col gap-6">
      {fields.length >= PROGRESS_FROM && required.length > 0 && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {answered} of {required.length} required answered
        </p>
      )}
      {fields.map((field) => {
        const inputId = `apply-${field.key}`;
        const error = errors[field.key];
        const describedBy = [field.help ? `${inputId}-help` : null, error ? `${inputId}-error` : null].filter(Boolean).join(" ") || undefined;
        const value = values[field.key];
        const common = { id: inputId, disabled, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy };
        const labelText = (
          <>
            {field.label}
            {!field.required && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
          </>
        );
        // Grouped controls are named by aria-label; single inputs by <Label htmlFor>.
        const grouped = field.kind === "single_select" || field.kind === "multi_select" || field.kind === "yes_no";

        let control: React.ReactNode;
        switch (field.kind) {
          case "short_text":
            control = (
              <Input {...common} type="text" maxLength={field.maxLength} value={(value as string) ?? ""} onChange={(e) => onChange(field.key, e.target.value)} />
            );
            break;
          case "long_text":
            control = (
              <Textarea
                {...common}
                className="h-32 resize-none"
                maxLength={field.maxLength}
                value={(value as string) ?? ""}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            );
            break;
          case "url":
            control = (
              <Input {...common} type="url" inputMode="url" placeholder="https://" value={(value as string) ?? ""} onChange={(e) => onChange(field.key, e.target.value)} />
            );
            break;
          case "date":
            control = (
              <Input
                {...common}
                type="date"
                min={field.minDate}
                max={field.maxDate}
                value={(value as string) ?? ""}
                onChange={(e) => onChange(field.key, e.target.value || undefined)}
              />
            );
            break;
          case "number":
            control = (
              <Input
                {...common}
                type="number"
                min={field.min}
                max={field.max}
                value={typeof value === "number" ? value : ""}
                onChange={(e) => onChange(field.key, e.target.value === "" ? undefined : Number(e.target.value))}
              />
            );
            break;
          case "salary": {
            const salary = value as SalaryAnswer | undefined;
            const currency = salary?.currency ?? "USD";
            control = (
              <div className="flex gap-2">
                <Input
                  {...common}
                  type="number"
                  min={0}
                  className="flex-1"
                  value={typeof salary?.amount === "number" ? salary.amount : ""}
                  onChange={(e) =>
                    onChange(field.key, e.target.value === "" ? undefined : { amount: Number(e.target.value), currency })
                  }
                />
                <Select
                  disabled={disabled}
                  value={currency}
                  onValueChange={(v) =>
                    onChange(field.key, typeof salary?.amount === "number" ? { amount: salary.amount, currency: v } : undefined)
                  }
                >
                  <SelectTrigger aria-label="Currency" className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SALARY_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
            break;
          }
          case "yes_no":
            control = (
              <ChoiceList
                name={inputId}
                label={field.label}
                disabled={disabled}
                invalid={Boolean(error)}
                options={[
                  { label: "Yes", value: "yes" },
                  { label: "No", value: "no" },
                ]}
                value={value === true ? "yes" : value === false ? "no" : undefined}
                onChange={(v) => onChange(field.key, v === "yes")}
              />
            );
            break;
          case "single_select":
            control = (
              <ChoiceList
                name={inputId}
                label={field.label}
                disabled={disabled}
                invalid={Boolean(error)}
                options={(field.options ?? []).map((o) => ({ label: o, value: o }))}
                value={value as string | undefined}
                onChange={(v) => onChange(field.key, v)}
              />
            );
            break;
          case "multi_select": {
            const picked = Array.isArray(value) ? (value as string[]) : [];
            control = (
              <div role="group" aria-label={field.label} className="flex flex-col gap-2">
                {(field.options ?? []).map((option, i) => {
                  const optionId = `${inputId}-${i}`;
                  return (
                    <div key={option} className="flex items-center gap-2">
                      <Checkbox
                        id={optionId}
                        disabled={disabled}
                        checked={picked.includes(option)}
                        onCheckedChange={(checked) =>
                          onChange(field.key, checked ? [...picked, option] : picked.filter((p) => p !== option))
                        }
                      />
                      <Label htmlFor={optionId} className="font-normal">
                        {option}
                      </Label>
                    </div>
                  );
                })}
              </div>
            );
            break;
          }
        }

        return (
          <div key={field.key} className="flex flex-col gap-2">
            {grouped ? (
              <p className="text-sm font-medium leading-none">{labelText}</p>
            ) : (
              <Label htmlFor={inputId}>{labelText}</Label>
            )}
            {field.help && (
              <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
                {field.help}
              </p>
            )}
            {control}
            {error && (
              <p id={`${inputId}-error`} className="text-xs font-medium text-destructive">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
