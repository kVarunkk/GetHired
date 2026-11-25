import AboutComponent from "@/components/AboutComponent";
import FootComponent from "@/components/FootComponent";
import Footer from "@/components/landing-page/Footer";
import type { Metadata } from "next";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbJsonLd, webPageJsonLd } from "@/helpers/seo/schema";
import { ABOUT_DESCRIPTION, markdownAlternate } from "@/helpers/marketing/content";

export const metadata: Metadata = {
  title: "About GetHired",
  description: ABOUT_DESCRIPTION,
  alternates: { canonical: "/about", types: markdownAlternate("/about") },
};

export const dynamic = "force-static";

export default async function AboutPage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({
            path: "/about",
            name: "About GetHired",
            description: ABOUT_DESCRIPTION,
            type: "AboutPage",
          }),
          breadcrumbJsonLd([{ name: "About", path: "/about" }]),
        ]}
      />
      <AboutComponent />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80 my-20">
        <FootComponent />
      </div>
      <Footer />
    </>
  );
}
