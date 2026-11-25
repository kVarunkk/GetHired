"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { AllJobWithRelations } from "@/utils/types";
import ResumeSourceSelector from "./ResumeSourceSelector";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";
import { TJobIdPageData } from "@/utils/types/jobs.types";
import useSWR, { mutate } from "swr";
import { TResumeReviewResume } from "@/utils/types/review.types";
import { revalidateCacheAction } from "@/app/actions/revalidate-tag";
import { submitApplicationAction } from "@/app/actions/submit-application";
import StickyActionBar from "./StickyActionBar";
import ApplicationFields, { type FieldValues } from "./jobs/ApplicationFields";
import { readApplicationForm } from "@/helpers/jobs/application-form-schema";
import { publicApplicationForm } from "@/helpers/jobs/public-application-form";
import { fieldsOf, validateAnswers } from "@/helpers/applications/validate-answers";
import { prefillStandardAnswers, type PrefillProfile } from "@/helpers/applications/prefill";
import { useApplicationSource } from "./jobs/ApplicationSourceContext";
import type { ScreeningInviteSummary } from "@/helpers/interview/screening/my-interviews";

const draftKey = (allJobsId: string) => `gethired:apply-draft:${allJobsId}`;

function readDraft(allJobsId: string): FieldValues {
  try {
    const raw = window.localStorage.getItem(draftKey(allJobsId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeDraft(allJobsId: string, values: FieldValues | null) {
  try {
    if (values) window.localStorage.setItem(draftKey(allJobsId), JSON.stringify(values));
    else window.localStorage.removeItem(draftKey(allJobsId));
  } catch {}
}

const isBlank = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/** Keeps only this form's fields and drops empty values, so skipped optional fields aren't sent. */
function compact(values: FieldValues, keys: Set<string>): FieldValues {
  return Object.fromEntries(Object.entries(values).filter(([key, v]) => keys.has(key) && !isBlank(v)));
}

interface JobApplicationFormProps {
  jobPost: AllJobWithRelations | TJobIdPageData;
  userId: string;
  /** Called after the application is sent; `interview` is the screening invite to show (SIT-050). */
  onSuccess: (interview?: ScreeningInviteSummary) => void;
  /** CP-REQ-013: where the application started, and a `?ref=` tag (else from context). */
  source?: "applied" | "careers_page" | "job_board";
  sourceRef?: string;
}

export default function JobApplicationForm({
  jobPost,
  userId,
  onSuccess,
  source,
  sourceRef,
}: JobApplicationFormProps) {
  const [loading, setLoading] = useState(false);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [resumeError, setResumeError] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fromContext = useApplicationSource();
  const applicationSource = source ?? fromContext.source;
  const applicationRef = sourceRef ?? fromContext.ref ?? undefined;

  // AF-REQ-006: the job's typed form (its old `questions` when it has none).
  const posting = jobPost.job_postings?.[0] as
    | { questions?: string[] | null; application_form?: unknown }
    | undefined;
  const form = useMemo(
    () => publicApplicationForm(readApplicationForm(posting?.application_form, posting?.questions)),
    [posting],
  );
  const fieldKeys = useMemo(() => new Set(fieldsOf(form).map((f) => f.key)), [form]);
  const [values, setValues] = useState<FieldValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftLoaded, setDraftLoaded] = useState(false);

  const { data, isLoading } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });
  const existingResumes: TResumeReviewResume[] =
    data && data.profile ? data.profile.resumes : [];

  // The saved draft, over profile values for the standard fields (AF-REQ-002).
  useEffect(() => {
    if (draftLoaded || isLoading) return;
    const prefill = prefillStandardAnswers(form, (data?.profile ?? null) as PrefillProfile | null);
    setValues({ ...prefill, ...compact(readDraft(jobPost.id), fieldKeys) });
    setDraftLoaded(true);
  }, [draftLoaded, isLoading, data, form, fieldKeys, jobPost.id]);

  const setValue = (key: string, value: unknown) => {
    setValues((current) => {
      const next = { ...current, [key]: value };
      writeDraft(jobPost.id, next);
      return next;
    });
    setErrors((current) => {
      if (!current[key]) return current;
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
  };

  useEffect(() => {
    if (existingResumes.length > 0) {
      const primaryResume = existingResumes.find((resume) => resume.is_primary);
      if (primaryResume) {
        setSelectedResumeId(primaryResume.id);
      }
    }
  }, [existingResumes]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const checked = validateAnswers(form, compact(values, fieldKeys));
    const noResume = !newFile && !selectedResumeId;
    setResumeError(noResume);
    if (!checked.ok || noResume) {
      if (!checked.ok) setErrors(checked.fieldErrors);
      toast.error(
        noResume
          ? "Please select or upload a resume."
          : (checked.ok ? null : checked.formError) ?? "Check your answers and try again.",
      );
      // AP-REQ-031: scroll to the first error once it has rendered.
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>("[data-resume-error], [aria-invalid='true']")
          ?.scrollIntoView({ block: "center" }),
      );
      return;
    }

    setLoading(true);
    try {
      // AF-REQ-007: validated again on the server against the job's form.
      const input = {
        allJobsId: jobPost.id,
        ...(newFile ? {} : { resumeId: selectedResumeId! }),
        answers: checked.answers,
        ...(applicationSource ? { source: applicationSource } : {}),
        ...(applicationRef ? { ref: applicationRef } : {}),
      };
      // A new file goes with the application and is parsed on the server
      // only after the job and answers pass its checks.
      let submitted;
      if (newFile) {
        const files = new FormData();
        files.append("resume", newFile);
        submitted = await submitApplicationAction(input, files);
      } else {
        submitted = await submitApplicationAction(input);
      }
      if (!submitted.ok) {
        if (submitted.fieldErrors) setErrors(submitted.fieldErrors);
        toast.error(submitted.error);
        return;
      }
      if (submitted.creditsDeducted || newFile) {
        await mutate(PROFILE_API_KEY);
      }
      writeDraft(jobPost.id, null);

      await revalidateCacheAction(`profile-${userId}`);

      toast.success("Application sent!");
      onSuccess(submitted.interview ?? undefined);
    } catch {
      toast.error(
        "Some error occured while submitting application. Please try again later.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <section className="space-y-4" data-resume-error={resumeError ? "" : undefined}>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Resume</h2>
          <p className="text-xs text-muted-foreground">The recruiter will see this version of your resume.</p>
        </div>
        {isLoading ? (
          <div className="py-12 flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Loading your library...</p>
          </div>
        ) : (
          <ResumeSourceSelector
            existingResumes={existingResumes}
            selectedId={selectedResumeId}
            onSelectExisting={(id: string | null) => {
              setSelectedResumeId(id);
              setNewFile(null);
              setResumeError(false);
            }}
            file={newFile}
            onFileChange={(file) => {
              setNewFile(file);
              if (file) setResumeError(false);
            }}
          />
        )}
        {resumeError && (
          <p role="alert" className="text-sm text-destructive">
            Select a resume or upload a new one.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Questions</h2>
          <p className="text-xs text-muted-foreground">Company specific requirements.</p>
        </div>
        {fieldKeys.size > 0 ? (
          <ApplicationFields form={form} values={values} errors={errors} onChange={setValue} disabled={loading} />
        ) : (
          <div className="py-10 text-center border-2 border-dashed rounded-xl">
            <p className="text-sm text-muted-foreground">No extra questions for this role</p>
          </div>
        )}
      </section>

      <StickyActionBar>
        <Button variant="brand" type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {loading && newFile ? "Reading your resume…" : "Submit Application"}
        </Button>
      </StickyActionBar>
    </form>
  );
}
