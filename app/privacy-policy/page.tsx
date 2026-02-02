import FootComponent from "@/components/FootComponent";
import Footer from "@/components/landing-page/Footer";
// import NavbarParent from "@/components/NavbarParent";
import PrivacyPolicy from "@/components/PrivacyPolicy";
// import { authPageNavItems } from "@/lib/serverUtils";
// import { v4 as uuidv4 } from "uuid";

export default async function PrivacyPolicyPage() {
  // const navItems = authPageNavItems;
  return (
    <>
      {/* <NavbarParent navItems={navItems} variant="horizontal" /> */}
      <PrivacyPolicy />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80 my-20">
        <FootComponent />
      </div>
      <Footer />
    </>
  );
}
