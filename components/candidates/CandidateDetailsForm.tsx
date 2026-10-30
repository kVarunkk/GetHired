"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { updateCandidateAction } from "@/app/actions/candidates/update-candidate";
import CandidateFieldInputs, { CANDIDATE_FIELDS } from "@/components/candidates/CandidateFieldInputs";
import StickyActionBar from "@/components/StickyActionBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { candidateFieldsSchema, fieldErrorsOf, type CandidateFieldErrors } from "@/helpers/candidates/candidate-schema";
import { changedFields, type CandidateFormValues } from "@/helpers/candidates/candidate-form";
import { candidatePath } from "@/helpers/candidates/paths";

const editSchema = candidateFieldsSchema.partial().strict();

/**
 * The candidate page's overview (BI-REQ-004): their fields, editable with the
 * import's schema when the member has applicants.import for them, or shown
 * read-only. Only the changed fields are sent.
 */
export default function CandidateDetailsForm({
  candidateId,
  initial,
  canEdit,
}: {
  candidateId: string;
  initial: CandidateFormValues;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<CandidateFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const changes = changedFields(initial, values);
  const dirty = Object.keys(changes).length > 0;

  if (!canEdit) return <CandidateDetailsView values={initial} />;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const local = editSchema.safeParse(changes);
    if (!local.success) {
      setErrors(fieldErrorsOf(local.error));
      return;
    }
    setSaving(true);
    try {
      const result = await updateCandidateAction({ candidateId, fields: changes });
      if (!result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.error);
        return;
      }
      setErrors({});
      toast.success("Candidate saved.");
      router.refresh();
    } catch {
      toast.error("Couldn't save the candidate. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    // The import's schema checks the fields, with its own messages.
    <form onSubmit={save} noValidate className="flex flex-col gap-6" aria-label="Candidate details">
      <p className="text-sm text-muted-foreground">
        To add or replace their resume, go to the{" "}
        <Link href={`${candidatePath(candidateId)}/resume`} className="underline underline-offset-4 hover:text-foreground">
          Resume page
        </Link>
        . Uploading one uses one resume import.
      </p>
      <CandidateFieldInputs
        values={values}
        errors={errors}
        disabled={saving}
        onChange={(key, value) => {
          setValues((v) => ({ ...v, [key]: value }));
          setErrors((e) => {
            const next = { ...e };
            delete next[key];
            return next;
          });
        }}
      />
      <StickyActionBar className="justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => {
            setValues(initial);
            setErrors({});
          }}
        >
          Discard changes
        </Button>
        <Button type="submit" variant="brand" disabled={!dirty || saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </StickyActionBar>
    </form>
  );
}

/** The fields for a member who can read the candidate but not edit them. */
function CandidateDetailsView({ values }: { values: CandidateFormValues }) {
  return (
    <dl className="grid gap-4 pb-6 sm:grid-cols-2">
      {CANDIDATE_FIELDS.map((field) => {
        const value = values[field.key].trim();
        const list = field.key === "skills" || field.key === "tags";
        return (
          <div key={field.key} className={field.wide ? "sm:col-span-2" : undefined}>
            <dt className="text-sm font-semibold">{field.label}</dt>
            <dd className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {!value ? (
                "Not specified"
              ) : list ? (
                <span className="flex flex-wrap gap-1">
                  {value.split(", ").map((item) => (
                    <Badge key={item} variant="secondary">
                      {item}
                    </Badge>
                  ))}
                </span>
              ) : field.type === "url" && /^https?:\/\//i.test(value) ? (
                <a
                  href={value}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {value}
                </a>
              ) : field.multiline ? (
                <span className="whitespace-pre-wrap">{value}</span>
              ) : (
                value
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
