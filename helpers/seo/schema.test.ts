import { describe, expect, it } from "vitest";
import type { Plan } from "@/helpers/billing/plans";
import { FAQS } from "@/helpers/marketing/content";
import {
  breadcrumbJsonLd,
  faqJsonLd,
  landingJsonLd,
  organizationJsonLd,
  pricingJsonLd,
} from "./schema";

const plan = (over: Partial<Plan>): Plan => ({
  id: "1",
  slug: "pro",
  name: "Pro",
  description: null,
  features: [],
  sort: 1,
  prices: [],
  entitlements: {},
  ...over,
});

describe("faqJsonLd", () => {
  it("lists every question of the topic with its answer", () => {
    const ld = faqJsonLd("hiring");
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity).toHaveLength(FAQS.hiring.length);
    expect(ld.mainEntity[0].acceptedAnswer.text).toBe(FAQS.hiring[0].answer);
  });
});

describe("breadcrumbJsonLd", () => {
  it("starts at the home page and numbers the crumbs", () => {
    const ld = breadcrumbJsonLd([{ name: "Pricing", path: "/pricing/companies" }]);
    expect(ld.itemListElement.map((i) => [i.position, i.item])).toEqual([
      [1, "https://gethired.devhub.co.in/"],
      [2, "https://gethired.devhub.co.in/pricing/companies"],
    ]);
  });
});

describe("landingJsonLd", () => {
  it("has no breadcrumb on the home page", () => {
    const page = { path: "/", description: "d", faq: "job-search" as const };
    expect(landingJsonLd(page, "GetHired").map((n) => n["@type"])).toEqual(["WebPage", "FAQPage"]);
  });

  it("adds a breadcrumb on other pages", () => {
    const page = { path: "/hire", description: "d", faq: "hiring" as const };
    expect(landingJsonLd(page, "Hire").map((n) => n["@type"])).toEqual([
      "WebPage",
      "BreadcrumbList",
      "FAQPage",
    ]);
  });
});

describe("landingJsonLd under /hire", () => {
  it("puts the hiring hub between Home and the page in the breadcrumb", () => {
    const page = { path: "/hire/applicant-tracking-system", description: "d", faq: "hiring" as const };
    const crumbs = landingJsonLd(page, "ATS").find(
      (n): n is ReturnType<typeof breadcrumbJsonLd> => n["@type"] === "BreadcrumbList",
    );
    expect(crumbs?.itemListElement.map((i) => i.item)).toEqual([
      "https://gethired.devhub.co.in/",
      "https://gethired.devhub.co.in/hire",
      "https://gethired.devhub.co.in/hire/applicant-tracking-system",
    ]);
  });
});

describe("organizationJsonLd", () => {
  it("has a stable id other nodes can point at", () => {
    expect(organizationJsonLd()["@id"]).toBe("https://gethired.devhub.co.in/#organization");
  });
});

describe("pricingJsonLd", () => {
  it("prices the free plan at zero, other plans per interval, and leaves an unpriced plan without offers", () => {
    const ld = pricingJsonLd([
      plan({ slug: "free", name: "Free" }),
      plan({
        prices: [
          { interval: "month", currency: "USD", amount_minor: 4900, dodo_product_id: null },
          { interval: "year", currency: "USD", amount_minor: 49000, dodo_product_id: null },
        ],
      }),
      plan({ slug: "enterprise", name: "Enterprise" }),
    ]);
    const [free, pro, enterprise] = ld.itemListElement.map((i) => i.item);

    expect(free.offers).toEqual([expect.objectContaining({ price: "0.00", priceCurrency: "USD" })]);
    expect(pro.offers?.map((o) => [o.price, o.priceSpecification?.billingDuration])).toEqual([
      ["49.00", "P1M"],
      ["490.00", "P1Y"],
    ]);
    expect(enterprise.offers).toBeUndefined();
  });
});
