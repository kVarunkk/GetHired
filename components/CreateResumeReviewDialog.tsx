"use client";

import React, { useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogBody,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { toast } from "react-hot-toast";
import { Loader2, Plus } from "lucide-react";
import ResumeSourceSelector from "./ResumeSourceSelector";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { TAICredits } from "@/utils/types";
import InfoTooltip from "./InfoTooltip";
import { createResumeReviewAction } from "@/app/actions/create-resume-review";
import { useProgress } from "react-transition-progress";
import useSWR from "swr";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";
import { TResumeReviewResume } from "@/utils/types/review.types";

export default function CreateResumeReviewDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);

  const startProgress = useProgress();

  const router = useRouter();

  const { data } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });
  const existingResumes: TResumeReviewResume[] =
    data && data.profile ? data.profile.resumes : [];

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!file && !selectedResumeId) {
      toast.error("Please provide a resume source.");
      return;
    }

    setIsLoading(true);
    const formData = new FormData(e.currentTarget);

    if (selectedResumeId) formData.append("existingResumeId", selectedResumeId);
    if (file) formData.append("file", file);

    try {
      const result = await createResumeReviewAction(formData);

      if (result.error) {
        toast.error(result.error);
        setIsLoading(false);
      } else if (result.success && result.reviewId) {
        toast.success("Workspace initialized!");
        setIsOpen(false);
        startTransition(() => {
          startProgress();
          router.push(`/resume-review/${result.reviewId}`);
        });
      }
    } catch {
      toast.error("Initialization failed. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <ResponsiveDialog open={isOpen} onOpenChange={setIsOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button variant="brand" className="max-w-full">
          <Plus className="w-4 h-4" />
          <span className="truncate">Create CV Review</span>
        </Button>
      </ResponsiveDialogTrigger>

      <ResponsiveDialogContent className="sm:max-w-[450px]">
        <ResponsiveDialogHeader className="space-y-3">
          <ResponsiveDialogTitle>Create AI Review</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Tailor your experience by choosing an existing asset or uploading a
            new PDF.{" "}
            <InfoTooltip
              content={
                <p>
                  This analysis consumes {TAICredits.AI_SEARCH_ASK_AI_RESUME}{" "}
                  Credits.
                </p>
              }
            />
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col gap-4">
          {/* Flex columns, not grids: an auto grid track grows to fit a long
              resume name and pushes the list wider than the drawer. */}
          <ResponsiveDialogBody className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Label>Review Label (Optional)</Label>
              <Input name="name" placeholder="e.g., Lead Developer @ Stripe" />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Source Document</Label>
              <ResumeSourceSelector
                existingResumes={existingResumes}
                selectedId={selectedResumeId}
                onSelectExisting={setSelectedResumeId}
                file={file}
                onFileChange={setFile}
              />
            </div>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button
              type="submit"
              disabled={isLoading || (!file && !selectedResumeId)}
              variant="brand"
              className="w-full"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </div>
              ) : (
                "Create CV Review"
              )}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
