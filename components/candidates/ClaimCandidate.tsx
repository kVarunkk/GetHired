"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { claimCandidateAction } from "@/app/actions/candidates/claim-candidate";
import { Button } from "@/components/ui/button";
import { claimPrefillPath } from "@/helpers/candidates/paths";

/**
 * BI-REQ-041: connects the signed-in account to the company's invite. A
 * button, so a mail scanner opening the link doesn't claim it.
 *
 * BIT-105: an account without a profile is then offered to start it from the
 * company's record. Skipping goes on to the interview and changes nothing.
 */
export default function ClaimCandidate({ token, companyName }: { token: string; companyName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerHref, setOfferHref] = useState<string | null>(null);

  if (offerHref) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border p-4">
        <p className="text-sm font-medium">{companyName} has a resume on file for you. Use it to start your profile?</p>
        <p className="text-sm text-muted-foreground">
          You&apos;ll review every field before anything is saved to your profile.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="brand">
            <Link href={claimPrefillPath(token, offerHref)}>Review my profile</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={offerHref}>Skip for now</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          type="button"
          variant="brand"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const result = await claimCandidateAction({ token });
              if (result.ok) {
                if (result.offerPrefill) {
                  setOfferHref(result.href);
                  setBusy(false);
                } else {
                  router.push(result.href);
                }
                return;
              }
              setError(result.error);
            } catch {
              setError("Couldn't connect your account. Try again.");
            }
            setBusy(false);
          }}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue to the interview
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
