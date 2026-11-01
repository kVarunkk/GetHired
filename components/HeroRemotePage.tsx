import { Sparkles } from "lucide-react";
import { agentPromptHref } from "@/helpers/agent/prompt-draft";
import AgentHeroDemo from "./landing-page/AgentHeroDemo";
import Hero, { HeroEyebrow } from "./landing-page/Hero";

export default function HeroRemotePage({
  location,
  jobCount,
}: {
  location: string;
  jobCount: number;
}) {
  const decodedLocation = decodeURIComponent(location);

  return (
    <Hero
      eyebrow={
        <HeroEyebrow
          href={agentPromptHref(`Find remote jobs in ${decodedLocation} posted this week.`)}
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Ask the agent"
          detail={`Find remote jobs in ${decodedLocation} by chatting`}
        />
      }
      heading={`Top Remote Jobs in ${decodedLocation}`}
      subheading={`Find your next remote job from over ${jobCount.toLocaleString()} quality listings with the power of AI`}
      ctaText="Find Remote Jobs"
      ctaLink={`/jobs?location=${location.toLowerCase()}|remote&sortBy=created_at&sortOrder=desc`}
      preview={<AgentHeroDemo />}
    />
  );
}
