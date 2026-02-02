import FootComponent from "@/components/FootComponent";
import Footer from "@/components/landing-page/Footer";
import TermsOfService from "@/components/TermsOfService";

export default async function TermsOfServicePage() {
  return (
    <>
      <TermsOfService />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80 my-20">
        <FootComponent />
      </div>
      <Footer />
    </>
  );
}
