import { Sparkles } from "lucide-react";
import Image from "next/image";
import { Button } from "./ui/button";
import Link from "next/link";
import { LANDING_PAGES } from "@/helpers/marketing/content";
import {
  HeroMaskStyle,
  RESUME_CHECKER_DARK,
  RESUME_CHECKER_LIGHT,
} from "@/utils/utils";

export default function HeroAiResumeChecker() {
  const page = LANDING_PAGES["ai-resume-checker"];
  const cta = page.ctas[0];
  return (
    <div className="flex flex-col gap-5 w-full items-center text-center px-4 py-3 lg:px-20 xl:px-40 2xl:px-80">
      <div className="space-y-4 max-w-3xl">
        <div className="space-y-4 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brandSoft border border-brand/30 text-brandSoft-foreground text-xs font-medium mb-2 animate-in fade-in slide-in-from-top-2 duration-700">
            <Sparkles size={12} />
            Advanced AI Analysis
          </div>

          <h1 className="text-5xl sm:text-7xl font-semibold tracking-tight leading-[1.1]">
            {page.heading}
          </h1>

          <p className="text-muted-foreground text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
            {page.subheading(0)}
          </p>
        </div>
      </div>

      <div>
        <Link href={cta.href}>
          <Button
            variant="brand"
            className="w-full sm:w-auto h-11 px-8 transition-all active:scale-95"
          >
            {cta.label}
          </Button>
        </Link>
      </div>

      <div>
        <Image
          className="rounded-xl border border-border drop-shadow-xl mt-8 dark:hidden"
          src={RESUME_CHECKER_LIGHT}
          style={HeroMaskStyle}
          height={1200}
          width={1200}
          alt="Snapshot of the GetHired Job Board"
          priority
        />
        <Image
          className="rounded-xl border border-border drop-shadow-xl mt-8 hidden dark:block"
          src={RESUME_CHECKER_DARK}
          style={HeroMaskStyle}
          height={1200}
          width={1200}
          alt="Snapshot of the GetHired Job Board"
          priority
        />
      </div>
    </div>
  );
}
