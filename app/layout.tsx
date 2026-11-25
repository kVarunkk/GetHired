import { shareImages, twitterShareImages } from "@/helpers/seo/share-image";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProgressBar, ProgressBarProvider } from "react-transition-progress";
import MetadataUpdateRefresh from "@/components/MetadataUpdateRefresh";
import { Suspense } from "react";
import ThemeAwareToaster from "@/components/ToasterComponent";
import LayoutWrapper from "@/components/LayoutWrapper";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/utils/utils";
import EnvWarning from "@/components/env-warning";
import PostHogIdentify from "@/lib/posthog/posthogidentify";

export const metadata: Metadata = {
  title: {
    default: "AI Job Search for Every Role | GetHired",
    template: "%s | GetHired",
  },
  description:
    "Find jobs in every field, including remote roles. Search current openings by role, location and salary, then use GetHired's AI agent to match jobs to your resume, track applications and prepare for interviews.",
  metadataBase: new URL("https://gethired.devhub.co.in"),
  // Site-wide defaults only. No canonical, URL, title or description here:
  // every page inherits these, and Next fills og:title/og:description (and
  // Twitter's) from the page's own title and description only when the
  // inherited openGraph leaves them out. The homepage's are in app/page.tsx.
  openGraph: {
    type: "website",
    siteName: "GetHired",
    ...shareImages,
  },
  twitter: twitterShareImages,
  robots: {
    index: true,
    follow: true,
  },
  keywords: [
    "ai job search",
    "ai job search agent",
    "job search",
    "jobs",
    "remote jobs",
    "remote jobs in india",
    "job alerts",
    "job application tracker",
    "ai resume checker",
    "ai mock interview",
    "tech jobs",
    "job hunting",
  ],
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!hasEnvVars) {
    return <EnvWarning geistClassname={geistSans.className} />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.className} antialiased text-sm sm:text-base`}
      >
        <ProgressBarProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider>
              <ProgressBar className="fixed h-1 rounded-r-md bg-primary top-0 z-[100]" />
              <LayoutWrapper user={user}>{children}</LayoutWrapper>
              <PostHogIdentify initialUser={user} />
              <ThemeAwareToaster />
              <Suspense>
                <MetadataUpdateRefresh />
              </Suspense>
            </TooltipProvider>
          </ThemeProvider>
        </ProgressBarProvider>
      </body>
    </html>
  );
}
