import type { Metadata } from "next";
import Link from "next/link";
import ClaimCandidate from "@/components/candidates/ClaimCandidate";
import { Button } from "@/components/ui/button";
import { claimViewFor, loadClaim } from "@/helpers/candidates/claim-page";
import { CLAIM_MESSAGES } from "@/helpers/candidates/copy";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Your AI interview",
  robots: { index: false, follow: false },
};

/**
 * BI-REQ-041, public: the link in an imported applicant's interview emails.
 * Signed out, it offers sign-up and log-in, both returning here; signed in
 * as an applicant, a button connects the account and opens the interview.
 */
export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const token = decodeURIComponent((await params).token);
  const [claim, user] = await Promise.all([loadClaim(createServiceRoleClient(), token), getUserFromRequest()]);
  const view = claimViewFor(claim, user ? { id: user.id, type: user.app_metadata?.type } : null);
  const returnTo = encodeURIComponent(`/claim/${token}`);
  const companyName = claim?.companyName ?? "The company";
  const forJob = claim?.jobTitle ? ` for ${claim.jobTitle}` : "";

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">
        {claim ? `${companyName} invited you to an AI interview${forJob}` : "Your AI interview"}
      </h1>
      {view === "invalid" || view === "expired" || view === "used" ? (
        <p className="text-sm text-muted-foreground">{CLAIM_MESSAGES[view]}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Create a GetHired account (or log in) to take the interview. {companyName} will see your account&apos;s
            profile for this application.
          </p>
          {view === "signed_out" && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="brand">
                <Link href={`/auth/sign-up?returnTo=${returnTo}`}>Create an account</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/auth/login?returnTo=${returnTo}`}>Log in</Link>
              </Button>
            </div>
          )}
          {view === "company_account" && <p className="text-sm">{CLAIM_MESSAGES.company_account}</p>}
          {view === "confirm" && (
            <>
              <p className="text-sm">
                You&apos;re signed in as <span className="font-medium">{user?.email}</span>.
              </p>
              <ClaimCandidate token={token} companyName={companyName} />
            </>
          )}
        </>
      )}
    </main>
  );
}
