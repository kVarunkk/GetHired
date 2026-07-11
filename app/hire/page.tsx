import FootComponent from "@/components/FootComponent";
import AIFeatures from "@/components/landing-page/AIFeatures";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import Hero from "@/components/landing-page/Hero";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import PlatformStats from "@/components/landing-page/PlatformStats";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import { getPlatformStats } from "@/utils/serverUtils";
import { HIRE_PAGE_DARK } from "@/utils/utils";
import { HIRE_PAGE_LIGHT } from "@/utils/utils";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "GetHired - Your smartest path to the perfect candidate",
  description:
    "Leverage proprietary AI to screen and qualify candidates instantly. Post your job, eliminate noise, and significantly reduce your time-to-hire with an always-on, empathetic recruiting co-pilot.",
  keywords: [
    "hire tech talent",
    "ai recruiting platform",
    "post job free",
    "conversational AI hiring",
    "recruitment software",
    "find developers",
    "ats",
  ],
};

export const revalidate = 86400;
export const dynamic = "force-static";

export default async function HirePage() {
  const { jobCount, applicationCount, resumeCount, userCount } =
    await getPlatformStats();

  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        <div className="flex-1 flex flex-col gap-32  w-full">
          <Hero
            heading="Smartest Path to the Perfect Candidate"
            subheading="Find Exceptional candidates, Streamline your screening, and connect Directly with motivated talent"
            ctaText="Hire Talent"
            ctaLink="/auth/sign-up?company=true"
            imgLight={HIRE_PAGE_LIGHT}
            imgDark={HIRE_PAGE_DARK}
          />
          <HowWeHelp jobCount={jobCount} />
          <AIFeatures />
          <PlatformStats
            applicationCount={applicationCount}
            resumeCount={resumeCount}
            userCount={userCount}
          />
          <TheGetHiredAdvantageSection jobCount={jobCount} />
          <FAQSection />
          <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
            <FootComponent />
          </div>
          <Footer />
        </div>
      </div>
    </main>
  );
}
