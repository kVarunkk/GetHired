"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { AllJobWithRelations } from "@/utils/types";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TJobIdPageData } from "@/utils/types/jobs.types";
import { mutate } from "swr";
import { PROFILE_API_KEY } from "@/utils/utils";
import AgentHandoff from "@/components/agent/AgentHandoff";
import { AGENT_PATH, agentPromptHref, savePendingPrompt } from "@/helpers/agent/prompt-draft";
import { appliedQuestionPrompt, appliedSuggestions } from "@/components/AskAgentAboutJob";

export default function JobStatusDialog({
  job,
  showDialog,
  onClose,
  userId,
}: {
  job: AllJobWithRelations | TJobIdPageData;
  showDialog: boolean;
  onClose: () => void;
  userId: string | null;
}) {
  const [loading, setLoading] = useState(false);
  // After "Yes", the dialog shows the agent's next steps instead of closing.
  const [tracked, setTracked] = useState(false);
  const updateJobApplicationStatus = async () => {
    try {
      setLoading(true);
      const supabase = createClient();
      const { error } = await supabase.from("applications").insert({
        applicant_user_id: userId,
        status: "submitted",
        all_jobs_id: job.id,
      });
      if (error) throw error;

      await mutate(PROFILE_API_KEY);

      setTracked(true);
    } catch {
      toast.error(
        "Some error occured while updating the application status. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <AlertDialog open={showDialog}>
      <AlertDialogContent>
        {tracked ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Application tracked</AlertDialogTitle>
              <AlertDialogDescription>
                {job.job_name && job.company_name
                  ? `Your application for ${job.job_name} at ${job.company_name} is in your applications.`
                  : "Your application is in your applications."}{" "}
                Want the agent to help with what comes next?
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div onClick={stop}>
              <AgentHandoff
                label="Ask the agent about this application"
                placeholder="How do I follow up if I don't hear back?…"
                basePath={AGENT_PATH}
                toPrompt={(question) => appliedQuestionPrompt(job, question)}
                onHandoff={onClose}
              />
            </div>
            <div role="group" aria-label="Agent suggestions" className="flex flex-wrap gap-2">
              {appliedSuggestions(job).map(({ label, prompt }) => (
                <Link
                  key={label}
                  href={agentPromptHref(prompt, AGENT_PATH)}
                  onClick={(e) => {
                    e.stopPropagation();
                    savePendingPrompt(prompt);
                    onClose();
                  }}
                  className="rounded-full border bg-background px-3 py-1 text-sm transition-colors hover:border-brand/40 hover:bg-brandSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  {label}
                </Link>
              ))}
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button
                  variant={"secondary"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                >
                  Done
                </Button>
              </AlertDialogCancel>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Did you apply for the role of {job.job_name} at{" "}
                {job.company_name}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This helps us track your application status.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button
                  variant={"secondary"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  disabled={loading}
                >
                  No
                </Button>
              </AlertDialogCancel>
              {/* A plain Button, not AlertDialogAction: the dialog stays open for the next step. */}
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  updateJobApplicationStatus();
                }}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Yes
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
