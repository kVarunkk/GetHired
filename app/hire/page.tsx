import FootComponent from "@/components/FootComponent";
import AIFeatures from "@/components/landing-page/AIFeatures";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import Hero from "@/components/landing-page/Hero";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
// import NavbarParent from "@/components/NavbarParent";
// import { homePageNavItems } from "@/lib/serverUtils";
import { Metadata } from "next";
// import { v4 as uuidv4 } from "uuid";

export const metadata: Metadata = {
  title: "GetHired - Your smartest path to the perfect candidate",
  description:
    "Leverage proprietary AI to screen and qualify candidates instantly. Post your job, eliminate noise, and significantly reduce your time-to-hire with an always-on, empathetic recruiting co-pilot.",
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

export default async function HirePage() {
  // const navItems = homePageNavItems;
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        {/* <NavbarParent navItems={navItems} variant="horizontal" /> */}
        <div className="flex-1 flex flex-col gap-32  w-full">
          <Hero />
          <HowWeHelp />
          <AIFeatures />
          <TheGetHiredAdvantageSection />
          <FAQSection />
          <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
            <FootComponent />
          </div>
          <Footer />
        </div>
      </div>
    </main>
  );
}
