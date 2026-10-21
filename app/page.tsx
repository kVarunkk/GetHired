import FootComponent from "@/components/FootComponent";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import AgentHeroDemo from "@/components/landing-page/AgentHeroDemo";
import Hero from "@/components/landing-page/Hero";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import PlatformStats from "@/components/landing-page/PlatformStats";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import { getPlatformStats } from "@/utils/platform-stats";
import type { Metadata } from "next";
import { LANDING_PAGES, markdownAlternate } from "@/helpers/marketing/content";

const page = LANDING_PAGES.home;

export const metadata: Metadata = {
  title: { absolute: "Find Tech & Remote Jobs | GetHired" },
  description: page.description,
  alternates: { canonical: "/", types: markdownAlternate(page.path) },
  openGraph: {
    type: "website",
    siteName: "GetHired",
    title: "Find Tech & Remote Jobs | GetHired",
    description:
      "Search developer and tech jobs, including remote roles, and use AI tools to focus your job search.",
    url: "/",
    images: ["/opengraph-image.jpg"],
  },
};

export const revalidate = 86400;
export const dynamic = "force-static";

export default async function Home() {
  const { jobCount, applicationCount, resumeCount, userCount } =
    await getPlatformStats();

  return (
    <div className="flex-1 flex flex-col gap-32 w-full">
      <Hero
        heading={page.heading}
        subheading={page.subheading(jobCount)}
        ctaText={page.ctas[0].label}
        ctaText2={page.ctas[1].label}
        ctaLink={page.ctas[0].href}
        ctaLink2={page.ctas[1].href}
        preview={<AgentHeroDemo />}
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
  );
}
