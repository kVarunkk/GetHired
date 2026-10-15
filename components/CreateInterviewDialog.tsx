"use client";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { Button } from "./ui/button";
import { startTransition, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertCircle, ArrowLeft, Loader2, Plus } from "lucide-react";
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
import { useProgress } from "react-transition-progress";

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
  const startProgress = useProgress();

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
    } catch (e) {
      setError((e as Error).message || "Invalid job URL.");
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
        setOpen(false);
        toast.success("Interview created successfully!");
        startTransition(() => {
          startProgress();
          router.push(`/interview/${result.interviewId}`);
        });
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
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button variant="brand" className="max-w-full">
          <Plus className="w-4 h-4" />
          <span className="truncate">Create Interview</span>
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="sm:max-w-xl">
        <ResponsiveDialogHeader className="text-start">
          <ResponsiveDialogTitle>Create an AI Interview</ResponsiveDialogTitle>
          {/* Inline text, not flex, so a narrow screen wraps it like a sentence. */}
          <ResponsiveDialogDescription>
            {creditsState} AI Credits available.{" "}
            <Link
              href={"/dashboard/buy-credits"}
              className="whitespace-nowrap font-medium underline underline-offset-4"
            >
              Recharge Credits
            </Link>
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {view === "resume" ? (
          <ResponsiveDialogBody className="flex flex-col gap-4">
            <div className="text-sm font-medium text-muted-foreground">
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
          </ResponsiveDialogBody>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              handleSubmit(formData);
            }}
            className="flex min-h-0 flex-col gap-4"
          >
            <ResponsiveDialogBody className="flex flex-col gap-4">
              {/* min-w-0 lets the resume name truncate instead of pushing the row wider than the drawer. */}
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
                {selectedResume ? (
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="shrink-0">Using</span>
                    <span
                      title={selectedResume?.name ?? "Selected Resume"}
                      className="min-w-0 truncate font-medium text-foreground"
                    >
                      {selectedResume?.name}
                    </span>
                  </div>
                ) : (
                  <p>Select a Resume</p>
                )}
                <Button
                  type="button"
                  variant={"link"}
                  onClick={() => setView("resume")}
                  className="h-auto shrink-0 p-0 text-muted-foreground underline"
                >
                  Change
                </Button>
              </div>

              <div className="grid gap-2">
                <Label>Interview Name (Optional)</Label>
                <Input
                  name="name"
                  placeholder="e.g., Full Stack Developer Interview"
                />
              </div>

              <div className="grid gap-2">
                <Label>
                  Job URL{" "}
                  <InfoTooltip
                    content="
                                Enter a valid Job URL from GetHired. For e.g., https://gethired.devhub.co.in/jobs/bf28fb7d-8a09-45f4-8376-c391c64ca782
                                "
                  />
                </Label>
                <Input
                  required
                  name="jobUrl"
                  placeholder="e.g., https://gethired.devhub.co.in/jobs/bf28fb7d-8a09-45f4-8376-c391c64ca782"
                  value={jobUrl}
                  onChange={(event) => setJobUrl(event.target.value)}
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
                >
                  <AlertCircle aria-hidden className="h-4 w-4 shrink-0" />
                  <p>{error}</p>
                  {!isOnboardingComplete && (
                    <Link
                      href={"/get-started"}
                      className="font-medium underline underline-offset-4"
                    >
                      Complete Profile
                    </Link>
                  )}
                </div>
              )}
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button
                variant="brand"
                disabled={isLoading || creditsState < TAICredits.AI_INTERVIEW}
                className="w-full"
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Interview
              </Button>
            </ResponsiveDialogFooter>
          </form>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
