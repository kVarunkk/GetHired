"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { checkCandidateEmailAction } from "@/app/actions/candidates/check-candidate-email";
import { createCandidateAction } from "@/app/actions/candidates/create-candidate";
import CandidateFieldInputs from "@/components/candidates/CandidateFieldInputs";
import ImportDestination, {
  destinationJob,
  destinationReady,
  destinationValue,
  initialDestination,
  type Destination,
  type DestinationPage,
} from "@/components/candidates/ImportDestination";
import { uploadCandidateResume } from "@/components/candidates/upload-candidate-resume";
import StickyActionBar from "@/components/StickyActionBar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebounce } from "@/hooks/useDebounce";
import { parseCandidateFields, type CandidateFieldErrors } from "@/helpers/candidates/candidate-schema";
import { EMPTY_CANDIDATE_FORM } from "@/helpers/candidates/candidate-form";
import { IMPORT_MESSAGES } from "@/helpers/candidates/copy";
import { candidatePath } from "@/helpers/candidates/paths";
import { RESUME_ACCEPT, resumeFileError } from "@/helpers/candidates/resume-files";

type Existing = { kind: "candidate" | "user"; href: string };

export const LAWFUL_BASIS_TEXT =
  "We have a lawful basis to process this person's data and to contact them about roles.";

/**
 * Adds one candidate by hand (BI-REQ-009, CP-REQ-001/010): their fields,
 * where they go (your candidates, a talent list, or a job and stage, when an
 * email is required; on a job page `page.fixedJob`), the email checked as
 * it's typed, and the lawful-basis attestation (BI-REQ-016). Nobody is
 * emailed (BI-REQ-015c).
 * An optional resume is read after the candidate is saved and fills only
 * the fields left empty (BI-REQ-008).
 */
export default function CandidateForm({ page, cancelHref }: { page: DestinationPage; cancelHref: string }) {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY_CANDIDATE_FORM);
  const [errors, setErrors] = useState<CandidateFieldErrors>({});
  const [destination, setDestination] = useState<Destination>(() => initialDestination(page));
  const withJob = destinationJob(page, destination) !== null;
  const [attested, setAttested] = useState(false);
  const [basisNote, setBasisNote] = useState("");
  const [existing, setExisting] = useState<Existing | null>(null);
  const [saving, setSaving] = useState(false);
  const [resume, setResume] = useState<File | null>(null);
  const resumeError = resume ? resumeFileError(resume) : null;
  const email = useDebounce(values.email.trim().toLowerCase(), 400);

  // BI-REQ-014/019: who the email already belongs to. A stale answer for an
  // email that's since changed is dropped.
  useEffect(() => {
    let current = true;
    setExisting(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return;
    checkCandidateEmailAction({ email })
      .then((result) => {
        if (current && result.ok) setExisting(result.existing);
      })
      // Extra: the save checks again.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [email]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseCandidateFields(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    if (withJob && !parsed.data.email) {
      setErrors({ email: IMPORT_MESSAGES.no_email });
      return;
    }
    setSaving(true);
    try {
      const target = destinationValue(page, destination);
      const result = await createCandidateAction({
        ...values,
        ...(target.jobPostId ? { jobPostId: target.jobPostId, ...(target.stageId ? { stageId: target.stageId } : {}) } : {}),
        ...(target.newListName ? { newListName: target.newListName } : {}),
        ...(target.talentListId ? { talentListId: target.talentListId } : {}),
        attested,
        ...(basisNote.trim() ? { lawfulBasisNote: basisNote.trim() } : {}),
      });
      if (!result.ok) {
        setErrors(result.errors ?? {});
        if (result.existing) setExisting(result.existing);
        toast.error(result.error);
        return;
      }
      toast.success(result.addedToJob ? "Candidate added to the job." : "Candidate added.");
      if (resume) {
        const uploaded = await uploadCandidateResume(result.candidateId, resume).catch(() => ({
          ok: false as const,
          error: "Couldn't upload the resume. Try again.",
        }));
        if (!uploaded.ok) {
          toast.error(`The resume wasn't saved: ${uploaded.error}`);
          router.push(`${candidatePath(result.candidateId)}/resume`);
          return;
        }
      }
      router.push(candidatePath(result.candidateId));
    } catch {
      toast.error("Couldn't add the candidate. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const emailNotice = existing && (
    <p className="text-sm text-muted-foreground" role="status">
      {existing.kind === "candidate" ? (
        <>
          Already one of your candidates.{" "}
          <Link href={existing.href} className="font-medium text-foreground underline underline-offset-4">
            Open
          </Link>
        </>
      ) : (
        <>
          Already in your pipeline on GetHired.{" "}
          <Link href={existing.href} className="font-medium text-foreground underline underline-offset-4">
            View profile
          </Link>
        </>
      )}
    </p>
  );

  return (
    // The import's schema checks the fields, with its own messages.
    <form onSubmit={submit} noValidate className="flex flex-col gap-8" aria-label="Add candidate">
      <CandidateFieldInputs
        values={values}
        errors={errors}
        disabled={saving}
        idPrefix="new-candidate"
        emailNotice={emailNotice}
        onChange={(key, value) => {
          setValues((v) => ({ ...v, [key]: value }));
          setErrors((e) => {
            const next = { ...e };
            delete next[key];
            return next;
          });
        }}
      />

      <div className="flex flex-col gap-2 border-t pt-6 sm:max-w-md">
        <Label htmlFor="new-candidate-resume">Resume (optional)</Label>
        <Input
          id="new-candidate-resume"
          type="file"
          accept={RESUME_ACCEPT}
          disabled={saving}
          aria-invalid={resumeError ? true : undefined}
          onChange={(e) => setResume(e.target.files?.[0] ?? null)}
          className="cursor-pointer"
        />
        {resumeError ? (
          <p className="text-xs text-destructive">{resumeError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            PDF or Word (.docx), up to 10 MB. Uses one resume import. It fills only the details you leave empty.
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-4 border-t pt-6">
        <legend className="sr-only">Where they go</legend>
        <ImportDestination
          page={page}
          value={destination}
          onChange={setDestination}
          showDuplicateAction={false}
          idPrefix="new-candidate"
          disabled={saving}
        />
        {withJob && <p className="text-xs text-muted-foreground">They need an email to be added to a job.</p>}
      </fieldset>

      <div className="flex flex-col gap-4 border-t pt-6">
        <div className="flex items-start gap-3">
          <Checkbox
            id="new-candidate-attest"
            checked={attested}
            onCheckedChange={(value) => setAttested(value === true)}
            disabled={saving}
          />
          <Label htmlFor="new-candidate-attest" className="font-normal leading-snug">
            {LAWFUL_BASIS_TEXT}
          </Label>
        </div>
        <div className="flex flex-col gap-2 sm:max-w-md">
          <Label htmlFor="new-candidate-basis">Basis (optional)</Label>
          <Input
            id="new-candidate-basis"
            value={basisNote}
            maxLength={200}
            placeholder="Referral, applied by email…"
            onChange={(e) => setBasisNote(e.target.value)}
            disabled={saving}
          />
        </div>
      </div>

      <StickyActionBar className="justify-end">
        <Button type="button" variant="outline" disabled={saving} onClick={() => router.push(cancelHref)}>
          Cancel
        </Button>
        <Button type="submit" variant="brand" disabled={!attested || saving || existing !== null || resumeError !== null || !destinationReady(destination)}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add candidate
        </Button>
      </StickyActionBar>
    </form>
  );
}
