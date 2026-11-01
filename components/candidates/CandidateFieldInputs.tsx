"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CandidateFieldErrors, CandidateFieldKey } from "@/helpers/candidates/candidate-schema";
import type { CandidateFormValues } from "@/helpers/candidates/candidate-form";

type Field = {
  key: CandidateFieldKey;
  label: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  multiline?: boolean;
};

/** The order and labels of the candidate fields (BI-REQ-012). */
export const CANDIDATE_FIELDS: Field[] = [
  { key: "full_name", label: "Name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "location", label: "Location" },
  { key: "current_title", label: "Current title" },
  { key: "current_company", label: "Current company" },
  { key: "experience_years", label: "Years of experience", type: "number" },
  { key: "linkedin_url", label: "LinkedIn", type: "url", placeholder: "https://" },
  { key: "github_url", label: "GitHub", type: "url", placeholder: "https://" },
  { key: "portfolio_url", label: "Portfolio", type: "url", placeholder: "https://" },
  { key: "resume_url", label: "Resume link", type: "url", placeholder: "https://" },
  { key: "skills", label: "Skills", hint: "Separate with commas.", wide: true },
  { key: "tags", label: "Tags", hint: "Separate with commas. Only your team sees them.", wide: true },
  { key: "notes", label: "Notes", hint: "Only your team sees them.", wide: true, multiline: true },
];

/**
 * The candidate's fields as inputs, each with its error under it. Shared by
 * the candidate page and the add-candidate form.
 */
export default function CandidateFieldInputs({
  values,
  errors,
  onChange,
  disabled = false,
  idPrefix = "candidate",
  emailNotice,
}: {
  values: CandidateFormValues;
  errors: CandidateFieldErrors;
  onChange: (key: CandidateFieldKey, value: string) => void;
  disabled?: boolean;
  idPrefix?: string;
  /** Under the email input: who the email already belongs to (the add form). */
  emailNotice?: ReactNode;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {CANDIDATE_FIELDS.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const error = errors[field.key];
        const described = [error && `${id}-error`, field.hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
        const props = {
          id,
          value: values[field.key],
          disabled,
          placeholder: field.placeholder,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": described,
        };
        return (
          <div key={field.key} className={`flex flex-col gap-2 ${field.wide ? "sm:col-span-2" : ""}`}>
            <Label htmlFor={id}>{field.label}</Label>
            {field.multiline ? (
              <Textarea {...props} rows={4} onChange={(e) => onChange(field.key, e.target.value)} />
            ) : (
              <Input
                {...props}
                type={field.type ?? "text"}
                {...(field.type === "number" ? { min: 0, max: 60, step: "0.5" } : {})}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            )}
            {field.hint && (
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                {field.hint}
              </p>
            )}
            {error && (
              <p id={`${id}-error`} className="text-sm text-destructive">
                {error}
              </p>
            )}
            {field.key === "email" && emailNotice}
          </div>
        );
      })}
    </div>
  );
}
