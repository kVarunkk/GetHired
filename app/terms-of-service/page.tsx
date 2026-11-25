import FootComponent from "@/components/FootComponent";
import Footer from "@/components/landing-page/Footer";
import TermsOfService from "@/components/TermsOfService";
import type { Metadata } from "next";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbJsonLd, webPageJsonLd } from "@/helpers/seo/schema";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms that govern your use of GetHired.",
  alternates: { canonical: "/terms-of-service" },
};

export const dynamic = "force-static";

export default async function TermsOfServicePage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({
            path: "/terms-of-service",
            name: "Terms of Service",
            description: "The terms that govern your use of GetHired.",
          }),
          breadcrumbJsonLd([{ name: "Terms of Service", path: "/terms-of-service" }]),
        ]}
      />
      <TermsOfService />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80 my-20">
        <FootComponent />
      </div>
      <Footer />
    </>
  );
}
