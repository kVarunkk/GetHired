import FootComponent from "@/components/FootComponent";
import AIFeatures from "@/components/landing-page/AIFeatures";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import Hero from "@/components/landing-page/Hero";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import PlatformStats from "@/components/landing-page/PlatformStats";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import { getPlatformStats } from "@/utils/platform-stats";
import { JOB_SEEKER_DARK, JOB_SEEKER_LIGHT } from "@/utils/utils";

export const revalidate = 86400;
export const dynamic = "force-static";

export default async function Home() {
  const { jobCount, applicationCount, resumeCount, userCount } =
    await getPlatformStats();

  return (
    <div className="flex-1 flex flex-col gap-32 w-full">
      <Hero
        heading="Find Your Next Tech Job"
        subheading={`Explore ${jobCount.toLocaleString()} developer and tech job listings, including remote opportunities, and use AI to focus your search.`}
        ctaText="Get Hired"
        ctaText2="Hire Talent"
        ctaLink="/jobs"
        ctaLink2="/hire"
        imgLight={JOB_SEEKER_LIGHT}
        imgDark={JOB_SEEKER_DARK}
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
