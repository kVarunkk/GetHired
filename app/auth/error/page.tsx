import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign-in Error",
  description:
    "Something went wrong while signing you in to GetHired.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                Sorry, something went wrong.
              </CardTitle>
            </CardHeader>
            <CardContent>
              {params?.error ? (
                <p className="text-sm text-muted-foreground mb-5">
                  Code error: {params.error}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mb-5">
                  An unspecified error occurred.
                </p>
              )}
              <div className="flex items-center gap-4 flex-wrap">
                <Link
                  href={"/auth/login"}
                  className="text-sm font-medium underline underline-offset-4 transition-colors hover:text-brand"
                >
                  Back to Login
                </Link>
                <Link
                  href={"mailto:varun@devhub.co.in"}
                  className="text-sm font-medium underline underline-offset-4 transition-colors hover:text-brand"
                >
                  Contact Support
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
