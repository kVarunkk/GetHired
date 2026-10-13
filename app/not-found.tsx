import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

// Replaces Next's built-in 404, which styles itself from the OS colour
// scheme instead of the app's theme class.
export default function NotFound() {
  return (
    <main className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 bg-background px-4 py-16 text-center text-foreground">
      <p className="text-sm font-semibold text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold sm:text-3xl">Page not found</h1>
      <p className="max-w-md text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild variant="brand">
          <Link href="/">Go home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/jobs">Browse jobs</Link>
        </Button>
      </div>
    </main>
  );
}
