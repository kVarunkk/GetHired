"use client";

import Link from "next/link";
import { Button } from "./ui/button";
import { usePathname } from "next/navigation";

// Add a prop to check if we are on the /hire page
export default function FootComponent() {
  const pathname = usePathname();
  const isHirePage = pathname.startsWith("/hire");
  const isJobsPage = pathname.startsWith("/jobs");
  const isProfilesPage = pathname.startsWith("/company/profiles");
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
      "Tell the agent what you're looking for and let it do the searching, matching and tracking.",
    primaryButtonText: "Chat with the agent",
    primaryButtonHref: "/agent",
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

  const profilesPageContent = {
    heading: "You are currently subscribed to the Free plan",
    subtext:
      "You can only view these number of profiles in your current plan. Upgrade today for full acess.",
    primaryButtonText: "Contact Support",
    primaryButtonHref: "mailto:varun@devhub.co.in",
    secondaryButtonText: "",
    secondaryButtonHref: "",
  };

  const content = isHirePage
    ? hireContent
    : isProfilesPage
      ? profilesPageContent
      : isJobsPage
        ? seekerGuestContent
        : defaultContent;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 bg-muted/30 rounded-2xl border">
      <h2 className="text-2xl sm:text-[28px] font-semibold text-center mb-3 tracking-tight">
        {content.heading}
      </h2>

      <p className="text-[15px] leading-7 text-muted-foreground text-center mb-8 max-w-2xl">
        {content.subtext}
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        <Link className="w-full" href={content.primaryButtonHref} passHref>
          <Button size="lg" variant="brand" className="w-full sm:w-auto px-8">
            {content.primaryButtonText}
          </Button>
        </Link>

        {content.secondaryButtonHref.length &&
        content.secondaryButtonText.length ? (
          <Link className="w-full" href={content.secondaryButtonHref} passHref>
            <Button
              variant="outline"
              size="lg"
              className="w-full sm:w-auto px-8"
            >
              {content.secondaryButtonText}
            </Button>
          </Link>
        ) : (
          ""
        )}
      </div>
    </div>
  );
}
