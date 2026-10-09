import Error from "@/components/Error";
import { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title:
      "Discover Top Tech Companies Hiring Now | GetHired Company Directory",
    description:
      "Explore the directory of companies hiring developers and engineers. Find companies by size, industry, location, and visa sponsorship policies.",
    keywords: [
      "tech company directory",
      "companies hiring developers",
      "software engineering jobs by company",
      "startups hiring tech talent",
      "visa sponsorship companies",
    ],
    alternates: {
      canonical: "/companies",
    },
    openGraph: {
      type: "website",
      siteName: "GetHired",
      title: "Discover Top Tech Companies Hiring Now | GetHired",
      description:
        "Explore companies hiring developers and engineers by industry, size, and location.",
      url: "/companies",
    },
  };
}

export default async function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    return <>{children}</>;
  } catch {
    return <Error />;
  }
}
