import { describe, expect, it } from "vitest";
import type { CareersPage } from "./get-careers-page";
import { careersMetadata, careersOrganizationJsonLd, careersUrl } from "./seo";
import { SHARE_IMAGE, TWITTER_SHARE_IMAGE } from "@/helpers/seo/share-image";

const PAGE: CareersPage = {
  id: "c0000000-0000-4000-8000-000000000001",
  slug: "acme",
  published: true,
  name: "Acme",
  tagLine: "We build rockets",
  description: "About Acme.",
  logoUrl: "https://cdn.acme.test/logo.png",
  website: "https://acme.dev",
  websiteVerified: false,
  headquarters: "Bengaluru",
  companySize: null,
  industry: null,
  accentColor: null,
  coverUrl: "https://cdn.acme.test/cover.png",
  sections: [],
  links: { linkedin: "https://linkedin.com/company/acme" },
};

describe("careers SEO (CP-REQ-011)", () => {
  it("builds the Organization JSON-LD", () => {
    expect(careersOrganizationJsonLd(PAGE)).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Acme",
      url: "https://acme.dev",
      logo: "https://cdn.acme.test/logo.png",
      description: "We build rockets",
      sameAs: ["https://linkedin.com/company/acme"],
    });
  });

  it("sets the canonical URL, title and OG image", () => {
    const meta = careersMetadata(PAGE, { openRoles: 3 });
    expect(meta.title).toBe("Careers at Acme");
    expect(meta.description).toBe("We build rockets. 3 open roles.");
    expect(meta.alternates?.canonical).toBe(careersUrl("acme"));
    expect(meta.openGraph).toMatchObject({ url: careersUrl("acme"), images: [{ url: "https://cdn.acme.test/cover.png" }] });
  });

  it("falls back to the logo for the OG image, and to a plain description", () => {
    const meta = careersMetadata({ ...PAGE, coverUrl: null, tagLine: null }, { openRoles: 1 });
    expect(meta.description).toBe("Open roles at Acme. 1 open role.");
    expect(meta.openGraph).toMatchObject({ images: [{ url: "https://cdn.acme.test/logo.png" }] });
  });

  it("falls back to the site share image without a cover or logo", () => {
    const meta = careersMetadata({ ...PAGE, coverUrl: null, logoUrl: null }, { openRoles: 2 });
    expect(meta.openGraph).toMatchObject({ images: [SHARE_IMAGE] });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [TWITTER_SHARE_IMAGE] });
  });
});
