"use client";

import React, { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { Textarea } from "../ui/textarea";

interface JdSectionProps {
  isJdPaneOpen: boolean;
  setIsJdPaneOpen: (isOpen: boolean) => void;
  isParsed: boolean;
  isAnalyzing: boolean;
  jdText: string;
  setJdText: (text: string) => void;
  runAnalysis: () => Promise<string | undefined>;
}

export default function JdSection({
  isJdPaneOpen,
  setIsJdPaneOpen,
  isParsed,
  isAnalyzing,
  jdText,
  setJdText,
  runAnalysis,
}: JdSectionProps) {
  const [localJd, setLocalJd] = useState(jdText);

  //   useEffect(() => {
  //     setLocalJd(jdText);
  //   }, [jdText]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localJd !== jdText) {
        setJdText(localJd);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [localJd, jdText, setJdText]);

  return (
    <div
      className={cn(
        "flex flex-col p-4 bg-background shadow-[0_-1px_0_rgba(0,0,0,0.05)] dark:shadow-[0_-1px_0_rgba(255,255,255,0.05)] transition-all duration-300",
        isJdPaneOpen ? "h-[500px] sm:flex-[0.4] space-y-5" : "shrink"
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
          </div>
          <p className="text-xs text-muted-foreground ">
            Analyze your experience against these specific requirements
          </p>
        </div>

        <Button
          size="sm"
          onClick={runAnalysis}
          disabled={!isParsed || !localJd.trim() || isAnalyzing}
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
          isJdPaneOpen ? "h-[300px] sm:h-auto flex-1" : "h-0 overflow-hidden"
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
