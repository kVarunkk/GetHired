import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ConsentButtons } from "./consent-buttons";
import { consentLoginPath, consentView } from "@/helpers/oauth/consent-view";
import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Authorize Access",
  robots: { index: false, follow: false },
};

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const authorizationId = (await searchParams).authorization_id;

  if (!authorizationId) {
    return <p>Invalid authorization request.</p>;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(consentLoginPath(authorizationId));
  }

  const { data: authDetails } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (authDetails) {
    if ("redirect_url" in authDetails) {
      redirect(authDetails.redirect_url);
    } else {
      const view = consentView({
        clientName: authDetails.client.name,
        redirectUri: authDetails.redirect_uri,
      });
      return (
        <div className="max-w-md mx-auto mt-20 p-6 border rounded-lg">
          <h1 className="text-xl font-semibold mb-2">
            Authorize {view.clientName}
          </h1>
          <p className="text-muted-foreground mb-4">
            This application is requesting access to your GetHired account.
          </p>
          <p className="text-sm mb-4">
            {view.isLocal
              ? "It runs on this device"
              : "Access is sent to"}{" "}
            <span className="font-medium font-mono break-all">
              {view.redirectHost ?? "an address that couldn't be read"}
            </span>
          </p>
          {!view.nameMatchesHost && (
            <div
              role="alert"
              className="mb-4 flex gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-warning"
            >
              <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
              <p>
                Apps choose their own names. &ldquo;{view.clientName}&rdquo;
                doesn&rsquo;t look like it belongs to{" "}
                {view.redirectHost ?? "this address"}. Only approve if you
                set this app up yourself.
              </p>
            </div>
          )}
          {authDetails.scope?.trim() && (
            <div className="mb-4">
              <p className="font-medium mb-1">Requested permissions:</p>
              <ul className="list-disc list-inside text-sm text-muted-foreground">
                {authDetails.scope.split(" ").map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <form
            action="/api/oauth/decision"
            method="POST"
            className="flex gap-3"
          >
            <input
              type="hidden"
              name="authorization_id"
              value={authorizationId}
            />
            <ConsentButtons />
          </form>
        </div>
      );
    }
  } else {
    return (
      <div className="max-w-md mx-auto mt-20 p-6 border rounded-lg">
        <p>Invalid or expired authorization request.</p>
      </div>
    );
  }
}
