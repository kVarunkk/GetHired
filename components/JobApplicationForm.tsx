"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { User } from "@supabase/supabase-js";
import { toast } from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { IJob, IResume } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import ResumeSourceSelector from "./ResumeSourceSelector";
import { createResumeAction } from "@/app/actions/create-resume";
import { cn } from "@/lib/utils";

const createFormSchema = (questions: string[]) => {
  const schemaFields = questions.reduce<Record<string, z.ZodTypeAny>>(
    (acc, _, index) => {
      acc[`question_${index}`] = z.string().min(1, "Answer cannot be empty.");
      return acc;
    },
    {}
  );
  return z.object(schemaFields);
};

interface JobApplicationFormProps {
  jobPost: IJob;
  user: User;
  onSuccess: () => void;
}

export default function JobApplicationForm({
  jobPost,
  user,
  onSuccess,
}: JobApplicationFormProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);

  // Resume Selection State
  const [existingResumes, setExistingResumes] = useState<IResume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [isFetchingResumes, setIsFetchingResumes] = useState(true);

  const questions = useMemo(
    () => jobPost.job_postings?.[0]?.questions || [],
    [jobPost]
  );
  const formSchema = useMemo(() => createFormSchema(questions), [questions]);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
  });

  // 1. Fetch User Resumes & Pre-select Primary
  useEffect(() => {
    const fetchResumes = async () => {
      const supabase = createClient();
      try {
        const { data, error } = await supabase
          .from("resumes")
          .select("id, name, created_at, is_primary, resume_path")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (error) throw error;

        setExistingResumes(data || []);

        // Auto-select primary resume
        const primary = data?.find((r) => r.is_primary);
        if (primary) {
          setSelectedResumeId(primary.id);
        }
      } catch (err) {
        console.error("Resume fetch error", err);
      } finally {
        setIsFetchingResumes(false);
      }
    };

    fetchResumes();
  }, [user.id]);

  // 2. Final Submission Logic
  const onSubmit = async (values: Record<string, string>) => {
    setLoading(true);
    const supabase = createClient();

    try {
      let finalResumeId = "";

      // CASE A: User uploaded a NEW file during the application
      if (newFile) {
        // const tempPath = `applications/temp/${user.id}/${Date.now()}-${newFile.name}`;
        // const { data: uploadData, error: uploadError } = await supabase.storage
        //   .from("resumes")
        //   .upload(tempPath, newFile);

        // if (uploadError) throw new Error("Failed to upload new resume.");
        // finalResumePath = uploadData.path;
        const formData = new FormData();
        formData.append("userId", user.id);
        formData.append("file", newFile);
        const result = await createResumeAction(formData);
        if (result.error) throw new Error(result.error);
        finalResumeId = result.resumeId;
      }
      // CASE B: User selected an EXISTING resume
      else if (selectedResumeId) {
        // const selected = existingResumes.find((r) => r.id === selectedResumeId);
        // if (!selected) throw new Error("Resume selection invalid.");
        finalResumeId = selectedResumeId;
      } else {
        throw new Error("Please select or upload a resume.");
      }

      // --- APPLICATION BUCKET COPY LOGIC ---
      //   const { data: signedUrlData } = await supabase.storage
      //     .from("resumes")
      //     .createSignedUrl(finalResumePath, 60);

      //   if (!signedUrlData?.signedUrl)
      //     throw new Error("Could not access resume for submission.");

      //   const resumeRes = await fetch(signedUrlData.signedUrl);
      //   const resumeBlob = await resumeRes.blob();

      //   const companyPath = `companies/${jobPost.job_postings![0].company_id}/resumes/${user.id}/${uuidv4()}.pdf`;
      //   const { data: companyUpload } = await supabase.storage
      //     .from("applications")
      //     .upload(companyPath, resumeBlob);

      // --- SAVE APPLICATION RECORD ---
      const { error } = await supabase.from("applications").insert({
        job_post_id: jobPost.job_postings![0].id,
        all_jobs_id: jobPost.id,
        applicant_user_id: user.id,
        answers: Object.values(values),
        resume_id: finalResumeId,
        status: "submitted",
      });

      if (error) throw error;

      toast.success("Application sent!");
      onSuccess();
    } catch {
      toast.error(
        "Some error occured while submitting application. Please try again later."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full ">
      {/* Step Indicator */}
      <div className="flex justify-center items-center p-4 gap-4">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold border transition-colors",
              step === 1
                ? "bg-brand border-brand"
                : "bg-emerald-500 border-emerald-500 "
            )}
          >
            {step === 2 ? <CheckCircle2 size={12} /> : "1"}
          </div>
          <span
            className={cn(
              "text-[10px] font-black uppercase tracking-widest",
              step === 1 ? "text-brand" : "text-muted-foreground"
            )}
          >
            Resume
          </span>
        </div>
        <div className="h-px w-8 bg-muted-foreground" />
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold border transition-colors",
              step === 2
                ? "bg-brand border-brand"
                : "border-border text-muted-foreground"
            )}
          >
            2
          </div>
          <span
            className={cn(
              "text-[10px] font-black uppercase tracking-widest",
              step === 2 ? "text-brand" : "text-muted-foreground"
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
              <h3 className="text-lg font-bold">Select Application Resume</h3>
              <p className="text-xs text-muted-foreground">
                The recruiter will see this version of your resume.
              </p>
            </div>

            {isFetchingResumes ? (
              <div className="py-12 flex flex-col items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin" />
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
              <h3 className="text-lg font-bold">Additional Questions</h3>
              <p className="text-xs text-muted-foreground">
                Company specific requirements.
              </p>
            </div>

            <Form {...form}>
              <form
                id="application-questions-form"
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                {questions.length > 0 ? (
                  questions.map((q: string, i: number) => (
                    <FormField
                      key={i}
                      control={form.control}
                      name={`question_${i}`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-bold text-zinc-600 dark:text-zinc-400">
                            {q}
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              placeholder="Your response..."
                              className="bg-input resize-none h-32 "
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))
                ) : (
                  <div className="py-10 text-center border-2 border-dashed rounded-2xl border-zinc-100 dark:border-zinc-900">
                    <p className="text-sm text-muted-foreground ">
                      No extra questions for this role. You&apos;re good to go!
                    </p>
                  </div>
                )}
              </form>
            </Form>
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
          className="gap-2 text-xs font-bold uppercase tracking-widest"
        >
          <ArrowLeft size={14} /> Back
        </Button>

        {step === 1 ? (
          <Button
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
