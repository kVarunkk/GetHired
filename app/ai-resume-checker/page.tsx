import FootComponent from "@/components/FootComponent";
import HeroAiResumeChecker from "@/components/HeroAiResumeChecker";
import AIFeatures from "@/components/landing-page/AIFeatures";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";

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
