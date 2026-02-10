import FootComponent from "@/components/FootComponent";
import HeroAiResumeChecker from "@/components/HeroAiResumeChecker";
import AIFeatures from "@/components/landing-page/AIFeatures";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Resume Checker",
  description:
    "Get a deep semantic analysis of your resume. GetHired's AI Resume Checker optimizes your technical presence for modern ATS systems to help you land more interviews.",
  alternates: {
    canonical: "https://gethired.devhub.co.in/ai-resume-checker",
  },
  openGraph: {
    title: "AI Resume Checker",
    description:
      "Deep semantic analysis to optimize your resume for all roles.",
    url: "https://gethired.devhub.co.in/ai-resume-checker",
    siteName: "GetHired AI",
    type: "website",
  },
  keywords: [
    "AI Resume Checker",
    "AI Resume Review",
    "Resume Review",
    "ATS Optimization",
    "CV Analysis",
    "Resume Match Score",
    "Technical Resume Review",
    "Semantic Resume Search",
    "Tailor CV for Job Description",
    "ATS Friendly Resume Checker",
    "AI Career Assistant",
    "CV Keyword Optimizer",
  ],
  robots: {
    index: true,
    follow: true,
  },
};

export default async function AIResumeChecker() {
  return (
    <div className="flex-1 flex flex-col gap-32  w-full">
      <HeroAiResumeChecker />
      <HowWeHelp />
      <AIFeatures />
      <TheGetHiredAdvantageSection />
      <FAQSection />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
        <FootComponent />
      </div>
      <Footer />
    </div>
  );
}
