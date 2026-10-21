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
    default: "Find Tech & Remote Jobs | GetHired",
    template: "%s | GetHired",
  },
  description:
    "Find developer and tech jobs, including remote roles. Search current openings by role and location, then use GetHired's AI tools to focus your job search.",
  metadataBase: new URL("https://gethired.devhub.co.in"),
  // Site-wide defaults only. No canonical, URL, title or description here:
  // every page inherits these, and Next fills og:title/og:description (and
  // Twitter's) from the page's own title and description only when the
  // inherited openGraph leaves them out. The homepage's are in app/page.tsx.
  openGraph: {
    type: "website",
    siteName: "GetHired",
    images: ["/opengraph-image.jpg"],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/opengraph-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
  keywords: [
    "remote jobs in india",
    "remote developer jobs",
    "tech jobs",
    "remote jobs",
    "developer jobs",
    "software engineer jobs",
    "job search",
    "ai job search",
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
