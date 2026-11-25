import CompanyFeaturePage from "@/components/landing-page/CompanyFeaturePage";
import { companyPageMetadata } from "@/helpers/seo/feature-page";

export const metadata = companyPageMetadata("ai-job-description-generator");

export const revalidate = 86400;
export const dynamic = "force-static";

export default function Page() {
  return <CompanyFeaturePage pageKey="ai-job-description-generator" />;
}
