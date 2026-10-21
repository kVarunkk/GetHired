import AboutComponent from "@/components/AboutComponent";
import FootComponent from "@/components/FootComponent";
import Footer from "@/components/landing-page/Footer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About GetHired",
  description:
    "GetHired is an AI job platform for tech jobs: an agent that searches openings, matches them to your resume, reviews your CV and preps you for interviews, plus hiring tools for companies.",
  alternates: { canonical: "/about" },
};

export const dynamic = "force-static";

export default async function AboutPage() {
  return (
    <>
      <AboutComponent />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80 my-20">
        <FootComponent />
      </div>
      <Footer />
    </>
  );
}
