import FootComponent from "@/components/FootComponent";
import HeroAiInterview from "@/components/HeroAIInterview";
import AIFeatures from "@/components/landing-page/AIFeatures";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import PlatformStats from "@/components/landing-page/PlatformStats";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import { getPlatformStats } from "@/utils/platform-stats";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Interview",
  description:
    "Prepare for your next interview with our AI-powered practice sessions. Get personalized feedback and improve your chances of landing the job.",
  alternates: {
    canonical: "https://gethired.devhub.co.in/ai-interview",
  },
  openGraph: {
    title: "AI Interview",
    description:
      "Prepare for your next interview with our AI-powered practice sessions.",
    url: "https://gethired.devhub.co.in/ai-interview",
    siteName: "GetHired",
    type: "website",
  },
  keywords: [
    "AI Interview Prep",
    "AI Interview Practice",
    "Interview Preparation",
    "AI Career Advice",
    "Job Interview Tips",
    "Technical Interview",
    "Technical Screening",
    "AI Screening",
    "AI Mock Interview",
    "AI Interview Feedback",
    "AI Interview Coaching",
  ],
  robots: {
    index: true,
    follow: true,
  },
};

export const revalidate = 86400;
export const dynamic = "force-static";

export default async function AIInterviewPage() {
  const { jobCount, applicationCount, resumeCount, userCount } =
    await getPlatformStats();

  return (
    <div className="flex-1 flex flex-col gap-32  w-full">
      <HeroAiInterview />
      <HowWeHelp jobCount={jobCount} />
      <AIFeatures />
      <PlatformStats
        applicationCount={applicationCount}
        resumeCount={resumeCount}
        userCount={userCount}
      />
      <TheGetHiredAdvantageSection jobCount={jobCount} />
      <FAQSection topic="ai-interview" />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
        <FootComponent />
      </div>
      <Footer />
    </div>
  );
}
