import { Sparkles } from "lucide-react";
import Hero, { HeroEyebrow } from "@/components/landing-page/Hero";
import { agentPromptHref } from "@/helpers/agent/prompt-draft";
import { LANDING_PAGES } from "@/helpers/marketing/content";
import ResumeCheckerHeroDemo from "@/components/landing-page/ResumeCheckerHeroDemo";

export default function HeroAiResumeChecker() {
  const page = LANDING_PAGES["ai-resume-checker"];
  const cta = page.ctas[0];
  return (
    <Hero
      eyebrow={
        <HeroEyebrow
          href={agentPromptHref("Review my resume against a job I like. Ask me which job first.")}
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Ask the agent"
          detail="Review your resume against a job you like"
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
