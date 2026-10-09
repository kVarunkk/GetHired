import FootComponent from "@/components/FootComponent";
import AIFeatures from "@/components/landing-page/AIFeatures";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import Hero from "@/components/landing-page/Hero";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import PlatformStats from "@/components/landing-page/PlatformStats";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import { getPlatformStats } from "@/utils/platform-stats";
import { HIRE_PAGE_DARK } from "@/utils/utils";
import { HIRE_PAGE_LIGHT } from "@/utils/utils";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Recruiting Software to Hire Tech Talent",
  description:
    "Post tech roles, review applicants, and use AI recruiting tools to help identify qualified candidates with GetHired.",
  alternates: {
    canonical: "/hire",
  },
  openGraph: {
    type: "website",
    siteName: "GetHired",
    title: "AI Recruiting Software to Hire Tech Talent",
    description:
      "Post tech roles, review applicants, and use AI recruiting tools to help identify qualified candidates with GetHired.",
    url: "/hire",
  },
  twitter: {
    card: "summary",
    title: "AI Recruiting Software to Hire Tech Talent",
    description:
      "Post tech roles, review applicants, and use AI recruiting tools to help identify qualified candidates with GetHired.",
  },
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
            heading="Hire Tech Talent with AI"
            subheading="Post developer and tech roles, review applicants, and use AI recruiting tools to find qualified candidates."
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
          <FAQSection topic="hiring" />
          <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
            <FootComponent />
          </div>
          <Footer />
        </div>
      </div>
    </main>
  );
}
