import type { Metadata } from "next";
import UnsubscribeCandidate from "@/components/candidates/UnsubscribeCandidate";
import { verifyUnsubscribeToken } from "@/helpers/candidates/unsubscribe-token";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

/**
 * BI-REQ-034, public: stops a company's emails to someone it imported. The
 * signed token names the candidate; only the company's name is shown.
 */
export default async function UnsubscribeCandidatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const candidateId = verifyUnsubscribeToken(decodeURIComponent(token));
  const { data: candidate } = candidateId
    ? await createServiceRoleClient()
        .from("company_candidates")
        .select("email_opted_out_at, company_info(name)")
        .eq("id", candidateId)
        .maybeSingle()
    : { data: null };
  const companyName = candidate?.company_info?.name ?? "This company";

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Unsubscribe</h1>
      {!candidate ? (
        <p className="text-sm text-muted-foreground">
          This link isn&apos;t valid. Use the unsubscribe link from the latest email you got.
        </p>
      ) : candidate.email_opted_out_at ? (
        <p role="status" className="text-sm">
          You&apos;re unsubscribed. {companyName} won&apos;t email you through GetHired again.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Stop emails from {companyName} sent through GetHired about your application. They&apos;ll still have your
            application, but won&apos;t be able to email you here.
          </p>
          <UnsubscribeCandidate token={decodeURIComponent(token)} companyName={companyName} />
        </>
      )}
    </main>
  );
}
