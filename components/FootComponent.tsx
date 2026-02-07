"use client";

import Link from "next/link";
import { Button } from "./ui/button";
import { usePathname } from "next/navigation";

// Add a prop to check if we are on the /hire page
export default function FootComponent() {
  const pathname = usePathname();
  const isHirePage = pathname.startsWith("/hire");
  const isJobsPage = pathname.startsWith("/jobs");
  // Define content variants
  const hireContent = {
    heading: "Ready to accelerate your talent search?",
    subtext:
      "Join top-tier companies that are streamlining their hiring and connecting directly with pre-qualified professionals today.",
    primaryButtonText: "Post Your First Job",
    primaryButtonHref: "/company", // Changed to a specific action route
    secondaryButtonText: "Explore Candidate Profiles",
    secondaryButtonHref: "/company/profiles", // Changed to a candidate browsing route
  };

  const defaultContent = {
    heading: "Ready to make your next big move?",
    subtext:
      "Join thousands of professionals finding their dream job—or the perfect candidate—today.",
    primaryButtonText: "Explore Job Listings",
    primaryButtonHref: "/jobs",
    secondaryButtonText: "Hire Top Talent",
    secondaryButtonHref: "/hire",
  };

  const seekerGuestContent = {
    heading: "Ready to find your actual top matches?",
    subtext:
      "You've explored several pages of listings. Create a free account now to unlock AI features and see exactly which roles match your unique technical stack and experience.",
    primaryButtonText: "Create Free Account",
    primaryButtonHref: "/auth/sign-up",
    secondaryButtonText: "Sign In ",
    secondaryButtonHref: "/auth/login",
  };

  const content = isHirePage
    ? hireContent
    : isJobsPage
      ? seekerGuestContent
      : defaultContent;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 bg-primary-foreground rounded-xl shadow-2xl border border-primary/20">
      <h2 className="text-3xl sm:text-4xl font-extrabold text-primary text-center mb-3 tracking-tight">
        {content.heading}
      </h2>

      <p className="text-lg text-primary/80 text-center mb-8 max-w-2xl">
        {content.subtext}
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        <Link className="w-full" href={content.primaryButtonHref} passHref>
          <Button
            size="lg"
            className="w-full sm:w-auto px-8 py-3 text-lg font-semibold transition-transform duration-200 hover:scale-[1.03] shadow-lg shadow-primary/30"
          >
            {content.primaryButtonText}
          </Button>
        </Link>

        <Link className="w-full" href={content.secondaryButtonHref} passHref>
          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto px-8 py-3 text-lg font-semibold transition-colors duration-200 hover:bg-primary hover:text-primary-foreground border-primary text-primary"
          >
            {content.secondaryButtonText}
          </Button>
        </Link>
      </div>
    </div>
  );
}
