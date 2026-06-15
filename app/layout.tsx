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
import LayoutWrapper from "@/components/LayoutWrapper";
import { createClient } from "@/lib/supabase/server";

import { hasEnvVars } from "@/utils/utils";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!hasEnvVars) {
    return (
      <html lang="en" className="dark" suppressHydrationWarning>
        <body className={`${geistSans.className} flex items-center justify-center min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-900 via-neutral-950 to-neutral-950 text-neutral-100 p-6 font-sans antialiased`}>
          <div className="max-w-md w-full border border-neutral-800/80 rounded-2xl p-8 bg-neutral-900/50 backdrop-blur-xl shadow-2xl relative overflow-hidden transition-all duration-300 hover:border-neutral-700/80">
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500" />
            
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-6 text-amber-500">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>

            <h1 className="text-xl font-bold mb-3 tracking-tight text-neutral-50">Configuration Required</h1>
            <p className="mb-6 text-neutral-400 leading-relaxed text-sm">
              You do not have the required environment variables. Please add all required environment variables in your <code className="bg-neutral-800/60 px-1.5 py-0.5 rounded text-xs font-mono text-neutral-300">.env.local</code> file to run the project.
            </p>

            <p className="text-xs text-neutral-500 leading-relaxed">
              Once you have configured the <code className="bg-neutral-850 px-1 py-0.5 rounded text-neutral-400">.env.local</code> file, restart your development server (<code className="bg-neutral-850 px-1 py-0.5 rounded text-neutral-400">npm run dev</code>).
            </p>
          </div>
        </body>
      </html>
    );
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
              <ProgressBar className="fixed h-1 rounded-r-md shadow-lg shadow-sky-500/20 bg-primary top-0 z-[100]" />
              <LayoutWrapper user={user}>{children}</LayoutWrapper>
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
