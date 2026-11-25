import ContactComponent from "@/components/ContactComponent";
import FootComponent from "@/components/FootComponent";
import Footer from "@/components/landing-page/Footer";
import type { Metadata } from "next";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbJsonLd, webPageJsonLd } from "@/helpers/seo/schema";
import { CONTACT_DESCRIPTION, markdownAlternate } from "@/helpers/marketing/content";

export const metadata: Metadata = {
  title: "Contact Us",
  description: CONTACT_DESCRIPTION,
  alternates: { canonical: "/contact", types: markdownAlternate("/contact") },
};

export const dynamic = "force-static";

export default async function ContactPage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({
            path: "/contact",
            name: "Contact GetHired",
            description: CONTACT_DESCRIPTION,
            type: "ContactPage",
          }),
          breadcrumbJsonLd([{ name: "Contact", path: "/contact" }]),
        ]}
      />
      <ContactComponent />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80 my-20">
        <FootComponent />
      </div>
      <Footer />
    </>
  );
}
