"use client";

import React, { useState, useRef } from "react";
import { ChevronDown, Loader2, Save } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../utils/utils";
import { Textarea } from "../ui/textarea";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
import { mutate } from "swr";

interface JdSectionProps {
  isJdPaneOpen: boolean;
  setIsJdPaneOpen: (isOpen: boolean) => void;
  isParsed: boolean;
  isAnalyzing: boolean;
  initialJd: string;
  reviewId: string;
  runAnalysis: () => Promise<void>;
  changeTriggerState: (
    state: "idle" | "saving_jd" | "triggering_analysis" | "triggering_parse",
  ) => void;
}

export default function JdSection({
  isJdPaneOpen,
  setIsJdPaneOpen,
  isParsed,
  isAnalyzing,
  initialJd,
  reviewId,
  runAnalysis,
  changeTriggerState,
}: JdSectionProps) {
  const [localJd, setLocalJd] = useState(initialJd);
  const [isSaving, setIsSaving] = useState(false);

  const lastSavedJd = useRef(initialJd);

  const saveJd = async () => {
    if (localJd.trim() === lastSavedJd.current.trim() || isSaving) return;
    setIsSaving(true);
    const supabase = createClient();
    try {
      const { error } = await supabase
        .from("resume_reviews")
        .update({ target_jd: localJd, updated_at: new Date().toISOString() })
        .eq("id", reviewId);
      if (error) throw error;
      lastSavedJd.current = localJd;
    } catch {
      toast.error("Some error occured. Progress not saved.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunAnalysis = async () => {
    if (!localJd.trim())
      return toast.error("Please paste a Job Description first.");
    if (window) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    changeTriggerState("triggering_analysis");
    mutate(
      `/api/resume-review/${reviewId}`,
      (currentData) => {
        if (!currentData) return currentData;

        const review = currentData.data || {};

        return {
          ...currentData,
          data: {
            ...review,
            status: "processing",
            analysis_failed: false,
            ai_response: null,
            score: null,
          },
        };
      },
      false,
    );

    await saveJd();
    await runAnalysis();
  };

  return (
    <div className="flex shrink-0 flex-col p-4 bg-background border-t">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-lg font-semibold tracking-tight">
              Target Job Description
            </label>
            <button
              type="button"
              className="p-1 hover:bg-muted rounded-md transition-colors"
              onClick={() => setIsJdPaneOpen(!isJdPaneOpen)}
              aria-expanded={isJdPaneOpen}
              aria-label={
                isJdPaneOpen
                  ? "Collapse job description"
                  : "Expand job description"
              }
            >
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform duration-300",
                  !isJdPaneOpen && "rotate-180",
                )}
              />
            </button>

            {localJd.trim() !== lastSavedJd.current.trim() && (
              <button
                type="button"
                onClick={saveJd}
                disabled={isSaving}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {isSaving ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <Save size={10} />
                )}
                {isSaving ? "Saving..." : "Save"}
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground ">
            Analyze your experience against these specific requirements
          </p>
        </div>

        <Button
          size="sm"
          variant="brand"
          onClick={handleRunAnalysis}
          disabled={!isParsed || !localJd.trim() || isAnalyzing || isSaving}
          className="disabled:opacity-40"
        >
          {isAnalyzing ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing
            </div>
          ) : (
            "Tailor Resume"
          )}
        </Button>
      </div>

      {/* Height animates via grid rows (1fr <-> 0fr); CSS can't transition to or from `auto`. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          isJdPaneOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div
          inert={!isJdPaneOpen}
          className={cn(
            "min-h-0 overflow-hidden transition-opacity duration-300",
            isJdPaneOpen ? "opacity-100" : "opacity-0",
          )}
        >
          {/* Padding sits inside the clipped box so the gap collapses with it, and the focus ring isn't cut off. */}
          <div className="px-0.5 pb-0.5 pt-5">
            <Textarea
              value={localJd}
              onChange={(e) => setLocalJd(e.target.value)}
              placeholder="Paste the Job Description (JD) here"
              className="h-[300px] sm:h-[35vh] w-full text-sm p-4 rounded-xl resize-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
