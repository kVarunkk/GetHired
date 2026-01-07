import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProgressBar, ProgressBarProvider } from "react-transition-progress";
import MetadataUpdateRefresh from "@/components/MetadataUpdateRefresh";
import { Suspense } from "react";
import ThemeAwareToaster from "@/components/ToasterComponent";
import { GoogleAnalytics } from "@next/third-parties/google";

export const metadata: Metadata = {
  title: {
    default: "GetHired - Your smartest path to the perfect job",
    template: "%s | GetHired",
  },
  description: "Your smartest path to the perfect job.",
  metadataBase: new URL("https://gethired.devhub.co.in"),
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
              <ProgressBar className="fixed h-1 rounded-r-md shadow-lg shadow-sky-500/20 bg-primary top-0" />
              {children}
              <ThemeAwareToaster />
              <Suspense>
                <MetadataUpdateRefresh />
              </Suspense>
            </TooltipProvider>
          </ThemeProvider>
        </ProgressBarProvider>
      </body>
      <GoogleAnalytics gaId="G-4704XKQWMK" />
    </html>
  );
}
