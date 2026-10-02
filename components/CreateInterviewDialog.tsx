"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { TAICredits } from "@/utils/types";
import InfoTooltip from "./InfoTooltip";
import useSWR from "swr";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";
import ResumeSourceSelector from "./ResumeSourceSelector";
import { TResumeReviewResume } from "@/utils/types/review.types";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { createInterviewAction } from "@/app/actions/create-interview";
import { useRouter } from "next/navigation";

interface CreateInterviewDialogProps {
  initialOpen?: boolean;
  initialJobUrl?: string;
}

export default function CreateInterviewDialog({
  initialOpen = false,
  initialJobUrl = "",
}: CreateInterviewDialogProps) {
  const [open, setOpen] = useState(initialOpen);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"form" | "resume">("form");
  const [jobUrl, setJobUrl] = useState(initialJobUrl);
  const [selectedResume, setSelectedResume] =
    useState<TResumeReviewResume | null>(null);
  const router = useRouter();

  const { data } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });
  const isOnboardingComplete =
    data && data.profile ? data.profile.filled : false;
  const creditsState = data && data.profile ? data.profile.ai_credits : 0;
  const existingResumes: TResumeReviewResume[] =
    data && data.profile ? data.profile.resumes : [];

  useEffect(() => {
    if (existingResumes && existingResumes.length > 0) {
      const primaryResume = existingResumes.find((resume) => resume.is_primary);
      setSelectedResume(primaryResume || existingResumes[0]);
    }
  }, [existingResumes]);

  const handleSubmit = async (formData?: FormData) => {
    setError(null);
    if (!selectedResume?.id) {
      setError("Please select a resume.");
      return;
    }
    if (creditsState < TAICredits.AI_INTERVIEW) {
      setError("Insufficient AI credits. Please top up to continue.");
      return;
    }
    if (!isOnboardingComplete) {
      setError("Please complete your profile to use this feature.");
      return;
    }
    const interviewName = formData?.get("name")?.toString()?.trim() || null;
    const resumeId = selectedResume?.id;
    const submittedJobUrl = formData?.get("jobUrl")?.toString()?.trim();
    let jobId: string | null = null;

    try {
      if (
        !submittedJobUrl ||
        (!/^https?:\/\//i.test(submittedJobUrl) &&
          !submittedJobUrl.startsWith("/jobs/"))
      ) {
        throw new Error("Invalid job URL.");
      }

      const parsedJobUrl = new URL(submittedJobUrl, window.location.origin);
      if (!["http:", "https:"].includes(parsedJobUrl.protocol)) {
        throw new Error("Invalid job URL.");
      }

      jobId = parsedJobUrl.pathname.split("/").filter(Boolean).pop() ?? null;
    } catch {
      setError("Invalid job URL or resume selection.");
      return;
    }

    if (!jobId || !resumeId) {
      setError("Invalid job URL or resume selection.");
      return;
    }

    setIsLoading(true);

    try {
      const result = await createInterviewAction(
        interviewName,
        resumeId,
        jobId!,
      );

      if (result.error) {
        setError(result.error);
      } else if (result.success && result.interviewId) {
        toast.success("Interview created successfully!");
        router.push(`/interview/${result.interviewId}`);
      }
    } catch (error) {
      toast.error(
        `Search failed: ${(error as Error).message}. Please try again.`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4" />
          Create Interview
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle>Create an AI Interview</DialogTitle>
          <DialogDescription className="flex items-center gap-1">
            {creditsState} AI Credits available.{" "}
            <Link href={"/dashboard/buy-credits"} className="text-blue-500">
              Recharge Credits
            </Link>
            <InfoTooltip
              content={
                "This feature uses " +
                TAICredits.AI_INTERVIEW +
                " AI credits per use."
              }
            />
          </DialogDescription>
        </DialogHeader>

        {view === "resume" ? (
          <div className="flex flex-col gap-4">
            <div className="text-sm font-semibold text-muted-foreground">
              <Button
                type="button"
                onClick={() => setView("form")}
                variant={"link"}
              >
                <ArrowLeft /> Back
              </Button>
            </div>
            <ResumeSourceSelector
              existingResumes={existingResumes}
              selectedId={selectedResume?.id || null}
              onSelectExisting={(id) => {
                const resume =
                  existingResumes?.find((r) => r.id === id) || null;
                setSelectedResume(resume);
              }}
              file={null}
              onFileChange={() => {}}
              view="select"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="text-sm flex items-center font-semibold text-muted-foreground">
              {selectedResume ? (
                <div className="flex items-center gap-1">
                  Using
                  <span
                    title={selectedResume?.name ?? "Selected Resume"}
                    className="font-bold inline-block w-[10rem] truncate"
                  >
                    {selectedResume?.name}
                  </span>
                </div>
              ) : (
                <p>Select a Resume</p>
              )}
              <Button
                variant={"link"}
                onClick={() => setView("resume")}
                className="text-muted-foreground underline"
              >
                Change
              </Button>
            </div>

            <div className="flex flex-col gap-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  handleSubmit(formData);
                }}
                className="flex flex-col space-y-4"
              >
                <div className="grid gap-2">
                  <Label>Interview Name (Optional)</Label>
                  <Input
                    name="name"
                    placeholder="e.g., Full Stack Developer Interview"
                    className="bg-input"
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Job URL</Label>
                  <Input
                    required
                    name="jobUrl"
                    placeholder="e.g., https://gethired.devhub.co.in/jobs/bf28fb7d-8a09-45f4-8376-c391c64ca782"
                    className="bg-input"
                    value={jobUrl}
                    onChange={(event) => setJobUrl(event.target.value)}
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm">
                    <p className="text-red-600 ">{error}</p>
                    {!isOnboardingComplete && (
                      <Link
                        href={"/get-started"}
                        className="text-blue-400 underline"
                      >
                        Complete Profile
                      </Link>
                    )}
                  </div>
                )}
                <Button
                  disabled={isLoading || creditsState < TAICredits.AI_INTERVIEW}
                >
                  {isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Create Interview
                </Button>
              </form>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
