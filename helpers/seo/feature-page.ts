import type { Metadata } from "next";
import { COMPANY_PAGE_SEO, type CompanyPageKey } from "@/helpers/marketing/company-pages";
import { LANDING_PAGES, markdownAlternate } from "@/helpers/marketing/content";
import { shareImages, twitterShareImages } from "./share-image";

/** The `<head>` of a company feature page (/hire/<feature>), from its copy and SEO entry. */
export function companyPageMetadata(key: CompanyPageKey): Metadata {
  const page = LANDING_PAGES[key];
  const { title, keywords } = COMPANY_PAGE_SEO[key];
  return {
    title,
    description: page.description,
    alternates: { canonical: page.path, types: markdownAlternate(page.path) },
    openGraph: {
      type: "website",
      siteName: "GetHired",
      title,
      description: page.description,
      url: page.path,
      ...shareImages,
    },
    twitter: { ...twitterShareImages, title, description: page.description },
    keywords,
  };
}
