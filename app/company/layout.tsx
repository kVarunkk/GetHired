import { UsageBannerLoader } from "@/components/billing/UsageBanner";

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
