import FootComponent from "@/components/FootComponent";
import AIFeatures from "@/components/landing-page/AIFeatures";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import AgentHeroDemo from "@/components/landing-page/AgentHeroDemo";
import Hero from "@/components/landing-page/Hero";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import PlatformStats from "@/components/landing-page/PlatformStats";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import { getPlatformStats } from "@/utils/platform-stats";

export const revalidate = 86400;
export const dynamic = "force-static";

export default async function Home() {
  const { jobCount, applicationCount, resumeCount, userCount } =
    await getPlatformStats();

  return (
    <div className="flex-1 flex flex-col gap-32 w-full">
      <Hero
        heading="Your AI Agent for the Job Hunt"
        subheading={`Tell it what you're after. It searches ${jobCount.toLocaleString()} tech jobs, matches them to your resume, reviews your CV and preps you for interviews, all in one chat.`}
        ctaText="Chat with the agent"
        ctaText2="Hire Talent"
        ctaLink="/agent"
        ctaLink2="/hire"
        preview={<AgentHeroDemo />}
      />
      <HowWeHelp jobCount={jobCount} />
      <AIFeatures />
      <PlatformStats
        applicationCount={applicationCount}
        resumeCount={resumeCount}
        userCount={userCount}
      />
      <TheGetHiredAdvantageSection jobCount={jobCount} />
      <FAQSection topic="job-search" />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
        <FootComponent />
      </div>
      <Footer />
    </div>
  );
}
