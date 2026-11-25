import { Sparkles } from "lucide-react";
import Link from "next/link";
import FootComponent from "@/components/FootComponent";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import Hero, { HeroEyebrow } from "@/components/landing-page/Hero";
import PlatformStats from "@/components/landing-page/PlatformStats";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import JsonLd from "@/components/seo/JsonLd";
import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import { type LandingPageCopy } from "@/helpers/marketing/content";
import { landingJsonLd } from "@/helpers/seo/schema";
import { getPlatformStats } from "@/utils/platform-stats";

/**
 * A page for one feature (the tracker, job alerts, the agent): a hero, what
 * the feature does, the platform numbers and its FAQ. Built from the page's
 * copy, so its markdown version says the same.
 */
export default async function FeatureLandingPage({
  page,
  name,
  eyebrowDetail,
}: {
  page: LandingPageCopy;
  /** The page's name in its structured data. */
  name: string;
  /** What the pill above the heading offers, e.g. "Ask the agent to show your applications". */
  eyebrowDetail: string;
}) {
  const { features } = page;
  if (!features) throw new Error(`${page.path} has no features copy`);
  const { jobCount, applicationCount, resumeCount, userCount } = await getPlatformStats();
  const [primary, secondary] = page.ctas;
  const forCompanies = features.audience === "company";

  return (
    <div className="flex-1 flex flex-col gap-32 w-full">
      <JsonLd data={landingJsonLd(page, name)} />
      <Hero
        eyebrow={
          <HeroEyebrow
            href={agentPromptHref(features.agentPrompt, forCompanies ? COMPANY_AGENT_PATH : undefined)}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label={forCompanies ? "Recruiter agent" : "Ask the agent"}
            detail={eyebrowDetail}
          />
        }
        heading={page.heading}
        subheading={page.subheading(jobCount)}
        ctaText={primary.label}
        ctaLink={primary.href}
        ctaText2={secondary?.label}
        ctaLink2={secondary?.href}
      />
      <section className="px-4 lg:px-20 xl:px-40 2xl:px-80">
        <div className="mx-auto mb-12 max-w-3xl text-center">
          <h2 className="mb-4 text-3xl font-semibold tracking-tight md:text-4xl">
            {features.heading}
          </h2>
          <p className="text-muted-foreground">{features.subheading}</p>
        </div>
        <ul className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.items.map((item) => (
            <li key={item.name} className="flex flex-col gap-2 rounded-xl border bg-card p-5">
              <h3 className="text-base font-semibold tracking-tight">{item.name}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
            </li>
          ))}
        </ul>
      </section>
      {page.related && page.related.length > 0 && (
        <section
          aria-labelledby="related-heading"
          className="px-4 lg:px-20 xl:px-40 2xl:px-80"
        >
          <div className="mx-auto max-w-5xl">
            <h2 id="related-heading" className="mb-6 text-2xl font-semibold tracking-tight">
              Related
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {page.related.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="block rounded-lg border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/60"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <PlatformStats
        applicationCount={applicationCount}
        resumeCount={resumeCount}
        userCount={userCount}
      />
      <TheGetHiredAdvantageSection jobCount={jobCount} />
      <FAQSection topic={page.faq} />
      <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
        <FootComponent />
      </div>
      <Footer />
    </div>
  );
}
