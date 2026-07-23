import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-static";

export default function Page() {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                Thank you for signing up!
              </CardTitle>
              <CardDescription>Check your email to confirm</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                You have successfully signed up. Please check your email to
                confirm your account before signing in. If you do not see the
                email in your primary inbox, please check the spam folder.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
