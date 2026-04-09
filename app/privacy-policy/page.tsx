import FootComponent from "@/components/FootComponent";
import Footer from "@/components/landing-page/Footer";
import PrivacyPolicy from "@/components/PrivacyPolicy";

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
