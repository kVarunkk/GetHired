import { Sparkles } from "lucide-react";
import Hero, { HeroEyebrow } from "@/components/landing-page/Hero";
import { agentPromptHref } from "@/helpers/agent/prompt-draft";
import { IMPROVE_RESUME_PROMPT } from "@/helpers/marketing/content";
import { LANDING_PAGES } from "@/helpers/marketing/content";
import ResumeCheckerHeroDemo from "@/components/landing-page/ResumeCheckerHeroDemo";

export default function HeroAiResumeChecker() {
  const page = LANDING_PAGES["ai-resume-checker"];
  const cta = page.ctas[0];
  return (
    <Hero
      eyebrow={
        <HeroEyebrow
          href={agentPromptHref(IMPROVE_RESUME_PROMPT)}
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Ask the agent"
          detail="Improve your resume for a job you like"
        />
      }
      heading={page.heading}
      subheading={page.subheading(0)}
      ctaText={cta.label}
      ctaLink={cta.href}
      preview={<ResumeCheckerHeroDemo />}
    />
  );
}
