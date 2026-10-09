import ContactComponent from "@/components/ContactComponent";
import FootComponent from "@/components/FootComponent";
import Footer from "@/components/landing-page/Footer";

export const dynamic = "force-static";

export default async function ContactPage() {
  return (
    <>
      <ContactComponent />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80 my-20">
        <FootComponent />
      </div>
      <Footer />
    </>
  );
}
