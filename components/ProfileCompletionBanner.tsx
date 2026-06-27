"use client";

import Link from "next/link";
import { Button } from "./ui/button";
import { BriefcaseBusiness, Mail, Timer } from "lucide-react";

export default function ProfileCompletionBanner() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 bg-primary-foreground rounded-xl shadow-2xl border border-primary/20 my-10">
      <h2 className="text-3xl sm:text-4xl font-extrabold text-primary text-center mb-3 tracking-tight">
        You are missing out on better matches
      </h2>

      <div className="flex items-center flex-wrap justify-center gap-4  text-primary/70 text-center mb-8 max-w-2xl">
        <div className="flex items-center gap-1">
          <BriefcaseBusiness className="shrink-0 w-4" />
          <p>Jobs tailored for you</p>
        </div>
        <div className="flex items-center gap-1">
          <Mail className="shrink-0 w-4" />
          <p>Daily Job Digest</p>
        </div>
        <div className="flex items-center gap-1">
          <Timer className="shrink-0 w-4" />
          <p>2 min to complete</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        <Link className="w-full" href={"/get-started"} passHref>
          <Button
            size="lg"
            className="w-full sm:w-auto px-8 py-3 text-lg font-semibold transition-transform duration-200 hover:scale-[1.03] shadow-lg shadow-primary/30"
          >
            Complete Profile
          </Button>
        </Link>
      </div>
    </div>
  );
}
