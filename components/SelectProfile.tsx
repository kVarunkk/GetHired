"use client";

import { IFormData } from "@/lib/types";
import MultiKeywordSelect, { GenericFormData } from "./MultiKeywordSelect";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";

export default function SelectProfile({
  jobPostings,
  applicantProfile,
  companyId,
}: {
  jobPostings?: { id: string; title: string; job_id: string }[];
  applicantProfile: IFormData;
  companyId: string;
}) {
  const router = useRouter();
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (applicantProfile && applicantProfile.applications) {
      const appliedJobTitles = applicantProfile.applications
        .map((app) => app.job_postings?.title)
        .filter((title): title is string => typeof title === "string");
      setSelectedProfiles(appliedJobTitles);
    }
  }, [applicantProfile]);

  const headerProp = useMemo(
    () => ({
      heading: "Your Job Posts",
      description: `Create applications for ${applicantProfile.full_name} by selecting the relevant job posts.`,
    }),
    [applicantProfile.full_name]
  );

  const handleMultiKeywordSelectChange = useCallback(
    async (name: keyof GenericFormData, keywords: string[]) => {
      const newlySelectedJobTitle = keywords.find(
        (keyword) => !selectedProfiles.includes(keyword)
      );

      if (newlySelectedJobTitle && jobPostings) {
        const selectedJob = jobPostings?.find(
          (job) => job.title.trim() === newlySelectedJobTitle
        );

        if (!selectedJob) {
          toast.error("Job posting not found.");
          return;
        }

        try {
          setLoading(true);

          const privateResumePath = applicantProfile?.resumes?.[0]?.resume_path;
          if (!privateResumePath) {
            throw new Error("User has no resume uploaded.");
          }

          const { data: signedUrlData, error: signedUrlError } =
            await supabase.storage
              .from("resumes")
              .createSignedUrl(privateResumePath, 60); // URL valid for 60 seconds

          if (signedUrlError) {
            throw new Error("Failed to generate signed URL for resume.");
          }

          // 2. Download the resume file from the signed URL
          const resumeResponse = await fetch(signedUrlData.signedUrl);
          if (!resumeResponse.ok) {
            throw new Error("Failed to download resume file.");
          }
          const resumeBlob = await resumeResponse.blob();

          // 3. Upload the file to a private, company-specific path in the same bucket
          const privateResumeBucket = "applications";
          const privateResumePathForCompany = `companies/${companyId}/resumes/${
            applicantProfile.user_id
          }/${uuidv4()}.pdf`;

          const { data: uploadData, error: uploadError } =
            await supabase.storage
              .from(privateResumeBucket)
              .upload(privateResumePathForCompany, resumeBlob);

          if (uploadError) {
            throw new Error("Failed to upload resume to private bucket.");
          }

          // The new resume_url is now the private path within the bucket
          const newResumeUrl = uploadData.path;
          // --- END NEW RESUME HANDLING LOGIC ---

          // Combine answers into a JSON object
          // const answers = Object.values(values);

          const { error } = await supabase.from("applications").insert({
            job_post_id: selectedJob.id,
            all_jobs_id: selectedJob.job_id,
            applicant_user_id: applicantProfile.user_id,
            // answers: answers,
            resume_url: newResumeUrl, // Store the private path
            status: "submitted",
          });

          if (error) {
            throw error;
          }

          setSelectedProfiles((prev) => [...prev, newlySelectedJobTitle]);

          router.refresh();

          toast.success(
            <p>
              Successfully created application for{" "}
              <span className="font-medium">{applicantProfile.full_name}</span>{" "}
              for the role of{" "}
              <span className="font-medium">{newlySelectedJobTitle}</span>
            </p>
          );
        } catch {
          // console.error("Error creating application:", error);
          toast.error("Some error occured. Please try again.");

          setSelectedProfiles(selectedProfiles);
        } finally {
          setLoading(false);
        }
      }
    },
    [
      selectedProfiles,
      jobPostings,
      supabase,
      applicantProfile,
      router,
      companyId,
    ]
  );

  const availableJobTitles = jobPostings?.map((job) => job.title) || [];

  return (
    <MultiKeywordSelect
      name={"profile"}
      placeholder={"Select Profile"}
      initialKeywords={selectedProfiles}
      onChange={handleMultiKeywordSelectChange}
      className="mt-1 w-full"
      availableItems={availableJobTitles}
      isVirtualized={true}
      showKeywords={false}
      loading={loading}
      header={headerProp}
    />
  );
}
