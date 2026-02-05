"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "../components/ui/dialog";
import { toast } from "react-hot-toast";
import { Loader2, Plus } from "lucide-react";
import ResumeSourceSelector from "./ResumeSourceSelector";
import { createClient } from "@/lib/supabase/client";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { IResume, TAICredits } from "@/lib/types";
import InfoTooltip from "./InfoTooltip";
import { createResumeReviewAction } from "@/app/actions/create-resume-review";

interface CreateResumeReviewDialogProps {
  userId: string;
}

export default function CreateResumeReviewDialog({
  userId,
}: CreateResumeReviewDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [existingResumes, setExistingResumes] = useState<IResume[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    if (isOpen && userId) {
      const fetchResumes = async () => {
        try {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("resumes")
            .select("id, name, created_at, is_primary")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

          if (!error) {
            setExistingResumes((data || []) as IResume[]);
          }
        } catch {
          // console.error("Asset fetch failed", err);
        }
      };
      fetchResumes();
    }
  }, [isOpen, userId]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!file && !selectedResumeId) {
      toast.error("Please provide a resume source.");
      return;
    }

    setIsLoading(true);
    const formData = new FormData(e.currentTarget);
    formData.append("userId", userId);

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
        router.push(`/resume-review/${result.reviewId}`);
      }
    } catch {
      toast.error("Initialization failed. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4" />
          Create CV Review
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[450px] max-h-[90vh] flex flex-col overflow-hidden">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-2 space-y-6">
            <DialogHeader className="space-y-3">
              <DialogTitle>Create AI Review</DialogTitle>
              <DialogDescription className=" ">
                Tailor your experience by choosing an existing asset or
                uploading a new PDF.{" "}
                <InfoTooltip
                  content={
                    <p>
                      This analysis consumes {TAICredits.AI_CV_REVIEW} Credits.
                    </p>
                  }
                />
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-6 ">
              <div className="grid gap-2">
                <Label className="">Review Label (Optional)</Label>
                <Input
                  name="name"
                  placeholder="e.g., Lead Developer @ Stripe"
                  className="bg-input"
                />
              </div>

              <div className="grid gap-2">
                <Label>Source Document</Label>
                <ResumeSourceSelector
                  existingResumes={existingResumes}
                  selectedId={selectedResumeId}
                  onSelectExisting={setSelectedResumeId}
                  file={file}
                  onFileChange={setFile}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="mt-auto shrink-0 flex flex-col gap-4 sm:flex-col sm:space-x-0 pt-4">
            <Button
              type="submit"
              disabled={isLoading || (!file && !selectedResumeId)}
              className="w-full  "
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
