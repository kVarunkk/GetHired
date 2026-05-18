import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ConsentButtons } from "./consent-buttons";

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
    redirect(
      `/auth/login?returnTo=/oauth/consent?authorization_id=${authorizationId}`,
    );
  }

  const { data: authDetails, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !authDetails || !("client" in authDetails)) {
    return <p>Invalid or expired authorization request.</p>;
  }

  return (
    <div className="max-w-md mx-auto mt-20 p-6 border rounded-lg">
      <h1 className="text-xl font-semibold mb-2">
        Authorize {authDetails.client.name}
      </h1>
      <p className="text-muted-foreground mb-4">
        This application is requesting access to your GetHired account.
      </p>
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
      <form action="/api/oauth/decision" method="POST" className="flex gap-3">
        <input type="hidden" name="authorization_id" value={authorizationId} />
        <ConsentButtons />
      </form>
    </div>
  );
}
