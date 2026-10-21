import FootComponent from "@/components/FootComponent";
import Footer from "@/components/landing-page/Footer";
import PrivacyPolicy from "@/components/PrivacyPolicy";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How GetHired collects, uses and protects your personal data.",
  alternates: { canonical: "/privacy-policy" },
};

export const dynamic = "force-static";

export default async function PrivacyPolicyPage() {
  return (
    <>
      <PrivacyPolicy />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80 my-20">
        <FootComponent />
      </div>
      <Footer />
    </>
  );
}
