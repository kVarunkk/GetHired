import { Sparkles } from "lucide-react";
import Hero, { HeroEyebrow } from "@/components/landing-page/Hero";
import { agentPromptHref } from "@/helpers/agent/prompt-draft";
import { LANDING_PAGES } from "@/helpers/marketing/content";
import InterviewHeroDemo from "@/components/landing-page/InterviewHeroDemo";

export default function HeroAiInterview() {
  const page = LANDING_PAGES["ai-interview"];
  const cta = page.ctas[0];
  return (
    <Hero
      eyebrow={
        <HeroEyebrow
          href={agentPromptHref("Set up a mock interview for a job I'm applying to. Ask me which job first.")}
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Ask the agent"
          detail="Set up a mock interview for a job in one message"
        />
      }
      heading={page.heading}
      subheading={page.subheading(0)}
      ctaText={cta.label}
      ctaLink={cta.href}
      preview={<InterviewHeroDemo />}
    />
  );
}
