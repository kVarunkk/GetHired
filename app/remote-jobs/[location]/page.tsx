import FootComponent from "@/components/FootComponent";
import HeroRemotePage from "@/components/HeroRemotePage";
import AIFeatures from "@/components/landing-page/AIFeatures";
import FAQSection from "@/components/landing-page/FAQSection";
import Footer from "@/components/landing-page/Footer";
import { HowWeHelp } from "@/components/landing-page/HowWeHelp";
import TheGetHiredAdvantageSection from "@/components/landing-page/TheGetHiredAdvantageSection";
import NavbarParent, { INavItem } from "@/components/NavbarParent";
// import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Metadata } from "next";
import { v4 as uuidv4 } from "uuid";

export const dynamicParams = false;

export async function generateStaticParams() {
  const supabase = createServiceRoleClient();
  const slugs = new Set<string>();

  try {
    const { data: geoData } = await supabase
      .from("countries_and_cities")
      .select("country, cities");

    if (geoData) {
      geoData.forEach((item: any) => {
        if (item.country) slugs.add(item.country.toLowerCase().trim());

        if (Array.isArray(item.cities)) {
          item.cities.forEach((city: string) => {
            if (city) slugs.add(city.toLowerCase().trim());
          });
        }
      });
    }

    return Array.from(slugs)
      .filter(Boolean)
      .map((slug) => ({
        location: slug,
      }));
  } catch (error) {
    console.error("Static generation fetch failed:", error);
    return [{ location: "remote" }, { location: "india" }];
  }
}

async function getAliasMap() {
  const map = new Map<string, string>();

  // Basic combinations for critical pSEO locations
  map.set("bengaluru", "bangalore");
  map.set("gurugram", "gurgaon");
  map.set("sf", "san francisco");
  map.set("nyc", "new york");
  return map;
}

async function getResolvedLocation(slug: string) {
  const decoded = decodeURIComponent(slug).toLowerCase();
  const aliasMap = await getAliasMap();
  return aliasMap.get(decoded) || decoded;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ location: string }>;
}): Promise<Metadata> {
  const { location } = await params;
  const resolved = await getResolvedLocation(location);

  const displayLocation = resolved
    .split(" ")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");

  const title = `Remote Jobs in ${displayLocation} | AI-Powered Tech Roles `;
  const description = `Find the best remote jobs in ${displayLocation}. Our AI-first platform matches your tech stack to high-growth startup roles instantly.`;

  return {
    title,
    description,
    alternates: {
      canonical: `https://gethired.devhub.co.in/remote-jobs/${location.toLowerCase()}`,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

const navItems: INavItem[] = [
  {
    id: uuidv4(),
    label: "Home",
    href: "/",
    type: "equals",
  },
  {
    id: uuidv4(),
    label: "Jobs",
    href: "/jobs",
    type: "startswith",
  },
  {
    id: uuidv4(),
    label: "Companies",
    href: "/companies",
    type: "startswith",
  },
  {
    id: uuidv4(),
    label: "Dashboard",
    href: "/dashboard",
    type: "startswith",
  },
];

export default async function RemoteJobsLocationPage({
  params,
}: {
  params: Promise<{ location: string }>;
}) {
  const { location: rawSlug } = await params;

  const resolvedLocation = await getResolvedLocation(rawSlug);

  const displayLocation = resolvedLocation
    .split(" ")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");

  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        <NavbarParent navItems={navItems} />
        <div className="flex-1 flex flex-col gap-32  w-full">
          <HeroRemotePage location={displayLocation} />
          <HowWeHelp />
          <AIFeatures />
          <TheGetHiredAdvantageSection />
          <FAQSection />
          <div className="px-4 lg:px-20 xl:px-40 2xl:px-80">
            <FootComponent />
          </div>
          <Footer />
        </div>
      </div>
    </main>
  );
}
