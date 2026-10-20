import type { Metadata } from "next";
import type { CareersPage } from "./get-careers-page";
import { LINK_KEYS } from "./page-schema";
import { careersPath } from "./slug";

const SITE_URL = "https://gethired.devhub.co.in";

export const careersUrl = (slug: string) => `${SITE_URL}${careersPath(slug)}`;

/** CP-REQ-011: the page's Organization JSON-LD. */
export function careersOrganizationJsonLd(page: CareersPage) {
  const sameAs = LINK_KEYS.flatMap((k) => (page.links[k] ? [page.links[k]!] : []));
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: page.name,
    ...(page.website ? { url: page.website } : {}),
    ...(page.logoUrl ? { logo: page.logoUrl } : {}),
    ...(page.tagLine ? { description: page.tagLine } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/** CP-REQ-011: title, description, canonical URL and the OG image (the cover, else the logo). */
export function careersMetadata(page: CareersPage, { openRoles }: { openRoles: number }): Metadata {
  const title = `Careers at ${page.name}`;
  const roles = `${openRoles} open ${openRoles === 1 ? "role" : "roles"}.`;
  const lead = page.tagLine ? page.tagLine.replace(/[.\s]+$/, "") : `Open roles at ${page.name}`;
  const description = `${lead}. ${roles}`;
  const canonical = careersUrl(page.slug);
  const image = page.coverUrl ?? page.logoUrl;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      siteName: "GetHired",
      title,
      description,
      url: canonical,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title, description },
  };
}
