"use client";

import React, { useState, startTransition, useRef } from "react";
import { ChevronDown, ChevronUp, Loader2, Save } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../utils/utils";
import { Textarea } from "../ui/textarea";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";

interface JdSectionProps {
  isJdPaneOpen: boolean;
  setIsJdPaneOpen: (isOpen: boolean) => void;
  isParsed: boolean;
  isAnalyzing: boolean;
  initialJd: string;
  reviewId: string;
  runAnalysis: (jd: string) => Promise<void>;
}

export default function JdSection({
  isJdPaneOpen,
  setIsJdPaneOpen,
  isParsed,
  isAnalyzing,
  initialJd,
  reviewId,
  runAnalysis,
}: JdSectionProps) {
  const [localJd, setLocalJd] = useState(initialJd);
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

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
      startTransition(() => router.refresh());
    } catch (err) {
      console.error("Auto-save failed:", err);
      toast.error("Progress not saved.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunAnalysis = async () => {
    if (!localJd.trim())
      return toast.error("Please paste a Job Description first.");
    await saveJd();
    await runAnalysis(localJd);
  };

  return (
    <div
      className={cn(
        "flex flex-col p-4 bg-background shadow-[0_-1px_0_rgba(0,0,0,0.05)] dark:shadow-[0_-1px_0_rgba(255,255,255,0.05)] transition-all duration-300",
        isJdPaneOpen ? "h-[500px] sm:flex-[0.4] space-y-5" : "shrink",
      )}
    >
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="font-bold text-lg">Target Job Description</label>
            <button
              type="button"
              className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-md transition-colors"
              onClick={() => setIsJdPaneOpen(!isJdPaneOpen)}
            >
              {isJdPaneOpen ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              )}
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
          onClick={handleRunAnalysis}
          disabled={!isParsed || !localJd.trim() || isAnalyzing || isSaving}
          className=" disabled:opacity-30 disabled:grayscale"
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

      <div
        className={cn(
          "relative group transition-all duration-300",
          isJdPaneOpen ? "h-[300px] sm:h-auto flex-1" : "h-0 overflow-hidden",
        )}
      >
        <Textarea
          value={localJd}
          onChange={(e) => setLocalJd(e.target.value)}
          placeholder="Paste the Job Description (JD) here"
          className="h-full w-full bg-input transition-all  text-sm p-4 rounded-xl resize-none"
        />
      </div>
    </div>
  );
}
