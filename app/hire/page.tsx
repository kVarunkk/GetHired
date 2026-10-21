import FootComponent from "@/components/FootComponent";
import AgentHeroDemo from "@/components/landing-page/AgentHeroDemo";
import { RECRUITER_DEMO } from "@/components/landing-page/agent-demos";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import Hero from "@/components/landing-page/Hero";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import PlatformStats from "@/components/landing-page/PlatformStats";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import { getPlatformStats } from "@/utils/platform-stats";
import { Metadata } from "next";
import Link from "next/link";
import { LANDING_PAGES, markdownAlternate } from "@/helpers/marketing/content";

const page = LANDING_PAGES.hire;

export const metadata: Metadata = {
  title: "AI Recruiting Software to Hire Tech Talent",
  description: page.description,
  alternates: {
    canonical: "/hire",
    types: markdownAlternate(page.path),
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
    <div className="flex-1 flex flex-col gap-32 w-full">
      <Hero
        heading={page.heading}
        subheading={page.subheading(jobCount)}
        ctaText={page.ctas[0].label}
        ctaLink={page.ctas[0].href}
        ctaText2={page.ctas[1].label}
        ctaLink2={page.ctas[1].href}
        preview={<AgentHeroDemo demo={RECRUITER_DEMO} />}
      />
      <HowWeHelp jobCount={jobCount} />
      <PlatformStats
        applicationCount={applicationCount}
        resumeCount={resumeCount}
        userCount={userCount}
      />
      <TheGetHiredAdvantageSection jobCount={jobCount} />
      <FAQSection topic={page.faq} />
      <p className="px-4 text-center text-[15px] leading-7 text-muted-foreground">
        Start hiring free.{" "}
        <Link
          href="/pricing/companies"
          className="font-medium text-foreground underline underline-offset-4 hover:text-brand"
        >
          See plans and pricing
        </Link>
      </p>
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
        <FootComponent />
      </div>
      <Footer />
    </div>
  );
}
