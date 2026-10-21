import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_HOME } from "@/helpers/user/home-path";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

type NotFoundLink = { href: string; label: string };

// "Go home" means each role's dashboard, and visitors the public landing page.
// The landing page and job board are for applicants, so companies aren't sent
// there.
function linksFor(type: unknown): [NotFoundLink, NotFoundLink] {
  if (type === "company") {
    return [
      { href: COMPANY_HOME, label: "Go home" },
      { href: "/company/job-posts", label: "View job posts" },
    ];
  }
  if (type === "applicant") {
    return [
      { href: "/dashboard", label: "Go home" },
      { href: "/jobs", label: "Browse jobs" },
    ];
  }
  return [
    { href: "/", label: "Go home" },
    { href: "/jobs", label: "Browse jobs" },
  ];
}

// Replaces Next's built-in 404, which styles itself from the OS colour
// scheme instead of the app's theme class.
export default async function NotFound() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [primary, secondary] = linksFor(user?.app_metadata?.type);

  return (
    <main className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 bg-background px-4 py-16 text-center text-foreground">
      <p className="text-sm font-semibold text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold sm:text-3xl">Page not found</h1>
      <p className="max-w-md text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild variant="brand">
          <Link href={primary.href}>{primary.label}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={secondary.href}>{secondary.label}</Link>
        </Button>
      </div>
    </main>
  );
}
