"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { duplicateResumeAction } from "@/app/actions/resumes/duplicate-resume";
import { downloadResume, type ResumeExportFormat } from "@/helpers/resume/download-resume";

/** Copying and downloading a resume, shared by the list and the resume page. */
export function useResumeActions(resumeId: string) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  const copy = async () => {
    setIsBusy(true);
    const result = await duplicateResumeAction({ resumeId }).catch(() => null);
    setIsBusy(false);

    if (result?.ok) {
      toast.success("Copy created.");
      router.push(`/resume/${result.resumeId}/edit`);
    } else {
      toast.error(result?.error ?? "We couldn't copy this resume. Please try again.");
    }
  };

  const download = async (format: ResumeExportFormat) => {
    setIsBusy(true);
    const result = await downloadResume(resumeId, format);
    setIsBusy(false);
    if (!result.ok) toast.error(result.error);
  };

  return { isBusy, copy, download };
}
