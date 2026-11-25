import type { Metadata } from "next";
import FeatureLandingPage from "@/components/landing-page/FeatureLandingPage";
import { LANDING_PAGES, markdownAlternate } from "@/helpers/marketing/content";
import { shareImages } from "@/helpers/seo/share-image";

const page = LANDING_PAGES["job-alerts"];
const TITLE = "Job Alerts";

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
    "job alerts",
    "job alert emails",
    "new job alerts",
    "daily job alerts",
    "weekly job alerts",
    "remote job alerts",
  ],
};

export const revalidate = 86400;
export const dynamic = "force-static";

export default function JobAlertsPage() {
  return (
    <FeatureLandingPage
      page={page}
      name={TITLE}
      eyebrowDetail="Find jobs that match your profile, then set an alert"
    />
  );
}
