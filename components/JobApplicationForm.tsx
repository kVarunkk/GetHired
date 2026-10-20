"use client";

import React, { useState, useEffect, useMemo } from "react";
import { ArrowRight, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { AllJobWithRelations } from "@/utils/types";
import ResumeSourceSelector from "./ResumeSourceSelector";
import { cn, fetcher, PROFILE_API_KEY } from "@/utils/utils";
import { TJobIdPageData } from "@/utils/types/jobs.types";
import { uploadResumeAction } from "@/app/actions/upload-resume-file";
import useSWR, { mutate } from "swr";
import { TResumeReviewResume } from "@/utils/types/review.types";
import { revalidateCacheAction } from "@/app/actions/revalidate-tag";
import { attachToApplicationAction } from "@/app/actions/applications/attachments";
import { submitApplicationAction } from "@/app/actions/submit-application";
import ShareWithCompanyStep, { type ShareSelection } from "./ShareWithCompanyStep";
import ApplicationFields, { type FieldValues } from "./jobs/ApplicationFields";
import { readApplicationForm } from "@/helpers/jobs/application-form-schema";
import { publicApplicationForm } from "@/helpers/jobs/public-application-form";
import { fieldsOf, validateAnswers } from "@/helpers/applications/validate-answers";
import { prefillStandardAnswers, type PrefillProfile } from "@/helpers/applications/prefill";
import { useApplicationSource } from "./jobs/ApplicationSourceContext";
import ScreeningInviteCard from "./interviews/ScreeningInviteCard";
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
  onSuccess: () => void;
  /** CP-REQ-013: where the application started, and a `?ref=` tag (else from context). */
  source?: "applied" | "careers_page";
  sourceRef?: string;
}

export default function JobApplicationForm({
  jobPost,
  userId,
  onSuccess,
  source,
  sourceRef,
}: JobApplicationFormProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [share, setShare] = useState<ShareSelection>({ sessionId: null, reviewId: null });
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
  const [invite, setInvite] = useState<ScreeningInviteSummary | null>(null);

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
    if (!checked.ok) {
      setErrors(checked.fieldErrors);
      toast.error(checked.formError ?? "Check your answers and try again.");
      return;
    }

    setLoading(true);
    try {
      let finalResumeId = null;

      if (newFile) {
        const formData = new FormData();
        formData.append("file", newFile);
        const result = await uploadResumeAction(formData);
        if (result.error) throw new Error(result.error);
        finalResumeId = result.resumeId;
      } else if (selectedResumeId) {
        finalResumeId = selectedResumeId;
      } else {
        throw new Error("Please select or upload a resume.");
      }

      if (!finalResumeId) {
        throw new Error("Resume processing failed. Please try again.");
      }

      // AF-REQ-007: validated again on the server against the job's form.
      const submitted = await submitApplicationAction({
        allJobsId: jobPost.id,
        resumeId: finalResumeId,
        answers: checked.answers,
        ...(applicationSource ? { source: applicationSource } : {}),
        ...(applicationRef ? { ref: applicationRef } : {}),
      });
      if (!submitted.ok) {
        if (submitted.fieldErrors) setErrors(submitted.fieldErrors);
        toast.error(submitted.error);
        return;
      }
      const applicationId = submitted.applicationId;

      // Shared only after the application exists; a failed share never
      // fails the application (OR-REQ-030).
      if (share.sessionId || share.reviewId) {
        const shares = await Promise.allSettled([
          share.sessionId
            ? attachToApplicationAction({
                applicationId,
                kind: "interview_session",
                interviewSessionId: share.sessionId,
              })
            : null,
          share.reviewId
            ? attachToApplicationAction({
                applicationId,
                kind: "resume_review",
                resumeReviewId: share.reviewId,
              })
            : null,
        ]);
        const failed = shares.some(
          (r) => r.status === "rejected" || (r.value !== null && !r.value.ok),
        );
        if (failed) toast.error("Your application was sent, but we couldn't share everything you picked.");
      }

      if (submitted.creditsDeducted) {
        await mutate(PROFILE_API_KEY);
      }
      writeDraft(jobPost.id, null);

      await revalidateCacheAction(`profile-${userId}`);

      toast.success("Application sent!");
      // SIT-050: stay open on the interview card until the applicant picks.
      if (submitted.interview) setInvite(submitted.interview);
      else onSuccess();
    } catch {
      toast.error(
        "Some error occured while submitting application. Please try again later.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (invite) return <ScreeningInviteCard interview={invite} onLater={onSuccess} />;

  return (
    <div className="flex flex-col h-full ">
      {/* Step Indicator */}
      <div className="flex justify-center items-center p-4 gap-4">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold border transition-colors",
              step === 1
                ? "bg-brand border-brand text-brand-foreground"
                : "bg-success border-success text-success-foreground",
            )}
          >
            {step === 2 ? <CheckCircle2 size={12} /> : "1"}
          </div>
          <span
            className={cn(
              "text-xs font-medium",
              step === 1 ? "text-brand" : "text-muted-foreground",
            )}
          >
            Resume
          </span>
        </div>
        <div className="h-px w-8 bg-border" />
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold border transition-colors",
              step === 2
                ? "bg-brand border-brand text-brand-foreground"
                : "border-border text-muted-foreground",
            )}
          >
            2
          </div>
          <span
            className={cn(
              "text-xs font-medium",
              step === 2 ? "text-brand" : "text-muted-foreground",
            )}
          >
            Questions
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {step === 1 ? (
          <div className="p-4 space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold tracking-tight">
                Select Application Resume
              </h3>
              <p className="text-xs text-muted-foreground">
                The recruiter will see this version of your resume.
              </p>
            </div>

            {isLoading ? (
              <div className="py-12 flex flex-col items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground ">
                  Loading your library...
                </p>
              </div>
            ) : (
              <ResumeSourceSelector
                existingResumes={existingResumes}
                selectedId={selectedResumeId}
                onSelectExisting={(id: string | null) => {
                  setSelectedResumeId(id);
                  setNewFile(null);
                }}
                file={newFile}
                onFileChange={setNewFile}
              />
            )}
          </div>
        ) : (
          <div className="p-4 space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold tracking-tight">
                Additional Questions
              </h3>
              <p className="text-xs text-muted-foreground">
                Company specific requirements.
              </p>
            </div>

            <form
              id="application-questions-form"
              onSubmit={onSubmit}
              noValidate
              className="space-y-6"
            >
              {fieldKeys.size > 0 ? (
                <ApplicationFields
                  form={form}
                  values={values}
                  errors={errors}
                  onChange={setValue}
                  disabled={loading}
                />
              ) : (
                <div className="py-10 text-center border-2 border-dashed rounded-xl">
                  <p className="text-sm text-muted-foreground ">
                    No extra questions for this role. You&apos;re good to go!
                  </p>
                </div>
              )}
            </form>

            <ShareWithCompanyStep allJobsId={jobPost.id} value={share} onChange={setShare} />
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="p-4 border-t border-border flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => (step === 2 ? setStep(1) : null)}
          disabled={step === 1 || loading}
          className="gap-2"
        >
          <ArrowLeft size={14} /> Back
        </Button>

        {step === 1 ? (
          <Button
            variant="brand"
            disabled={!selectedResumeId && !newFile}
            onClick={(e) => {
              e.preventDefault();
              setStep(2);
            }}
            type="button"
          >
            Next Step <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="brand"
            type="submit"
            form="application-questions-form"
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Submit Application
          </Button>
        )}
      </div>
    </div>
  );
}
