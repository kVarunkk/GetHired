import FootComponent from "@/components/FootComponent";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import Hero from "@/components/landing-page/Hero";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import PlatformStats from "@/components/landing-page/PlatformStats";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import { getPlatformStats } from "@/utils/platform-stats";
import { CHROME_EXTENSION_DARK, CHROME_EXTENSION_LIGHT } from "@/utils/utils";
import { Metadata } from "next";
import { LANDING_PAGES, markdownAlternate } from "@/helpers/marketing/content";

const page = LANDING_PAGES.extension;

export const metadata: Metadata = {
  title: "GetHired Chrome Extension",
  description: page.description,
  alternates: { types: markdownAlternate(page.path) },
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
            heading={page.heading}
            subheading={page.subheading(jobCount)}
            ctaText={page.ctas[0].label}
            ctaLink={page.ctas[0].href}
            imgLight={CHROME_EXTENSION_LIGHT}
            imgDark={CHROME_EXTENSION_DARK}
          />
          <HowWeHelp jobCount={jobCount} />
          <PlatformStats
            applicationCount={applicationCount}
            resumeCount={resumeCount}
            userCount={userCount}
          />
          <TheGetHiredAdvantageSection jobCount={jobCount} />
          <FAQSection topic={page.faq} />
          <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
            <FootComponent />
          </div>
          <Footer />
        </div>
      </div>
    </main>
  );
}
