import type { Metadata } from "next";
import { UsageBannerLoader } from "@/components/billing/UsageBanner";

// Signed-in company pages stay out of search results. /company/join sets its own.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// The usage and grace-period banner (spec §4.4) on every company page. It loads
// on the client, so pages render without waiting for billing.
export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <UsageBannerLoader />
      {children}
    </>
  );
}
