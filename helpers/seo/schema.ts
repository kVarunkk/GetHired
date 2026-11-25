// JSON-LD for the marketing pages, so search and answer engines can read what
// GetHired is, what it costs and what each page answers. The blog and job
// pages build their own (helpers/blog/seo.ts, helpers/jobs/jobId/jsonld.ts).

import { FAQS, SITE_URL, type FAQTopic } from "@/helpers/marketing/content";
import type { BillingInterval, Plan } from "@/helpers/billing/plans";

export { serializeJsonLd } from "@/helpers/blog/seo";

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const APPLICATION_ID = `${SITE_URL}/#application`;

const absolute = (path: string) => (path.startsWith("http") ? path : `${SITE_URL}${path}`);

/** Who runs the site. Referenced by id from every other node. */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: "GetHired",
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.png` },
    description:
      "An AI job search platform for every kind of role: an agent that searches openings and matches them to your resume, plus an AI recruiter and ATS for companies.",
    founder: { "@type": "Person", name: "Varun", url: "https://varun.devhub.co.in" },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "varun@devhub.co.in",
      url: `${SITE_URL}/contact`,
    },
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: "GetHired",
    url: SITE_URL,
    publisher: { "@id": ORGANIZATION_ID },
    inLanguage: "en",
  };
}

/** The product itself, a web app for job seekers and hiring teams. */
export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": APPLICATION_ID,
    name: "GetHired",
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Job seekers chat with an AI agent that searches jobs in every field, matches them to a resume, reviews it and runs mock interviews. Companies get an AI recruiter, candidate matching, AI screening interviews and an ATS.",
    publisher: { "@id": ORGANIZATION_ID },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free to start" },
  };
}

/** Question and answer pairs, the same text the page's FAQ section shows. */
export function faqJsonLd(topic: FAQTopic) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS[topic].map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

/** `crumbs` run from the first page below the home page to the current one. */
export function breadcrumbJsonLd(crumbs: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: "Home", path: "/" }, ...crumbs].map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: absolute(crumb.path),
    })),
  };
}

/** A page's own node: what it is called, what it says and where it sits. */
export function webPageJsonLd({
  path,
  name,
  description,
  type = "WebPage",
  dateModified,
}: {
  path: string;
  name: string;
  description: string;
  type?: "WebPage" | "AboutPage" | "ContactPage" | "CollectionPage";
  dateModified?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": type,
    "@id": `${absolute(path)}#webpage`,
    url: absolute(path),
    name,
    description,
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORGANIZATION_ID },
    ...(dateModified ? { dateModified } : {}),
  };
}

const BILLING_DURATION: Record<BillingInterval, string> = { month: "P1M", year: "P1Y" };

type Quote = { amount: number; currency: string; interval: BillingInterval | null };

function planQuotes(plan: Plan): Quote[] {
  if (plan.slug === "free") return [{ amount: 0, currency: "USD", interval: null }];
  return plan.prices.map((p) => ({
    amount: p.amount_minor / 100,
    currency: p.currency,
    interval: p.interval,
  }));
}

/** One Offer per listed price of each plan. A plan with no price (Enterprise) has no offer. */
export function pricingJsonLd(plans: Plan[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "GetHired pricing for companies",
    itemListElement: plans.map((plan, i) => {
      const quotes = planQuotes(plan);
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Product",
          name: `GetHired ${plan.name}`,
          ...(plan.description ? { description: plan.description } : {}),
          brand: { "@id": ORGANIZATION_ID },
          ...(quotes.length
            ? {
                offers: quotes.map((q) => ({
                  "@type": "Offer",
                  price: q.amount.toFixed(2),
                  priceCurrency: q.currency,
                  url: `${SITE_URL}/pricing/companies`,
                  ...(q.interval
                    ? {
                        priceSpecification: {
                          "@type": "UnitPriceSpecification",
                          price: q.amount.toFixed(2),
                          priceCurrency: q.currency,
                          billingDuration: BILLING_DURATION[q.interval],
                        },
                      }
                    : {}),
                })),
              }
            : {}),
        },
      };
    }),
  };
}

/** Pages under /hire sit below the hiring hub in the breadcrumb. */
const HIRE_CRUMB = { name: "Hire talent", path: "/hire" };

/** The nodes every landing page carries: the page itself, its place in the site and its FAQ. */
export function landingJsonLd(
  page: { path: string; description: string; faq: FAQTopic },
  name: string,
) {
  return [
    webPageJsonLd({ path: page.path, name, description: page.description }),
    ...(page.path === "/"
      ? []
      : [
          breadcrumbJsonLd([
            ...(page.path.startsWith(`${HIRE_CRUMB.path}/`) ? [HIRE_CRUMB] : []),
            { name, path: page.path },
          ]),
        ]),
    faqJsonLd(page.faq),
  ];
}
