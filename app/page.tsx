import { shareImages } from "@/helpers/seo/share-image";
import FootComponent from "@/components/FootComponent";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import AgentHeroDemo from "@/components/landing-page/AgentHeroDemo";
import Hero, { HeroEyebrow } from "@/components/landing-page/Hero";
import { agentPromptHref } from "@/helpers/agent/prompt-draft";
import { Sparkles } from "lucide-react";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import PlatformStats from "@/components/landing-page/PlatformStats";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import { getPlatformStats } from "@/utils/platform-stats";
import type { Metadata } from "next";
import { LANDING_PAGES, markdownAlternate } from "@/helpers/marketing/content";
import JsonLd from "@/components/seo/JsonLd";
import {
  landingJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "@/helpers/seo/schema";

const page = LANDING_PAGES.home;

export const metadata: Metadata = {
  title: { absolute: "AI Job Search for Every Role | GetHired" },
  description: page.description,
  alternates: { canonical: "/", types: markdownAlternate(page.path) },
  openGraph: {
    type: "website",
    siteName: "GetHired",
    title: "AI Job Search for Every Role | GetHired",
    description:
      "Search jobs in every field, including remote roles, and use an AI agent to match them to your resume, track applications and prepare for interviews.",
    url: "/",
    ...shareImages,
  },
};

export const revalidate = 86400;
export const dynamic = "force-static";

export default async function Home() {
  const { jobCount, applicationCount, resumeCount, userCount } =
    await getPlatformStats();

  return (
    <div className="flex-1 flex flex-col gap-32 w-full">
      <JsonLd
        data={[
          organizationJsonLd(),
          websiteJsonLd(),
          softwareApplicationJsonLd(),
          ...landingJsonLd(page, "GetHired"),
        ]}
      />
      <Hero
        eyebrow={
          <HeroEyebrow
            href={agentPromptHref("Show jobs that match my profile, best matches first.")}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label="AI job agent"
            detail="Ask it for jobs that match your resume"
          />
        }
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
