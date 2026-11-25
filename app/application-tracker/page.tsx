import type { Metadata } from "next";
import FeatureLandingPage from "@/components/landing-page/FeatureLandingPage";
import { LANDING_PAGES, markdownAlternate } from "@/helpers/marketing/content";
import { shareImages } from "@/helpers/seo/share-image";

const page = LANDING_PAGES["application-tracker"];
const TITLE = "Job Application Tracker";

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
    "job application tracker",
    "track job applications",
    "job tracker",
    "application tracking for job seekers",
    "job search tracker",
    "saved jobs",
  ],
};

export const revalidate = 86400;
export const dynamic = "force-static";

export default function ApplicationTrackerPage() {
  return (
    <FeatureLandingPage
      page={page}
      name={TITLE}
      eyebrowDetail="Ask for your applications, saved jobs and interviews"
    />
  );
}
