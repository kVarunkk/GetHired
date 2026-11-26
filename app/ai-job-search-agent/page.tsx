import type { Metadata } from "next";
import FeatureLandingPage from "@/components/landing-page/FeatureLandingPage";
import { LANDING_PAGES, markdownAlternate } from "@/helpers/marketing/content";
import { shareImages } from "@/helpers/seo/share-image";

const page = LANDING_PAGES["job-search-agent"];
const TITLE = "AI Job Search Agent";

export const metadata: Metadata = {
  title: TITLE,
  description: page.description,
  alternates: { canonical: page.path, types: markdownAlternate(page.path) },
  openGraph: {
    type: "website",
    siteName: "GetHired",
    title: TITLE,
    description: page.description,
    url: page.path,
    ...shareImages,
  },
  keywords: [
    "AI job search agent",
    "AI job search",
    "AI job matching",
    "job search assistant",
    "find jobs with AI",
    "AI job application assistant",
  ],
};

export const revalidate = 86400;
export const dynamic = "force-static";

export default function AiJobSearchAgentPage() {
  return (
    <FeatureLandingPage
      page={page}
      name={TITLE}
      eyebrowDetail="Find jobs that match your resume in one message"
    />
  );
}
