import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

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
                <Link href={"/auth/login"} className="text-sm underline ">
                  Back to Login
                </Link>
                <Link
                  href={"mailto:varun@devhub.co.in"}
                  className="text-sm underline "
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
