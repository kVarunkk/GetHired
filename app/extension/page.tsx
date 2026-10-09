import FootComponent from "@/components/FootComponent";
import AIFeatures from "@/components/landing-page/AIFeatures";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import Hero from "@/components/landing-page/Hero";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import PlatformStats from "@/components/landing-page/PlatformStats";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import { getPlatformStats } from "@/utils/platform-stats";
import { CHROME_EXTENSION_DARK, CHROME_EXTENSION_LIGHT } from "@/utils/utils";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "GetHired Chrome Extension",
  description:
    "Discover the GetHired Chrome Extension that fills Job Applications on any platform in a single click",
  keywords: [
    "GetHired Chrome Extension",
    "AI-powered job search",
    "job application automation",
    "Chrome Extension",
  ],
  robots: {
    index: false,
    follow: true,
  },
};

export const revalidate = 86400;
export const dynamic = "force-static";

export default async function MCPServerPage() {
  const { jobCount, applicationCount, resumeCount, userCount } =
    await getPlatformStats();
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        <div className="flex-1 flex flex-col gap-32  w-full">
          <Hero
            heading="GetHired Chrome Extension"
            subheading="Discover the GetHired Chrome Extension, a powerful tool designed to enhance your job application experience."
            ctaText="Coming Soon"
            // ctaText2="Learn More"
            ctaLink="#"
            // ctaLink2="#"
            imgLight={CHROME_EXTENSION_LIGHT}
            imgDark={CHROME_EXTENSION_DARK}
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
      </div>
    </main>
  );
}
