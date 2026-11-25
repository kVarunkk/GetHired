import FeatureLandingPage from "@/components/landing-page/FeatureLandingPage";
import { COMPANY_PAGE_SEO, type CompanyPageKey } from "@/helpers/marketing/company-pages";
import { LANDING_PAGES } from "@/helpers/marketing/content";

/** One /hire/<feature> page. Its route file sets the metadata with `companyPageMetadata`. */
export default function CompanyFeaturePage({ pageKey }: { pageKey: CompanyPageKey }) {
  const { title, eyebrowDetail } = COMPANY_PAGE_SEO[pageKey];
  return (
    <FeatureLandingPage page={LANDING_PAGES[pageKey]} name={title} eyebrowDetail={eyebrowDetail} />
  );
}
