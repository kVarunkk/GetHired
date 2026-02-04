"use client";

import { Sparkles } from "lucide-react";
import { useTheme } from "next-themes";
import Image from "next/image";
import { useEffect, useState } from "react";
import WaitlistForm from "./WaitlistForm";
import { TWaitlistType } from "@/lib/types";

const JOB_SEEKER_DARK = "/hero/dark-ai-resume-checker.png";
const JOB_SEEKER_LIGHT = "/hero/light-ai-resume-checker.png";

const maskStyle = {
  maskImage: "linear-gradient(to bottom, black 70%, transparent 100%)",
  WebkitMaskImage: "linear-gradient(to bottom, black 70%, transparent 100%)", // For older browsers
};

export default function HeroAiResumeChecker() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    setMounted(true);
  }, []);

  const getImagePath = () => {
    return isDark ? JOB_SEEKER_DARK : JOB_SEEKER_LIGHT;
  };

  return (
    <div className="flex flex-col gap-5 w-full items-center text-center px-4 py-3 lg:px-20 xl:px-40 2xl:px-80">
      <div className="space-y-4 max-w-3xl">
        <div className="space-y-4 max-w-3xl">
          {/* Badge: Using brandSoft for the background and brand for text/border */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brandSoft border border-brand/20 text-brand dark:text-primary text-[10px] font-bold uppercase tracking-widest mb-2 animate-in fade-in slide-in-from-top-2 duration-700">
            <Sparkles size={12} />
            Coming Soon: Advanced AI Analysis
          </div>

          <h1 className="text-5xl sm:text-7xl font-black tracking-tight leading-[1.1]">
            AI Resume Checker
          </h1>

          <p className="text-muted-foreground text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
            Optimizing your technical presence for the modern ATS. Join the list
            to get early access to deep semantic analysis.
          </p>
        </div>
      </div>

      {/* REUSABLE WAITLIST COMPONENT */}
      <div className="w-full flex flex-col items-center">
        <WaitlistForm type={TWaitlistType.AI_RESUME_CHECKER} />
      </div>

      {mounted && (
        <Image
          className="rounded-xl border border-border drop-shadow-xl mt-8"
          src={getImagePath()} // Using the new local path function
          style={maskStyle}
          height={2000}
          width={2000}
          alt="Snapshot of the GetHired's CV Reviewer"
          priority // Set priority to load this critical image fast
        />
      )}
    </div>
  );
}
