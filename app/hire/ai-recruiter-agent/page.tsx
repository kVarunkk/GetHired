import CompanyFeaturePage from "@/components/landing-page/CompanyFeaturePage";
import { companyPageMetadata } from "@/helpers/seo/feature-page";

export const metadata = companyPageMetadata("ai-recruiter-agent");

export const revalidate = 86400;
export const dynamic = "force-static";

export default function Page() {
  return <CompanyFeaturePage pageKey="ai-recruiter-agent" />;
}
