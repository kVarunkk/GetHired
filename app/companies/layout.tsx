import { shareImages } from "@/helpers/seo/share-image";
import Error from "@/components/Error";
import { Metadata } from "next";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbJsonLd, webPageJsonLd } from "@/helpers/seo/schema";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title:
      "Discover Companies Hiring Now | GetHired Company Directory",
    description:
      "Explore the directory of companies hiring now. Find companies by size, industry, location, and visa sponsorship policies.",
    keywords: [
      "company directory",
      "companies hiring now",
      "jobs by company",
      "startups hiring",
      "visa sponsorship companies",
    ],
    alternates: {
      canonical: "/companies",
    },
    openGraph: {
      type: "website",
      siteName: "GetHired",
      title: "Discover Companies Hiring Now | GetHired",
      description:
        "Explore companies hiring now by industry, size, and location.",
      url: "/companies",
      ...shareImages,
    },
  };
}

export default async function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    return (
      <>
        <JsonLd
          data={[
            webPageJsonLd({
              path: "/companies",
              name: "Companies Hiring Now",
              description:
                "Explore the directory of companies hiring now. Find companies by size, industry, location, and visa sponsorship policies.",
              type: "CollectionPage",
            }),
            breadcrumbJsonLd([{ name: "Companies", path: "/companies" }]),
          ]}
        />
        {children}
      </>
    );
  } catch {
    return <Error />;
  }
}
